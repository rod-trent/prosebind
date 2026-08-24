import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { resolveServer, type ServerLocation } from './resolveServer.js';

export type { ServerLocation } from './resolveServer.js';

/**
 * Where the language server lives.
 *
 * The extension launches `prosebind-lsp` as a separate process rather than importing
 * the engine. That arm's-length boundary is why this package is Apache-2.0 while the
 * server it starts is AGPL — and it also means a writer can point the extension at any
 * build of the server they like.
 *
 * The decision itself lives in `resolveServer.ts`, free of the VS Code API so it can
 * be tested.
 */
export function locateServer(folder: vscode.WorkspaceFolder | undefined): ServerLocation {
  return resolveServer({
    configured: vscode.workspace.getConfiguration('prosebind', folder).get<string>('serverPath'),
    root: folder?.uri.fsPath,
    exists: existsSync,
    platform: process.platform,
    nodePath: process.execPath,
    env: process.env,
  });
}
