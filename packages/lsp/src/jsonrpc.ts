import type { Readable, Writable } from 'node:stream';

/**
 * Minimal JSON-RPC 2.0 over the LSP base protocol.
 *
 * Hand-rolled rather than pulled from a library: the framing is a header block and a
 * byte count, the surface we need is small, and Prosebind has to ship as one binary to
 * people who do not have a toolchain. Every dependency here is a dependency in that
 * binary.
 *
 * The one rule that matters: **stdout carries the protocol**. Anything written there
 * that is not a framed message corrupts the stream and the editor disconnects. All
 * logging goes to stderr, always.
 */

export type RequestId = number | string;

export interface RequestMessage {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface NotificationMessage {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface ResponseError {
  code: number;
  message: string;
  data?: unknown;
}

/** Subset of the JSON-RPC error codes, plus the LSP-specific ones we raise. */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  RequestCancelled: -32800,
} as const;

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
export type NotificationHandler = (params: unknown) => void | Promise<void>;

const HEADER_TERMINATOR = '\r\n\r\n';

/**
 * Reads framed messages off a stream.
 *
 * Kept separate from the connection so the framing can be tested without stdio: this
 * is the layer where a subtle bug shows up as an editor mysteriously disconnecting,
 * which is not a thing anyone enjoys debugging through a client.
 */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (message: unknown) => void) {}

  /** Feed bytes in. Emits zero or more complete messages. */
  write(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR);
      if (headerEnd === -1) return;

      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const length = contentLength(header);
      if (length === undefined) {
        // Unrecoverable: we cannot know where this message ends, so we cannot find
        // the start of the next one. Drop the header and resynchronise.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_TERMINATOR.length);
        continue;
      }

      const bodyStart = headerEnd + HEADER_TERMINATOR.length;
      if (this.buffer.length < bodyStart + length) return; // wait for more bytes

      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);

      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // A malformed body is the peer's problem; staying alive is ours.
        process.stderr.write('prosebind-lsp: dropped a message that was not valid JSON\n');
      }
    }
  }
}

function contentLength(header: string): number | undefined {
  for (const line of header.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue;
    const value = Number.parseInt(line.slice(colon + 1).trim(), 10);
    return Number.isNaN(value) ? undefined : value;
  }
  return undefined;
}

export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_TERMINATOR}`, 'ascii'), body]);
}

/** A live JSON-RPC connection with handler registration. */
export class Connection {
  private readonly requests = new Map<string, RequestHandler>();
  private readonly notifications = new Map<string, NotificationHandler>();
  private readonly cancelled = new Set<string>();
  private readonly reader: MessageReader;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {
    this.reader = new MessageReader((message) => void this.dispatch(message));
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requests.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notifications.set(method, handler);
  }

  listen(): void {
    this.input.on('data', (chunk: Buffer) => this.reader.write(chunk));
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params } satisfies NotificationMessage);
  }

  private send(message: unknown): void {
    this.output.write(encodeMessage(message));
  }

  private respond(id: RequestId, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  private respondError(id: RequestId, error: ResponseError): void {
    this.send({ jsonrpc: '2.0', id, error });
  }

  private async dispatch(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const record = message as Record<string, unknown>;
    const method = typeof record['method'] === 'string' ? record['method'] : undefined;
    if (!method) return; // a response to something we sent; we issue no requests yet

    const id = record['id'] as RequestId | undefined;

    if (method === '$/cancelRequest') {
      const params = record['params'] as { id?: RequestId } | undefined;
      if (params?.id !== undefined) this.cancelled.add(String(params.id));
      return;
    }

    if (id === undefined) {
      const handler = this.notifications.get(method);
      if (!handler) return; // unknown notifications are ignored, per spec
      try {
        await handler(record['params']);
      } catch (error) {
        process.stderr.write(`prosebind-lsp: ${method} failed: ${(error as Error).message}\n`);
      }
      return;
    }

    const handler = this.requests.get(method);
    if (!handler) {
      this.respondError(id, { code: ErrorCodes.MethodNotFound, message: `Unhandled method ${method}` });
      return;
    }

    try {
      const result = await handler(record['params']);
      if (this.cancelled.delete(String(id))) {
        this.respondError(id, { code: ErrorCodes.RequestCancelled, message: 'Cancelled' });
        return;
      }
      this.respond(id, result ?? null);
    } catch (error) {
      if (error instanceof RpcError) {
        this.respondError(id, { code: error.code, message: error.message, data: error.data });
      } else {
        process.stderr.write(`prosebind-lsp: ${method} threw: ${(error as Error).stack ?? String(error)}\n`);
        this.respondError(id, { code: ErrorCodes.InternalError, message: (error as Error).message });
      }
    }
  }
}
