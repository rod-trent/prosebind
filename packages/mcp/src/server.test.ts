import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Connection, MessageReader, encodeMessage } from '@prosebind/spec';
import { ProsebindMcpServer } from './server.js';
import { TOOLS } from './tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(here, '..', '..', '..', 'examples', 'the-quarry');

/** Drives the real server over a real framed connection, as an MCP client would. */
class TestClient {
  private readonly toServer = new PassThrough();
  private readonly fromServer = new PassThrough();
  private readonly received: Array<Record<string, unknown>> = [];
  private nextId = 1;

  constructor(root = EXAMPLE) {
    const connection = new Connection(this.toServer, this.fromServer);
    new ProsebindMcpServer(connection, root);
    connection.listen();
    const reader = new MessageReader((m) => this.received.push(m as Record<string, unknown>));
    this.fromServer.on('data', (chunk: Buffer) => reader.write(chunk));
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.toServer.write(encodeMessage({ jsonrpc: '2.0', id, method, params }));
    const deadline = Date.now() + 15000;
    for (;;) {
      const found = this.received.find((m) => m['id'] === id && ('result' in m || 'error' in m));
      if (found) {
        if ('error' in found) throw new Error(JSON.stringify(found['error']));
        return found['result'];
      }
      if (Date.now() > deadline) throw new Error(`timed out on ${method}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async handshake(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    this.toServer.write(encodeMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean | undefined }> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
  }
}

test('initialize returns capabilities and the usage guardrails', async () => {
  const client = new TestClient();
  const result = (await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
  })) as { protocolVersion: string; capabilities: Record<string, unknown>; instructions: string; serverInfo: { name: string } };

  assert.equal(result.serverInfo.name, 'prosebind-mcp');
  assert.ok(result.capabilities['tools']);
  assert.ok(result.capabilities['resources']);
  // The instructions are the only place we can tell a model what this is for before
  // it starts working. DESIGN.md § 10 must survive the trip.
  assert.match(result.instructions, /never writes prose/i);
  assert.match(result.instructions, /canon/);
  assert.match(result.instructions, /read-only/i);
});

test('negotiates a protocol version it actually implements', async () => {
  const supported = (await new TestClient().request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
  })) as { protocolVersion: string };
  assert.equal(supported.protocolVersion, '2024-11-05', 'an older supported revision is honoured');

  const unknown = (await new TestClient().request('initialize', {
    protocolVersion: '1999-01-01',
    capabilities: {},
  })) as { protocolVersion: string };
  assert.equal(unknown.protocolVersion, '2025-06-18', 'an unknown revision falls back to ours, not theirs');
});

test('every tool is read-only', async () => {
  // An agent may read a writer's canon. It must not be able to edit their manuscript
  // or suppress a finding on their behalf — that is a judgement about their intent.
  for (const tool of TOOLS) {
    assert.doesNotMatch(
      tool.definition.name,
      /write|edit|suppress|delete|set_|update|create/,
      `"${tool.definition.name}" sounds like it mutates something`,
    );
  }
});

test('tools/list advertises usable schemas', async () => {
  const client = new TestClient();
  await client.handshake();
  const result = (await client.request('tools/list')) as {
    tools: Array<{ name: string; description: string; inputSchema: { type: string; required?: string[] } }>;
  };

  assert.equal(result.tools.length, TOOLS.length);
  for (const tool of result.tools) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a description a model can act on`);
    assert.equal(tool.inputSchema.type, 'object');
  }
  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes('list_findings'));
  assert.ok(names.includes('describe_entity'));
});

test('list_findings returns the worked example findings with evidence', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text } = await client.call('list_findings');

  assert.match(text, /deceased-active/);
  assert.match(text, /attribute-contradiction/);
  assert.match(text, /conflicts with/, 'cross-file evidence must survive');
  assert.match(text, /confidence/);
});

test('list_findings filters by severity', async () => {
  const client = new TestClient();
  await client.handshake();
  const all = await client.call('list_findings');
  const hard = await client.call('list_findings', { severity: 'contradiction' });
  assert.ok(hard.text.length < all.text.length);
  assert.doesNotMatch(hard.text, /^QUESTION/m);
});

