#!/usr/bin/env node
/**
 * prosebind-lsp — the language server entry point.
 *
 * Speaks LSP over stdio. Nothing may be written to stdout except framed protocol
 * messages, so every diagnostic about the server itself goes to stderr or through
 * window/logMessage.
 */
import { Connection } from '@prosebind/spec';
import { ProsebindServer } from './server.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(
    'prosebind-lsp — continuity language server (stdio)\n\n' +
      'Started by your editor, not by hand. Configure it as the language server for\n' +
      'markdown and plain text, then open a project containing a .prosebind directory.\n\n' +
      'Settings (initializationOptions or workspace/didChangeConfiguration):\n' +
      '  prosebind.debounceMs     quiet period before analysing (default 900)\n' +
      '  prosebind.severityFloor  contradiction | question | note (default note)\n',
  );
  process.exit(0);
}

const connection = new Connection(process.stdin, process.stdout);
new ProsebindServer(connection);
connection.listen();

process.on('uncaughtException', (error) => {
  process.stderr.write(`prosebind-lsp: uncaught: ${error.stack ?? String(error)}\n`);
});
