#!/usr/bin/env node
/**
 * prosebind-mcp — expose a manuscript's continuity graph over MCP.
 *
 * Speaks JSON-RPC over stdio, so stdout carries the protocol and nothing else. All
 * logging goes to stderr.
 */
import { resolve } from 'node:path';
import { Connection } from '@prosebind/spec';
import { ProsebindMcpServer } from './server.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write(
    'prosebind-mcp — continuity graph over the Model Context Protocol (stdio)\n\n' +
      'Usage: prosebind-mcp [project-dir]\n\n' +
      'Started by an MCP client, not by hand. Point it at a directory containing a\n' +
      '.prosebind bible. Every tool is read-only: it never edits the manuscript, and\n' +
      'never writes prose.\n\n' +
      'Claude Code:  claude mcp add prosebind -- prosebind-mcp /path/to/manuscript\n',
  );
  process.exit(0);
}

const root = resolve(args.find((a) => !a.startsWith('-')) ?? process.cwd());

const connection = new Connection(process.stdin, process.stdout);
new ProsebindMcpServer(connection, root);
connection.listen();

process.on('uncaughtException', (error) => {
  process.stderr.write(`prosebind-mcp: uncaught: ${error.stack ?? String(error)}\n`);
});