test('describe_entity distinguishes canon from inference', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text } = await client.call('describe_entity', { name: 'Elena' });

  assert.match(text, /Elena Vasquez/);
  assert.match(text, /grey/);
  assert.match(text, /\[canon/, 'the tier must be visible, or a model will treat guesses as established');
});

test('describe_entity names what it knows when asked for something unknown', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text, isError } = await client.call('describe_entity', { name: 'Napoleon' });
  assert.equal(isError, true);
  assert.match(text, /Elena Vasquez/, 'an error should say what is available');
});

test('find_mentions locates a character across files', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text } = await client.call('find_mentions', { name: 'Marcus' });
  assert.match(text, /ch01\.md:\d+/);
  assert.match(text, /ch03\.md:\d+/);
  assert.match(text, /speaking/);
});

test('timeline reports how each event is pinned', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text } = await client.call('timeline');
  assert.match(text, /Marcus is buried/);
  assert.match(text, /pinned by quote|pinned by chapter/);
});

test('outline exposes chapters and word counts', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text } = await client.call('outline');
  assert.match(text, /words total/);
  assert.match(text, /ch01\.md/);
});

test('established_before is honest about what it cannot answer', async () => {
  const client = new TestClient();
  await client.handshake();
  const { text } = await client.call('established_before', { file: 'ch03.md' });

  assert.match(text, /Events that have happened/);
  assert.match(text, /Characters the reader has met/);
  // Per-character knowledge is v1.5. Claiming otherwise would invite a model to
  // invent an answer to the exact question DESIGN.md § 9 says we cannot yet answer.
  assert.match(text, /not per-character knowledge|does not yet track/i);
});

test('an unknown tool is refused with the list of real ones', async () => {
  const client = new TestClient();
  await client.handshake();
  await assert.rejects(
    () => client.request('tools/call', { name: 'write_chapter', arguments: {} }),
    /No tool|Available/,
  );
});

test('a failing tool returns an error result rather than killing the call', async () => {
  const client = new TestClient();
  await client.handshake();
  const { isError, text } = await client.call('find_mentions', { name: '' });
  assert.equal(isError, true);
  assert.ok(text.length > 0);
});

test('resources expose the bible and a continuity report', async () => {
  const client = new TestClient();
  await client.handshake();
  const listed = (await client.request('resources/list')) as {
    resources: Array<{ uri: string; mimeType: string }>;
  };

  const uris = listed.resources.map((r) => r.uri);
  assert.ok(uris.includes('prosebind://bible/characters.yaml'));
  assert.ok(uris.includes('prosebind://report'));
  assert.ok(uris.some((u) => u.startsWith('prosebind://manuscript/')));

  const bible = (await client.request('resources/read', { uri: 'prosebind://bible/characters.yaml' })) as {
    contents: Array<{ text: string; mimeType: string }>;
  };
  assert.match(bible.contents[0]!.text, /Elena Vasquez/);
  assert.equal(bible.contents[0]!.mimeType, 'application/yaml');
});

test('resource reads cannot escape the bible directory', async () => {
  // The uri is untrusted input. A traversal here would hand an agent arbitrary files
  // from the writer's machine.
  const client = new TestClient();
  await client.handshake();
  for (const uri of [
    'prosebind://bible/../../../etc/passwd',
    'prosebind://bible/../suppress.yaml',
    'prosebind://manuscript/../.prosebind/bible/characters.yaml',
  ]) {
    await assert.rejects(() => client.request('resources/read', { uri }), /Not a bible file|No manuscript file/);
  }
});

test('ping answers, so clients can health-check', async () => {
  const client = new TestClient();
  await client.handshake();
  assert.deepEqual(await client.request('ping'), {});
});

test('prompts/list answers empty rather than erroring', async () => {
  // Clients probe this on connect; an error reads as a broken server.
  const client = new TestClient();
  await client.handshake();
  assert.deepEqual(await client.request('prompts/list'), { prompts: [] });
});
