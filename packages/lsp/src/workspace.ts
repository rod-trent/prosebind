import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { LineIndex, Project } from '@prosebind/core';
import type { AnalysisResult, Diagnostic, Document } from '@prosebind/core';

const MANUSCRIPT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.mdown']);
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.obsidian', '.vscode', '.idea', '.prosebind']);

function isManuscript(path: string): boolean {
  if (path.split(sep).some((part) => IGNORED.has(part))) return false;
  return MANUSCRIPT_EXTENSIONS.has(extname(path).toLowerCase());
}

async function findManuscripts(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile() && isManuscript(full)) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found.sort();
}

export interface WorkspaceOptions {
  /**
   * Quiet period after the last keystroke before anything is analysed or published.
   *
   * This is DESIGN.md § 10 expressed in milliseconds. An editor sends didChange on
   * every character; publishing diagnostics against that stream would put a squiggle
   * under a half-typed sentence, which is precisely the behaviour that gets a writing
   * tool uninstalled.
   */
  debounceMs: number;
  onDiagnostics: (path: string, diagnostics: readonly Diagnostic[]) => void;
  onLog: (message: string) => void;
}

/**
 * Owns the project, the open documents, and the decision of *when* to analyse.
 *
 * Deliberately separate from the protocol layer: the rule about not interrupting a
 * writer is a product decision, not an LSP detail, and it should not be buried in a
 * request handler.
 */
export class Workspace {
  private project: Project | undefined;
  private readonly indexes = new Map<string, LineIndex>();
  /** Files the editor has open. Their text beats what is on disk. */
  private readonly open = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private pending = false;
  private lastPublished = new Set<string>();

  constructor(
    readonly root: string,
    private readonly options: WorkspaceOptions,
  ) {}

  /** Read the bible and every manuscript on disk. The cold start. */
  async initialize(): Promise<AnalysisResult> {
    this.project = await Project.open(this.root);
    const paths = await findManuscripts(this.root);
    for (const path of paths) {
      try {
        const text = await readFile(path, 'utf8');
        this.setText(path, text);
      } catch {
        // A file that vanished between listing and reading is not an error.
      }
    }
    const result = this.analyzeNow();
    // Publish immediately on load. Opening a project is not typing, so § 10's rule
    // about staying quiet does not apply — and an editor that shows nothing until the
    // first keystroke looks broken.
    this.publish(result);
    this.options.onLog(
      `loaded ${paths.length} file${paths.length === 1 ? '' : 's'}, ` +
        `${this.project.graph.entities.length} entities, ${this.project.graph.events.length} events` +
        (this.project.bibleIssues.length > 0 ? `, ${this.project.bibleIssues.length} bible issue(s)` : ''),
    );
    return result;
  }

  get bibleIssues(): ReadonlyArray<{ file: string; message: string }> {
    return this.project?.bibleIssues ?? [];
  }

  get graph() {
    return this.project?.graph;
  }

  document(path: string): Document | undefined {
    return this.project?.document(path);
  }

  get documents(): Document[] {
    if (!this.project) return [];
    return this.project.files
      .map((p) => this.project?.document(p))
      .filter((d): d is Document => d !== undefined);
  }

  index(path: string): LineIndex | undefined {
    const cached = this.indexes.get(path);
    if (cached) return cached;
    const doc = this.project?.document(path);
    if (!doc) return undefined;
    const made = new LineIndex(doc.text);
    this.indexes.set(path, made);
    return made;
  }

  private setText(path: string, text: string): void {
    this.project?.setDocument(path, text);
    this.indexes.delete(path);
  }

  didOpen(path: string, text: string): void {
    this.open.add(path);
    this.setText(path, text);
    // Opening a file is not typing, so there is nothing to wait for.
    this.schedule(0);
  }

  didChange(path: string, text: string): void {
    this.setText(path, text);
    this.schedule(this.options.debounceMs);
  }

  didClose(path: string): void {
    this.open.delete(path);
  }

  /** A file changed on disk outside the editor. */
  async didChangeOnDisk(path: string): Promise<void> {
    if (this.open.has(path)) return; // the editor's copy is authoritative
    try {
      this.setText(path, await readFile(path, 'utf8'));
    } catch {
      this.project?.removeDocument(path);
      this.indexes.delete(path);
    }
    this.schedule(this.options.debounceMs);
  }

  /**
   * The bible changed. Canon is global, so this is the one case where re-checking the
   * whole manuscript is the correct answer rather than a failure of incrementality.
   */
  async reloadBible(): Promise<void> {
    if (!this.project) return;
    const texts = new Map<string, string>();
    for (const doc of this.documents) texts.set(doc.path, doc.text);

    this.project = await Project.open(this.root);
    this.indexes.clear();
    for (const [path, text] of texts) this.project.setDocument(path, text);
    this.options.onLog('bible reloaded; rechecking every file');
    this.schedule(0);
  }

  private schedule(delay: number): void {
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // A didOpen can land while the cold start is still reading files. Skipping is
      // correct: initialize() publishes when it finishes, so nothing is lost.
      if (!this.project) return;
      this.publish(this.analyzeNow());
    }, delay);
  }

  /** Analyse immediately, bypassing the debounce. */
  flush(): AnalysisResult | undefined {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.project) return undefined;
    const result = this.analyzeNow();
    this.publish(result);
    return result;
  }

  private analyzeNow(): AnalysisResult {
    if (!this.project) throw new Error('workspace not initialised');
    this.pending = false;
    return this.project.analyze();
  }

  get isPending(): boolean {
    return this.pending;
  }

  private publish(result: AnalysisResult): void {
    const byFile = new Map<string, Diagnostic[]>();
    for (const diagnostic of result.diagnostics) {
      const bucket = byFile.get(diagnostic.file);
      if (bucket) bucket.push(diagnostic);
      else byFile.set(diagnostic.file, [diagnostic]);
    }

    for (const [path, diagnostics] of byFile) {
      this.options.onDiagnostics(path, diagnostics);
    }
    // Clear files that had findings last time and have none now, or the editor keeps
    // showing a squiggle the writer already fixed.
    for (const path of this.lastPublished) {
      if (!byFile.has(path)) this.options.onDiagnostics(path, []);
    }
    this.lastPublished = new Set(byFile.keys());
  }

  /** Every diagnostic currently known, across all files. */
  allDiagnostics(): readonly Diagnostic[] {
    return this.project ? this.project.analyze().diagnostics : [];
  }
}
