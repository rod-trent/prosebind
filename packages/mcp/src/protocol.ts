/**
 * The slice of the Model Context Protocol that Prosebind implements.
 *
 * MCP is JSON-RPC 2.0 over stdio, which means the transport in `@prosebind/spec`
 * carries it unchanged — the same framing that serves LSP. Written out rather than
 * imported so this package stays dependency-free and a reader can see the whole
 * surface in one file.
 */

/**
 * Protocol revision we implement. Clients send their own in `initialize`; we echo a
 * version we actually support rather than mirroring theirs back, because claiming to
 * speak a revision we do not is how subtle incompatibilities start.
 */
export const PROTOCOL_VERSION = '2025-06-18';

/** Older revision still in wide use; accepted on the way in. */
export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface ToolDefinition {
  name: string;
  /** Shown to the model. This is prompt text, and it is worth writing as such. */
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceContents {
  uri: string;
  mimeType: string;
  text: string;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  };
  serverInfo: { name: string; version: string };
  instructions?: string;
}

/**
 * Sent to the model on connect.
 *
 * Doubles as a guardrail. An agent handed a continuity graph will otherwise reach for
 * it as raw material for generating prose, and DESIGN.md § 10 is unambiguous that
 * Prosebind never fills the page. Saying so here is the only place we can say it
 * before the model starts working.
 */
export const INSTRUCTIONS = `Prosebind exposes a continuity graph for a manuscript in progress: who exists, what is
established about them, when things happen, and where the story currently contradicts
itself.

Every tool here is read-only. Nothing in this server writes to the manuscript or to the
writer's bible.

Two things to hold onto when using it:

- Prosebind never writes prose, and neither should you on its behalf. These tools are
  for answering questions about the manuscript, not for drafting it. If the writer asks
  for continuity analysis, give them analysis.
- Facts carry a tier. "canon" was pinned by the writer and is authoritative. "inferred"
  was extracted from the prose and may be wrong. Say which you are relying on, and
  never present an inferred fact as though the writer had established it.

Deliberate inconsistency is normal fiction — unreliable narrators, characters who lie,
information withheld from the reader. A finding is a question worth asking, not proof
of an error.`;
