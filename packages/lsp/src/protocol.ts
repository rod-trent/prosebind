/**
 * The slice of LSP 3.17 that Prosebind actually implements.
 *
 * Written out rather than imported so the package carries no dependencies, and so a
 * reader can see the entire protocol surface this server exposes in one file.
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export type DiagnosticSeverityValue = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface LspDiagnostic {
  range: Range;
  severity: DiagnosticSeverityValue;
  code?: string | undefined;
  source: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[] | undefined;
  /** Carried through to code actions so they need no recomputation. */
  data?: unknown | undefined;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentItem extends TextDocumentIdentifier {
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface Command {
  title: string;
  command: string;
  arguments?: unknown[] | undefined;
}

export const CodeActionKind = {
  QuickFix: 'quickfix',
  Refactor: 'refactor',
  Source: 'source',
} as const;

export interface CodeAction {
  title: string;
  kind?: string | undefined;
  diagnostics?: LspDiagnostic[] | undefined;
  command?: Command | undefined;
  isPreferred?: boolean | undefined;
}

export const SymbolKind = {
  File: 1,
  Namespace: 3,
  Class: 5,
  Method: 6,
  Property: 7,
  Constructor: 9,
  Enum: 10,
  Function: 12,
  Variable: 13,
  Constant: 14,
  String: 15,
  Number: 16,
  Object: 19,
  Key: 20,
  Event: 24,
  Operator: 25,
} as const;

export type SymbolKindValue = (typeof SymbolKind)[keyof typeof SymbolKind];

export interface DocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: SymbolKindValue;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[] | undefined;
}

export interface WorkspaceSymbol {
  name: string;
  kind: SymbolKindValue;
  containerName?: string | undefined;
  location: Location;
}

export interface Hover {
  contents: { kind: 'markdown' | 'plaintext'; value: string };
  range?: Range | undefined;
}

export const TextDocumentSyncKind = {
  None: 0,
  Full: 1,
  Incremental: 2,
} as const;

/**
 * Commands the client may invoke.
 *
 * These are the code actions from DESIGN.md § 5. `suppress` is the load-bearing one:
 * every finding must be dismissible permanently in one gesture, or the tool becomes an
 * argument the writer cannot win.
 */
export const COMMANDS = {
  suppress: 'prosebind.suppress',
  promoteToCanon: 'prosebind.promoteToCanon',
  recheck: 'prosebind.recheck',
} as const;

/** Payload we attach to every diagnostic, so code actions need no lookup. */
export interface DiagnosticData {
  check: string;
  suppressionKey: string;
  confidence: number;
  entityId?: string | undefined;
  predicate?: string | undefined;
  observed?: string | undefined;
}
