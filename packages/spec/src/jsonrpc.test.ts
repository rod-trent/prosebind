import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageReader, encodeMessage } from './jsonrpc.js';

function collect(): { reader: MessageReader; seen: unknown[] } {
  const seen: unknown[] = [];
  return { reader: new MessageReader((m) => seen.push(m)), seen };
}

test('reads a single framed message', () => {
  const { reader, seen } = collect();
  reader.write(encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { jsonrpc: '2.0', id: 1, method: 'initialize' });
});

test('reads several messages arriving in one chunk', () => {
  const { reader, seen } = collect();
  reader.write(
    Buffer.concat([
      encodeMessage({ jsonrpc: '2.0', method: 'a' }),
      encodeMessage({ jsonrpc: '2.0', method: 'b' }),
      encodeMessage({ jsonrpc: '2.0', method: 'c' }),
    ]),
  );
  assert.deepEqual(seen.map((m) => (m as { method: string }).method), ['a', 'b', 'c']);
});

test('reassembles a message split across arbitrary chunk boundaries', () => {
  const full = encodeMessage({ jsonrpc: '2.0', id: 7, method: 'textDocument/hover' });
  // Every possible split point must work — this is the failure mode that shows up as
  // an editor hanging on a large document and nothing else.
  for (let cut = 1; cut < full.length; cut++) {
    const { reader, seen } = collect();
    reader.write(full.subarray(0, cut));
    reader.write(full.subarray(cut));
    assert.equal(seen.length, 1, `split at ${cut} produced ${seen.length} messages`);
    assert.equal((seen[0] as { id: number }).id, 7);
  }
});

test('Content-Length counts bytes, not characters', () => {
  // A naive implementation uses string length and truncates the moment a writer
  // types a character outside ASCII — which, in a manuscript, is immediately.
  const message = { jsonrpc: '2.0', method: 'note', params: { text: 'Elena — "café" … 🕯' } };
  const encoded = encodeMessage(message);
  const header = encoded.subarray(0, encoded.indexOf('\r\n\r\n')).toString('ascii');
  const declared = Number.parseInt(/Content-Length: (\d+)/.exec(header)?.[1] ?? '', 10);
  const bodyBytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
  assert.equal(declared, bodyBytes);

  const { reader, seen } = collect();
  reader.write(encoded);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], message);
});

test('survives a malformed body without dropping later messages', () => {
  const { reader, seen } = collect();
  const body = Buffer.from('{ not json', 'utf8');
  reader.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
  reader.write(encodeMessage({ jsonrpc: '2.0', method: 'after' }));
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { method: string }).method, 'after');
});

test('resynchronises after a header with no Content-Length', () => {
  const { reader, seen } = collect();
  reader.write(Buffer.from('X-Nonsense: 1\r\n\r\n', 'ascii'));
  reader.write(encodeMessage({ jsonrpc: '2.0', method: 'after' }));
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { method: string }).method, 'after');
});

test('tolerates extra headers and header case variation', () => {
  const { reader, seen } = collect();
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'ok' }), 'utf8');
  reader.write(
    Buffer.concat([
      Buffer.from(
        `content-length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`,
        'ascii',
      ),
      body,
    ]),
  );
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { method: string }).method, 'ok');
});
