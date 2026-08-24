/**
 * @prosebind/lsp — continuity language server.
 *
 * AGPL, not Apache: this package embeds @prosebind/core, so the combined work carries
 * the engine's licence. The permissive half of the split (DESIGN.md § 13) is
 * @prosebind/spec and the editor clients, which speak the protocol without linking
 * the engine.
 */
export { Connection, MessageReader, encodeMessage, ErrorCodes, RpcError } from './jsonrpc.js';
export { ProsebindServer } from './server.js';
export { Workspace } from './workspace.js';
export { toLspDiagnostic, severityFor, passesFloor, pathToUri, uriToPath } from './convert.js';
export type { SeverityFloor } from './convert.js';
export * from './protocol.js';
