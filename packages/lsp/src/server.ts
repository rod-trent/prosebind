import { basename, resolve } from 'node:path';
import { Suppressions, loadSuppressions, saveSuppressions } from '@prosebind/core';
import type { Diagnostic, Entity, Mention } from '@prosebind/core';
import { pathToUri, toLspDiagnostic, uriToPath, passesFloor, type SeverityFloor } from './convert.js';
import { Connection } from './jsonrpc.js';
import {
  COMMANDS,
  CodeActionKind,
  SymbolKind,
  TextDocumentSyncKind,
  type CodeAction,
  type DiagnosticData,
  type DocumentSymbol,
  type Hover,
  type Location,
  type LspDiagnostic,
  type Position,
  type TextDocumentPositionParams,
  type WorkspaceSymbol,
} from './protocol.js';
import { Workspace } from './workspace.js';

interface Settings {
  debounceMs: number;
  severityFloor: SeverityFloor;
}

const DEFAULTS: Settings = { debounceMs: 900, severityFloor: 'note' };

/**
 * The Prosebind language server.
 *
 * Maps continuity concepts onto LSP exactly as DESIGN.md § 5 sets out: diagnostics are
 * violations, hover is an entity card, code actions are "mark intentional" and
 * "promote to canon", definition is where a character first appears, references are
 * every scene they are in, and workspace symbols are the bible, browsable.
 */
export class ProsebindServer {
  private workspace: Workspace | undefined;
  private settings: Settings = { ...DEFAULTS };
  private root = process.cwd();
  private shuttingDown = false;

  /**
   * Resolves once the project is loaded.
   *
   * Editors send `initialized` and then immediately start firing didOpen and requests
   * without waiting for anything. Loading a bible and every manuscript takes time, so
   * every handler gates on this. Without it, the first few requests after startup
   * silently return null and the server looks broken exactly when a writer is forming
   * their first impression of it.
   */
  private ready: Promise<void> = Promise.resolve();

  private async whenReady(): Promise<Workspace | undefined> {
    await this.ready;
    return this.workspace;
  }

  constructor(private readonly connection: Connection) {
    this.register();
  }

  private log(message: string): void {
    // window/logMessage keeps this in the editor's output panel. Never stdout.
    this.connection.notify('window/logMessage', { type: 3, message: `prosebind: ${message}` });
  }

  private register(): void {
    const c = this.connection;

    c.onRequest('initialize', (params) => this.initialize(params));
    c.onNotification('initialized', () => {
      // Deliberately not awaited: `initialized` is a notification, and the client is
      // entitled to start sending work immediately. `this.ready` is what serialises it.
      this.ready = this.afterInitialize();
    });
    c.onRequest('shutdown', () => {
      this.shuttingDown = true;
      return null;
    });
    c.onNotification('exit', () => process.exit(this.shuttingDown ? 0 : 1));

    c.onNotification('textDocument/didOpen', async (params) => {
      const p = params as { textDocument: { uri: string; text: string } };
      (await this.whenReady())?.didOpen(uriToPath(p.textDocument.uri), p.textDocument.text);
    });

    c.onNotification('textDocument/didChange', async (params) => {
      const p = params as { textDocument: { uri: string }; contentChanges: Array<{ text: string }> };
      // We advertise Full sync, so the last change carries the whole document.
      const text = p.contentChanges[p.contentChanges.length - 1]?.text;
      if (text !== undefined) (await this.whenReady())?.didChange(uriToPath(p.textDocument.uri), text);
    });

    c.onNotification('textDocument/didClose', async (params) => {
      const p = params as { textDocument: { uri: string } };
      (await this.whenReady())?.didClose(uriToPath(p.textDocument.uri));
    });

    c.onNotification('textDocument/didSave', async () => {
      // A save is a natural pause, and § 10 says a pause is when we may speak.
      (await this.whenReady())?.flush();
    });

    c.onNotification('workspace/didChangeConfiguration', (params) => {
      const p = params as { settings?: { prosebind?: Partial<Settings> } };
      this.applySettings(p.settings?.prosebind);
    });

    c.onNotification('workspace/didChangeWatchedFiles', (params) => {
      const p = params as { changes: Array<{ uri: string }> };
      void this.watchedFilesChanged(p.changes.map((change) => uriToPath(change.uri)));
    });

    // Every request gates on `ready`: answering from a half-loaded project would
    // produce confidently empty results, which is worse than a moment's wait.
    const gated =
      <T>(handler: (params: never) => T) =>
      async (params: unknown): Promise<T> => {
        await this.ready;
        return handler.call(this, params as never);
      };

    c.onRequest('textDocument/hover', gated(this.hover));
    c.onRequest('textDocument/definition', gated(this.definition));
    c.onRequest('textDocument/references', gated(this.references));
    c.onRequest('textDocument/documentSymbol', gated(this.documentSymbols));
    c.onRequest('workspace/symbol', gated(this.workspaceSymbols));
    c.onRequest('textDocument/codeAction', gated(this.codeActions));
    c.onRequest('workspace/executeCommand', gated(this.executeCommand));
  }

