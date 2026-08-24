import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Connection, MessageReader, encodeMessage } from '@prosebind/spec';
import { DiagnosticSeverity, type LspDiagnostic } from './protocol.js';
import { ProsebindServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(here, '..', '..', '..', 'examples', 'the-quarry');

/** Drives the real server over a real framed connection, as an editor would. */
class TestClient {
  private readonly toServer = new PassThrough();
  private readonly fromServer = new PassThrough();
  private readonly received: Array<Record<string, unknown>> = [];
  private nextId = 1;

  constructor() {
    const connection = new Connection(this.toServer, this.fromServer);
    new ProsebindServer(connection);
    connection.listen();

    const reader = new MessageReader((message) => {
      this.received.push(message as Record<string, unknown>);
    });
    this.fromServer.on('data', (chunk: Buffer) => reader.write(chunk));
  }

  notify(method: string, params?: unknown): void {
    this.toServer.write(encodeMessage({ jsonrpc: '2.0', method, params }));
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.toServer.write(encodeMessage({ jsonrpc: '2.0', id, method, params }));
    const response = await this.waitFor((m) => m['id'] === id && ('result' in m || 'error' in m));
    if ('error' in response) throw new Error(JSON.stringify(response['error']));
    return response['result'];
  }

  async waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs = 8000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for a message; saw: ${this.received.map((m) => m['method'] ?? `#${m['id']}`).join(', ')}`,
        );
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** Diagnostics most recently published for a file. */
  diagnosticsFor(path: string): LspDiagnostic[] | undefined {
    const uri = pathToFileURL(path).toString();
    const matching = this.received.filter(
      (m) => m['method'] === 'textDocument/publishDiagnostics' && (m['params'] as { uri: string }).uri === uri,
    );
    const last = matching[matching.length - 1];
    return last ? ((last['params'] as { diagnostics: LspDiagnostic[] }).diagnostics) : undefined;
  }

  async handshake(root: string): Promise<void> {
    await this.request('initialize', {
      rootUri: pathToFileURL(root).toString(),
      capabilities: {},
      initializationOptions: { debounceMs: 10 },
    });
    this.notify('initialized', {});
  }
}

test('initialize advertises the capabilities DESIGN.md § 5 promises', async () => {
  const client = new TestClient();
  const result = (await client.request('initialize', {
    rootUri: pathToFileURL(EXAMPLE).toString(),
    capabilities: {},
  })) as { capabilities: Record<string, unknown>; serverInfo: { name: string } };

  const caps = result.capabilities;
  assert.equal(result.serverInfo.name, 'prosebind-lsp');
  assert.ok(caps['hoverProvider'], 'hover: the entity card');
  assert.ok(caps['definitionProvider'], 'definition: where a character first appears');
  assert.ok(caps['referencesProvider'], 'references: every scene they are in');
  assert.ok(caps['documentSymbolProvider'], 'document symbols: chapters and scenes');
  assert.ok(caps['workspaceSymbolProvider'], 'workspace symbols: the bible, browsable');
  assert.ok(caps['codeActionProvider'], 'code actions: mark intentional');
  const commands = (caps['executeCommandProvider'] as { commands: string[] }).commands;
  assert.ok(commands.includes('prosebind.suppress'));
});

test('publishes continuity diagnostics for the worked example on load', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);

  const ch03 = join(EXAMPLE, 'ch03.md');
  await client.waitFor(
    (m) =>
      m['method'] === 'textDocument/publishDiagnostics' &&
      (m['params'] as { uri: string }).uri === pathToFileURL(ch03).toString() &&
      (m['params'] as { diagnostics: unknown[] }).diagnostics.length > 0,
  );

  const diagnostics = client.diagnosticsFor(ch03) ?? [];
  const codes = diagnostics.map((d) => d.code);
  assert.ok(codes.includes('deceased-active'), `expected deceased-active, got ${codes.join(', ')}`);
  assert.ok(codes.includes('attribute-contradiction'));
  assert.ok(codes.includes('age-arithmetic'));

  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.source, 'prosebind');
    // Prose is not a failing build. Nothing here may ever be an Error.
    assert.notEqual(diagnostic.severity, DiagnosticSeverity.Error);
  }
});

test('a cross-file finding carries related information pointing at the other file', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);

  const ch03 = join(EXAMPLE, 'ch03.md');
  await client.waitFor(
    (m) =>
      m['method'] === 'textDocument/publishDiagnostics' &&
      (m['params'] as { uri: string }).uri === pathToFileURL(ch03).toString() &&
      (m['params'] as { diagnostics: unknown[] }).diagnostics.length > 0,
  );

  const dead = (client.diagnosticsFor(ch03) ?? []).find((d) => d.code === 'deceased-active');
  assert.ok(dead, 'deceased-active should be reported');
  assert.ok(dead.relatedInformation && dead.relatedInformation.length > 0);
  assert.match(dead.relatedInformation[0]!.location.uri, /ch02\.md$/);
});

test('hover over a character returns an entity card', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);
  const ch01 = join(EXAMPLE, 'ch01.md');
  const text = await readFile(ch01, 'utf8');
  client.notify('textDocument/didOpen', {
    textDocument: { uri: pathToFileURL(ch01).toString(), languageId: 'markdown', version: 1, text },
  });

  // Position of the first "Elena" in chapter one.
  const offset = text.indexOf('Elena');
  const upto = text.slice(0, offset);
  const line = upto.split('\n').length - 1;
  const character = offset - (upto.lastIndexOf('\n') + 1);

  const hover = (await client.request('textDocument/hover', {
    textDocument: { uri: pathToFileURL(ch01).toString() },
    position: { line, character },
  })) as { contents: { value: string } } | null;

  assert.ok(hover, 'expected a hover result over a known character');
  assert.match(hover.contents.value, /Elena Vasquez/);
  assert.match(hover.contents.value, /canon/);
  assert.match(hover.contents.value, /grey/);
});

test('references returns every mention of a character across the project', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);
  const ch01 = join(EXAMPLE, 'ch01.md');
  const text = await readFile(ch01, 'utf8');
  const offset = text.indexOf('Marcus');
  const upto = text.slice(0, offset);

  const locations = (await client.request('textDocument/references', {
    textDocument: { uri: pathToFileURL(ch01).toString() },
    position: { line: upto.split('\n').length - 1, character: offset - (upto.lastIndexOf('\n') + 1) },
    context: { includeDeclaration: true },
  })) as Array<{ uri: string }> | null;

  assert.ok(locations && locations.length > 1, 'Marcus appears in more than one place');
  assert.ok(locations.some((l) => l.uri.endsWith('ch03.md')), 'including the chapter where he should not');
});

test('every finding offers a one-gesture permanent dismissal', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);
  const ch03 = join(EXAMPLE, 'ch03.md');
  await client.waitFor(
    (m) =>
      m['method'] === 'textDocument/publishDiagnostics' &&
      (m['params'] as { uri: string }).uri === pathToFileURL(ch03).toString() &&
      (m['params'] as { diagnostics: unknown[] }).diagnostics.length > 0,
  );
  const diagnostics = client.diagnosticsFor(ch03) ?? [];

  const actions = (await client.request('textDocument/codeAction', {
    textDocument: { uri: pathToFileURL(ch03).toString() },
    range: diagnostics[0]!.range,
    context: { diagnostics: [diagnostics[0]!] },
  })) as Array<{ title: string; command?: { command: string; arguments?: unknown[] } }>;

  const suppress = actions.find((a) => a.command?.command === 'prosebind.suppress');
  assert.ok(suppress, 'a writer must be able to dismiss any finding permanently');
  const arg = suppress.command?.arguments?.[0] as { key: string };
  assert.ok(arg.key.length > 0);
  assert.ok(actions.some((a) => (a.command?.arguments?.[0] as { key: string })?.key?.endsWith('/*')),
    'and silence the whole check');
});

test('document symbols expose the manuscript structure', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);
  const ch01 = join(EXAMPLE, 'ch01.md');
  const text = await readFile(ch01, 'utf8');
  client.notify('textDocument/didOpen', {
    textDocument: { uri: pathToFileURL(ch01).toString(), languageId: 'markdown', version: 1, text },
  });

  const symbols = (await client.request('textDocument/documentSymbol', {
    textDocument: { uri: pathToFileURL(ch01).toString() },
  })) as Array<{ name: string; detail?: string; children?: unknown[] }>;

  assert.ok(symbols.length >= 1);
  assert.equal(symbols[0]?.name, 'One');
  assert.match(symbols[0]?.detail ?? '', /words/);
});

test('workspace symbols make the bible browsable', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);

  const symbols = (await client.request('workspace/symbol', { query: '' })) as Array<{
    name: string;
    containerName?: string;
  }>;

  assert.ok(symbols.some((s) => s.name === 'Elena Vasquez'));
  assert.ok(symbols.some((s) => s.name === 'Marcus is buried'), 'timeline events too');
});

test('unknown methods are refused without killing the connection', async () => {
  const client = new TestClient();
  await client.handshake(EXAMPLE);
  await assert.rejects(() => client.request('textDocument/somethingInvented', {}), /-32601|Unhandled/);
  // The connection must still work afterwards.
  const symbols = await client.request('workspace/symbol', { query: 'Elena' });
  assert.ok(Array.isArray(symbols));
});
