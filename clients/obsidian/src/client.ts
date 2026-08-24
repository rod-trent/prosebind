import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Connection } from '@prosebind/spec';

/**
 * An LSP client for Obsidian.
 *
 * Obsidian has no language-client machinery of its own, so this talks to
 * `prosebind-lsp` directly over stdio using the transport from `@prosebind/spec`.
 * That package is Apache-2.0 and exists to be embedded — which is why this plugin can
 * be Apache-2.0 too, while the server it launches is AGPL. The boundary is the process
 * boundary, not a shared library.
 */

export interface Finding {
  uri: string;
  path: string;
  line: number;
  character: number;
  message: string;
  detail?: string | undefined;
  check: string;
  severity: 'contradiction' | 'question' | 'note';
  suppressionKey: string;
  related: Array<{ path: string; line: number; label: string }>;
}

export interface ClientOptions {
  serverPath: string;
  vaultPath: string;
  debounceMs: number;
  severityFloor: string;
  onFindings: (findings: Finding[]) => void;
  onStatus: (status: 'starting' | 'ready' | 'failed', detail?: string) => void;
  onLog: (message: string) => void;
}

interface LspDiagnostic {
  range: { start: { line: number; character: number } };
  severity: number;
  code?: string;
  message: string;
  relatedInformation?: Array<{ location: { uri: string; range: { start: { line: number } } }; message: string }>;
  data?: { check?: string; suppressionKey?: string };
}

/** Severity ladder from the server: 2 = Warning, 3 = Information, 4 = Hint. */
function severityOf(value: number): Finding['severity'] {
  if (value <= 2) return 'contradiction';
  if (value === 3) return 'question';
  return 'note';
}

export class ProsebindClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private connection: Connection | undefined;
  private readonly byUri = new Map<string, Finding[]>();
  private stopping = false;

  constructor(private readonly options: ClientOptions) {}

  async start(): Promise<void> {
    this.options.onStatus('starting');

    try {
      // Pointing at a checkout's dist/cli.js is a normal thing to want, and it needs
      // Node rather than being executed directly.
      const isScript = this.options.serverPath.endsWith('.js');
      const command = isScript ? process.execPath : this.options.serverPath;
      const args = isScript ? [this.options.serverPath] : [];

      this.child = spawn(command, args, {
        cwd: this.options.vaultPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Obsidian's own env can lack the user's shell PATH on macOS, which is the
        // usual reason a globally installed binary is "not found" here but works in
        // a terminal. Nothing we can fully fix; the settings tab explains it.
        env: process.env,
      });
    } catch (error) {
      this.options.onStatus('failed', (error as Error).message);
      return;
    }

    this.child.on('error', (error) => {
      if (this.stopping) return;
      this.options.onStatus('failed', error.message);
      this.connection?.rejectPending('language server could not be started');
    });

    this.child.on('exit', (code) => {
      if (this.stopping) return;
      this.options.onStatus('failed', `language server exited (code ${code ?? 'unknown'})`);
      this.connection?.rejectPending('language server exited');
    });

    // The server logs to stderr; surface it rather than swallowing it.
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.options.onLog(text);
    });

    const connection = new Connection(this.child.stdout, this.child.stdin);
    this.connection = connection;

    connection.onNotification('textDocument/publishDiagnostics', (params) => {
      this.receive(params as { uri: string; diagnostics: LspDiagnostic[] });
    });
    connection.onNotification('window/logMessage', (params) => {
      const p = params as { message?: string };
      if (p.message) this.options.onLog(p.message);
    });
    // The server may ask things of us. Answering nothing is better than not answering.
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onNotification('window/showMessage', (params) => {
      const p = params as { message?: string };
      if (p.message) this.options.onLog(p.message);
    });

    connection.listen();

    try {
      await connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(this.options.vaultPath).toString(),
        capabilities: {},
        initializationOptions: {
          debounceMs: this.options.debounceMs,
          severityFloor: this.options.severityFloor,
        },
      });
      connection.notify('initialized', {});
      this.options.onStatus('ready');
    } catch (error) {
      this.options.onStatus('failed', (error as Error).message);
    }
  }

  private receive(params: { uri: string; diagnostics: LspDiagnostic[] }): void {
    const path = safePath(params.uri);
    const findings: Finding[] = params.diagnostics.map((diagnostic) => ({
      uri: params.uri,
      path,
      line: diagnostic.range.start.line,
      character: diagnostic.range.start.character,
      // The server folds detail into the message with a newline; split it back out
      // so the sidebar can show the claim and the evidence differently.
      message: diagnostic.message.split('\n')[0] ?? diagnostic.message,
      detail: diagnostic.message.split('\n').slice(1).join(' ').trim() || undefined,
      check: diagnostic.code ?? diagnostic.data?.check ?? 'unknown',
      severity: severityOf(diagnostic.severity),
      suppressionKey: diagnostic.data?.suppressionKey ?? '',
      related: (diagnostic.relatedInformation ?? []).map((item) => ({
        path: safePath(item.location.uri),
        line: item.location.range.start.line,
        label: item.message,
      })),
    }));

    if (findings.length === 0) this.byUri.delete(params.uri);
    else this.byUri.set(params.uri, findings);

    this.options.onFindings(this.all());
  }

  all(): Finding[] {
    const rank = { contradiction: 0, question: 1, note: 2 } as const;
    return [...this.byUri.values()].flat().sort((a, b) => {
      const bySeverity = rank[a.severity] - rank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return a.path.localeCompare(b.path) || a.line - b.line;
    });
  }

  didOpen(path: string, text: string): void {
    this.connection?.notify('textDocument/didOpen', {
      textDocument: { uri: pathToFileURL(path).toString(), languageId: 'markdown', version: 1, text },
    });
  }

  didChange(path: string, text: string, version: number): void {
    this.connection?.notify('textDocument/didChange', {
      textDocument: { uri: pathToFileURL(path).toString(), version },
      contentChanges: [{ text }],
    });
  }

  didSave(path: string): void {
    this.connection?.notify('textDocument/didSave', {
      textDocument: { uri: pathToFileURL(path).toString() },
    });
  }

  /** Tell the server the bible changed, so it re-checks everything. */
  bibleChanged(path: string): void {
    this.connection?.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: pathToFileURL(path).toString(), type: 2 }],
    });
  }

  async suppress(key: string): Promise<void> {
    await this.connection?.sendRequest('workspace/executeCommand', {
      command: 'prosebind.suppress',
      arguments: [{ key }],
    });
  }

  async recheck(): Promise<void> {
    await this.connection?.sendRequest('workspace/executeCommand', {
      command: 'prosebind.recheck',
      arguments: [],
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    try {
      await Promise.race([
        this.connection?.sendRequest('shutdown') ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      this.connection?.notify('exit');
    } catch {
      // A server that will not shut down politely gets killed below.
    }
    this.child?.kill();
    this.child = undefined;
    this.connection = undefined;
    this.byUri.clear();
  }
}

function safePath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}