  private initialize(params: unknown): unknown {
    const p = params as {
      rootUri?: string | null;
      rootPath?: string;
      workspaceFolders?: Array<{ uri: string }> | null;
      initializationOptions?: Partial<Settings>;
    };

    const folder = p.workspaceFolders?.[0]?.uri ?? p.rootUri ?? undefined;
    this.root = folder ? uriToPath(folder) : resolve(p.rootPath ?? process.cwd());
    this.applySettings(p.initializationOptions);

    return {
      capabilities: {
        // Full sync: our incrementality lives in the analysis, not the transport, and
        // a whole-document string removes an entire class of desync bug.
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Full, save: true },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.Refactor] },
        executeCommandProvider: { commands: Object.values(COMMANDS) },
      },
      serverInfo: { name: 'prosebind-lsp', version: '0.0.0' },
    };
  }

  private applySettings(incoming: Partial<Settings> | undefined): void {
    if (!incoming) return;
    if (typeof incoming.debounceMs === 'number' && incoming.debounceMs >= 0) {
      this.settings.debounceMs = incoming.debounceMs;
    }
    if (incoming.severityFloor && ['contradiction', 'question', 'note'].includes(incoming.severityFloor)) {
      this.settings.severityFloor = incoming.severityFloor;
    }
  }

  private async afterInitialize(): Promise<void> {
    this.workspace = new Workspace(this.root, {
      debounceMs: this.settings.debounceMs,
      onLog: (message) => this.log(message),
      onDiagnostics: (path, diagnostics) => this.publish(path, diagnostics),
    });

    try {
      await this.workspace.initialize();
    } catch (error) {
      this.log(`could not load project: ${(error as Error).message}`);
      return;
    }

    for (const issue of this.workspace.bibleIssues) {
      this.connection.notify('window/showMessage', {
        type: 2,
        message: `prosebind: ${issue.file}: ${issue.message}`,
      });
    }
  }

  private publish(path: string, diagnostics: readonly Diagnostic[]): void {
    const index = this.workspace?.index(path);
    if (!index) {
      this.connection.notify('textDocument/publishDiagnostics', { uri: pathToUri(path), diagnostics: [] });
      return;
    }

    const visible = diagnostics.filter((d) => passesFloor(d, this.settings.severityFloor));
    const converted: LspDiagnostic[] = visible.map((diagnostic) =>
      toLspDiagnostic(diagnostic, {
        index,
        indexFor: (other) => this.workspace?.index(other),
      }),
    );

    this.connection.notify('textDocument/publishDiagnostics', {
      uri: pathToUri(path),
      diagnostics: converted,
    });
  }

  private async watchedFilesChanged(paths: readonly string[]): Promise<void> {
    if (!this.workspace) return;
    if (paths.some((path) => path.includes('.prosebind'))) {
      await this.workspace.reloadBible();
      return;
    }
    for (const path of paths) await this.workspace.didChangeOnDisk(path);
  }

  // --- position helpers ----------------------------------------------------

  private offsetAt(path: string, position: Position): number | undefined {
    return this.workspace?.index(path)?.offsetAt(position);
  }

  private mentionAt(path: string, position: Position): Mention | undefined {
    const graph = this.workspace?.graph;
    const offset = this.offsetAt(path, position);
    if (!graph || offset === undefined) return undefined;
    const doc = this.workspace?.document(path);
    if (!doc) return undefined;
    const ids = new Set(doc.segments.map((s) => s.id));
    return graph.allMentions.find(
      (m) => ids.has(m.segmentId) && offset >= m.span.start && offset <= m.span.end,
    );
  }

  // --- hover ---------------------------------------------------------------

  private hover(params: TextDocumentPositionParams): Hover | null {
    const path = uriToPath(params.textDocument.uri);
    const mention = this.mentionAt(path, params.position);
    const graph = this.workspace?.graph;
    if (!mention || !graph) return null;

    const entity = graph.entity(mention.entityId);
    if (!entity) return null;

    const index = this.workspace?.index(path);
    return {
      contents: { kind: 'markdown', value: this.entityCard(entity) },
      range: index ? index.rangeOf(mention.span) : undefined,
    };
  }

  /** The entity card from DESIGN.md § 5: current state, where seen, what is known. */
  private entityCard(entity: Entity): string {
    const graph = this.workspace?.graph;
    if (!graph) return entity.name;

    const lines: string[] = [`**${entity.name}** — ${entity.type}`];
    if (entity.aliases.length > 0) lines.push(`_also_ ${entity.aliases.join(', ')}`);

    const facts = graph.factsFor(entity.id);
    if (facts.length > 0) {
      lines.push('', '| | | |', '|---|---|---|');
      for (const fact of facts) {
        const badge = fact.tier === 'canon' ? '**canon**' : 'inferred';
        lines.push(`| ${fact.predicate} | ${fact.value} | ${badge} |`);
      }
    }

    const mentions = graph.mentionsOf(entity.id);
    if (mentions.length > 0) {
      const files = new Set(mentions.map((m) => m.segmentId.split('#')[0] ?? ''));
      const speaking = mentions.filter((m) => m.speaking).length;
      lines.push(
        '',
        `${mentions.length} mention${mentions.length === 1 ? '' : 's'} across ${files.size} file${files.size === 1 ? '' : 's'}` +
          (speaking > 0 ? `, speaking ${speaking} time${speaking === 1 ? '' : 's'}` : ''),
      );
    } else {
      lines.push('', '_Declared in your bible, but never mentioned in the manuscript._');
    }

    if (entity.introducedAt) {
      const event = graph.event(entity.introducedAt);
      lines.push(`Introduced at **${event?.label ?? entity.introducedAt}**${event?.date ? ` (${event.date})` : ''}`);
    }
    if (entity.deceasedAfter) {
      const event = graph.event(entity.deceasedAfter);
      lines.push(`Dies at **${event?.label ?? entity.deceasedAfter}**${event?.date ? ` (${event.date})` : ''}`);
    }
    if (entity.born) lines.push(`Born ${entity.born}`);

    return lines.join('\n');
  }

  // --- navigation ----------------------------------------------------------

  /** Where this character first appears — the reader's introduction to them. */
  private definition(params: TextDocumentPositionParams): Location[] | null {
    const path = uriToPath(params.textDocument.uri);
    const mention = this.mentionAt(path, params.position);
    const graph = this.workspace?.graph;
    if (!mention || !graph) return null;

    const all = graph.mentionsOf(mention.entityId);
    if (all.length === 0) return null;

    const bySegment = new Map(this.workspace?.documents.flatMap((d) => d.segments.map((s) => [s.id, d.path] as const)));
    const first = all.reduce((earliest, candidate) => {
      const a = bySegment.get(earliest.segmentId) ?? '';
      const b = bySegment.get(candidate.segmentId) ?? '';
      if (a !== b) return a <= b ? earliest : candidate;
      return candidate.span.start < earliest.span.start ? candidate : earliest;
    });

    const file = bySegment.get(first.segmentId);
    if (!file) return null;
    const index = this.workspace?.index(file);
    if (!index) return null;

    return [{ uri: pathToUri(file), range: index.rangeOf(first.span) }];
  }

  /** Every scene this character appears in. */
  private references(params: TextDocumentPositionParams): Location[] | null {
    const path = uriToPath(params.textDocument.uri);
    const mention = this.mentionAt(path, params.position);
    const graph = this.workspace?.graph;
    if (!mention || !graph) return null;

    const bySegment = new Map(this.workspace?.documents.flatMap((d) => d.segments.map((s) => [s.id, d.path] as const)));
    const locations: Location[] = [];

    for (const other of graph.mentionsOf(mention.entityId)) {
      const file = bySegment.get(other.segmentId);
      if (!file) continue;
      const index = this.workspace?.index(file);
      if (!index) continue;
      locations.push({ uri: pathToUri(file), range: index.rangeOf(other.span) });
    }

    return locations;
  }

  private documentSymbols(params: { textDocument: { uri: string } }): DocumentSymbol[] {
    const path = uriToPath(params.textDocument.uri);
    const doc = this.workspace?.document(path);
    const index = this.workspace?.index(path);
    if (!doc || !index) return [];

    const chapters = doc.segments.filter((s) => s.kind === 'chapter');
    const scenes = doc.segments.filter((s) => s.kind === 'scene');

    return chapters.map((chapter) => ({
      name: chapter.title ?? `Chapter ${chapter.ordinal + 1}`,
      detail: `${chapter.wordCount.toLocaleString('en-US')} words`,
      kind: SymbolKind.Class,
      range: index.rangeOf(chapter.span),
      selectionRange: index.rangeOf({ start: chapter.span.start, end: Math.min(chapter.span.start + 40, chapter.span.end) }),
      children: scenes
        .filter((scene) => scene.parentId === chapter.id)
        .map((scene) => ({
          name: scene.title ?? `Scene ${scene.ordinal + 1}`,
          detail: `${scene.wordCount.toLocaleString('en-US')} words`,
          kind: SymbolKind.Method,
          range: index.rangeOf(scene.span),
          selectionRange: index.rangeOf({ start: scene.span.start, end: Math.min(scene.span.start + 40, scene.span.end) }),
        })),
    }));
  }

  /** The bible, browsable — characters, places, and timeline events. */
  private workspaceSymbols(params: { query: string }): WorkspaceSymbol[] {
    const graph = this.workspace?.graph;
    if (!graph) return [];
    const query = params.query.toLowerCase();
    const symbols: WorkspaceSymbol[] = [];

    const biblePath = resolve(this.root, '.prosebind/bible/characters.yaml');
    const zero = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

    for (const entity of graph.entities) {
      if (query && !entity.name.toLowerCase().includes(query)) continue;
      symbols.push({
        name: entity.name,
        kind: entity.type === 'character' ? SymbolKind.Class : SymbolKind.Object,
        containerName: entity.type,
        location: { uri: pathToUri(biblePath), range: zero },
      });
    }

    for (const event of graph.events) {
      if (query && !event.label.toLowerCase().includes(query)) continue;
      const position = event.position;
      const index = position ? this.workspace?.index(position.file) : undefined;
      symbols.push({
        name: event.label,
        kind: SymbolKind.Event,
        containerName: event.date ?? 'timeline',
        location:
          position && index
            ? { uri: pathToUri(position.file), range: index.rangeOf({ start: position.offset, end: position.offset }) }
            : { uri: pathToUri(resolve(this.root, '.prosebind/bible/timeline.yaml')), range: zero },
      });
    }

    return symbols;
  }

  // --- code actions --------------------------------------------------------

  private codeActions(params: unknown): CodeAction[] {
    const p = params as { textDocument: { uri: string }; context: { diagnostics: LspDiagnostic[] } };
    const actions: CodeAction[] = [];

    for (const diagnostic of p.context.diagnostics ?? []) {
      if (diagnostic.source !== 'prosebind') continue;
      const data = diagnostic.data as DiagnosticData | undefined;
      if (!data) continue;

      actions.push({
        title: `Mark as intentional — stop raising "${data.check}" here`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        command: {
          title: 'Mark as intentional',
          command: COMMANDS.suppress,
          arguments: [{ key: data.suppressionKey, root: this.root }],
        },
      });

      actions.push({
        title: `Silence every "${data.check}" finding`,
        kind: CodeActionKind.Refactor,
        diagnostics: [diagnostic],
        command: {
          title: 'Silence this check',
          command: COMMANDS.suppress,
          arguments: [{ key: `${data.check}/*`, root: this.root }],
        },
      });
    }

    if (actions.length === 0) {
      actions.push({
        title: 'Prosebind: recheck this project',
        kind: CodeActionKind.Source,
        command: { title: 'Recheck', command: COMMANDS.recheck, arguments: [] },
      });
    }

    return actions;
  }

  private async executeCommand(params: unknown): Promise<unknown> {
    const p = params as { command: string; arguments?: unknown[] };

    if (p.command === COMMANDS.recheck) {
      this.workspace?.flush();
      return null;
    }

    if (p.command === COMMANDS.suppress) {
      const arg = p.arguments?.[0] as { key?: string } | undefined;
      if (!arg?.key) return null;

      const suppressions: Suppressions = await loadSuppressions(this.root);
      suppressions.add(arg.key);
      await saveSuppressions(this.root, suppressions);
      // Suppressions are read at project load, so this has to be a full reload.
      await this.workspace?.reloadBible();

      this.connection.notify('window/showMessage', {
        type: 3,
        message: `prosebind: suppressed ${arg.key} — recorded in .prosebind/suppress.yaml`,
      });
      return null;
    }

    if (p.command === COMMANDS.promoteToCanon) {
      // Deliberately not implemented yet. Writing to the bible on the writer's behalf
      // needs a confirmation flow, and a half-built one that silently edits their
      // canon is worse than an honest gap.
      this.connection.notify('window/showMessage', {
        type: 2,
        message: 'prosebind: promote-to-canon is not implemented yet — edit .prosebind/bible/characters.yaml directly.',
      });
      return null;
    }

    return null;
  }
}

export function describeRoot(root: string): string {
  return basename(root) || root;
}
