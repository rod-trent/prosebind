/**
 * @prosebind/mcp — the continuity graph, exposed over the Model Context Protocol.
 *
 * AGPL, not Apache: this package embeds @prosebind/core, so the combined work carries
 * the engine's licence. See NOTICE.
 */
export { ProsebindMcpServer } from './server.js';
export { TOOLS, toolByName } from './tools.js';
export type { Tool, ToolContext } from './tools.js';
export { PROTOCOL_VERSION, SUPPORTED_VERSIONS, INSTRUCTIONS } from './protocol.js';
export type { ToolDefinition, ToolResult, ResourceDefinition } from './protocol.js';
