import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';
import { locateServer } from './serverPath.js';
import { StatusBar } from './status.js';

let client: LanguageClient | undefined;
let status: StatusBar | undefined;
let output: vscode.OutputChannel | undefined;

/** Settings forwarded to the server, matching what it reads on the other side. */
function serverSettings(folder: vscode.WorkspaceFolder | undefined): Record<string, unknown> {
  const config = vscode.workspace.getConfiguration('prosebind', folder);
  return {
    debounceMs: config.get<number>('debounceMs', 900),
    severityFloor: config.get<string>('severityFloor', 'note'),
  };
}

async function start(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const located = locateServer(folder);
  if (!located) return;

  output ??= vscode.window.createOutputChannel('Prosebind');
  output.appendLine(`Starting language server from ${located.origin}`);

  const serverOptions: ServerOptions = { run: located.executable, debug: located.executable };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'markdown' },
      { scheme: 'file', language: 'plaintext' },
    ],
    synchronize: {
      // The bible is canon. When it changes, the server re-checks everything, because
      // a single edited attribute can change the verdict on any scene in the book.
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.prosebind/**'),
    },
    initializationOptions: serverSettings(folder),
    outputChannel: output,
    // Findings are not errors and must never steal focus while someone is writing.
    revealOutputChannelOn: 4 /* RevealOutputChannelOn.Never */,
  };

  client = new LanguageClient('prosebind', 'Prosebind', serverOptions, clientOptions);

  status?.setStarting();
  try {
    await client.start();
    output.appendLine('Language server ready.');
    status?.refresh();
  } catch (error) {
    const message = (error as Error).message;
    output.appendLine(`Failed to start: ${message}`);
    status?.setFailed(`Could not start prosebind-lsp (looked in: ${located.origin}).`);

    // One notification, on a hard failure, with the fix attached. This is the only
    // place the extension is allowed to interrupt — an unavailable tool that stays
    // silent is indistinguishable from a manuscript with no problems.
    const choice = await vscode.window.showWarningMessage(
      `Prosebind could not start its language server (tried ${located.origin}).`,
      'Open Settings',
      'Show Log',
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'prosebind.serverPath');
    } else if (choice === 'Show Log') {
      output.show(true);
    }
    client = undefined;
  }

  if (client) context.subscriptions.push({ dispose: () => void client?.stop() });
}

async function restart(context: vscode.ExtensionContext): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
  await start(context);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  status = new StatusBar();
  context.subscriptions.push(status);

  // Recount whenever anything publishes. Cheap, and it keeps the badge honest
  // without inventing a side channel to the server.
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(() => status?.refresh()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('prosebind.recheck', async () => {
      if (!client) {
        void vscode.window.showInformationMessage('Prosebind is not running.');
        return;
      }
      await client.sendRequest('workspace/executeCommand', {
        command: 'prosebind.recheck',
        arguments: [],
      });
    }),

    vscode.commands.registerCommand('prosebind.restart', () => restart(context)),

    vscode.commands.registerCommand('prosebind.showLog', () => output?.show(true)),

    vscode.commands.registerCommand('prosebind.init', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Open a folder containing your manuscript first.');
        return;
      }
      // Delegated to the CLI rather than reimplemented here: the bible templates live
      // in one place, and a client that drifts from them would hand writers a schema
      // the engine does not read.
      const terminal = vscode.window.createTerminal({ name: 'Prosebind', cwd: folder.uri.fsPath });
      terminal.show(true);
      terminal.sendText('prosebind init');
    }),

    vscode.commands.registerCommand('prosebind.openBible', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const target = vscode.Uri.joinPath(folder.uri, '.prosebind', 'bible', 'characters.yaml');
      try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
      } catch {
        void vscode.window.showWarningMessage(
          'No bible found. Run "Prosebind: Create continuity bible" first.',
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('prosebind')) return;
      if (event.affectsConfiguration('prosebind.serverPath')) {
        await restart(context);
        return;
      }
      await client?.sendNotification('workspace/didChangeConfiguration', {
        settings: { prosebind: serverSettings(vscode.workspace.workspaceFolders?.[0]) },
      });
    }),
  );

  await start(context);
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
