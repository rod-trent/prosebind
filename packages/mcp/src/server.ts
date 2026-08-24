import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AnalysisResult } from '@prosebind/core';
import { Session } from '@prosebind/daemon';
import { Connection, ErrorCodes, RpcError } from '@prosebind/spec';
import {
  INSTRUCTIONS,
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  type InitializeResult,
  type ResourceContents,
  type ResourceDefinition,
  type ToolResult,
} from './protocol.js';
import { TOOLS, toolByName, type ToolContext } from './tools.js';

const BIBLE_FILES = [
  'characters.yaml',
  'places.yaml',
  'objects.yaml',
  'organizations.yaml',
  'timeline.yaml',
  'meta.yaml',
] as const;

/**
 * Exposes the continuity graph over MCP.
 *
 * The same engine the language server drives, addressed conversationally instead of
 * through an editor: DESIGN.md § 5's second front door. Roughly five percent additional
 * work over the LSP server, for a second audience.
 *
 * Every tool is read-only. An agent may read a writer's canon; it may not edit their
 * manuscript, and it may not suppress a finding on their behalf — that is a judgement
 * about their own intent.
 */
export class ProsebindMcpServer {
  private session: Session | undefined;
  private latest: AnalysisResult | undefined;
  private ready: Promise<void> = Promise.resolve();
  private initialised = false;

  constructor(
    private readonly connection: Connection,
    private readonly root: string,
  ) {
    this.register();
  }

  private register(): void {
    const c = this.connection;

    c.onRequest('initialize', (params) => this.initialize(params));
    c.onNotification('notifications/initialized', () => {
      /* nothing to do; loading already started */
    });
    c.onNotification('initialized', () => {
      /* older clients */
    });

    c.onRequest('ping', () => ({}));

    c.onRequest('tools/list', async () => {
      await this.ready;
      return { tools: TOOLS.map((tool) => tool.definition) };
    });

    c.onRequest('tools/call', async (params) => this.callTool(params));

    c.onRequest('resources/list', async () => {
      await this.ready;
      return { resources: await this.resources() };
    });

    c.onRequest('resources/read', async (params) => {
      await this.ready;
      return { contents: await this.readResource(params) };
    });

    // Declared but empty: clients probe these, and an error reads as a broken server.
    c.onRequest('prompts/list', () => ({ prompts: [] }));
    c.onRequest('resources/templates/list', () => ({ resourceTemplates: [] }));
  }

  private initialize(params: unknown): InitializeResult {
    const p = params as { protocolVersion?: string } | undefined;
    const asked = p?.protocolVersion;

    // Echo a version we genuinely implement rather than mirroring theirs. Claiming to
    // speak a revision we do not is how subtle incompatibilities begin.
    const version =
      asked && (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSION;

    if (!this.initialised) {
      this.initialised = true;
      this.ready = this.load();
    }

    return {
      protocolVersion: version,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'prosebind-mcp', version: '0.0.0' },
      instructions: INSTRUCTIONS,
    };
  }

  private async load(): Promise<void> {
    this.session = await Session.open(this.root);
    this.latest = await this.session.loadAll();
  }

  private context(): ToolContext {
    const session = this.session;
    if (!session) throw new RpcError(ErrorCodes.ServerNotInitialized, 'Project is still loading.');
    return {
      session,
      root: this.root,
      result: () => this.latest ?? { diagnostics: [], stats: emptyStats() },
      refresh: async () => {
        this.latest = await session.loadAll();
        return this.latest;
      },
    };
  }

  private async callTool(params: unknown): Promise<ToolResult> {
    await this.ready;
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const name = p?.name;
    if (!name) throw new RpcError(ErrorCodes.InvalidParams, 'tools/call needs a "name".');

    const tool = toolByName(name);
    if (!tool) {
      const known = TOOLS.map((t) => t.definition.name).join(', ');
      throw new RpcError(ErrorCodes.MethodNotFound, `No tool "${name}". Available: ${known}`);
    }

    try {
      return await tool.run(p?.arguments ?? {}, this.context());
    } catch (error) {
      // A failing tool is a result the model can reason about, not a transport error.
      // Throwing here would abort the whole call; returning isError lets it recover.
      return {
        content: [{ type: 'text', text: `${name} failed: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }

  private async resources(): Promise<ResourceDefinition[]> {
    const found: ResourceDefinition[] = [];

    for (const file of BIBLE_FILES) {
      const path = join(this.root, '.prosebind', 'bible', file);
      try {
        await readFile(path, 'utf8');
      } catch {
        continue;
      }
      found.push({
        uri: `prosebind://bible/${file}`,
        name: `Bible — ${file}`,
        description: `Canon declared by the writer in .prosebind/bible/${file}. Authoritative: it outranks anything inferred from the prose.`,
        mimeType: 'application/yaml',
      });
    }

    for (const [path] of this.session?.documents ?? []) {
      const rel = relative(this.root, path).split('\\').join('/');
      found.push({
        uri: `prosebind://manuscript/${rel}`,
        name: rel,
        description: 'Manuscript file.',
        mimeType: 'text/markdown',
      });
    }

    found.push({
      uri: 'prosebind://report',
      name: 'Continuity report',
      description: 'Every open finding, with evidence. The same analysis the editor plugins display.',
      mimeType: 'text/plain',
    });

    return found;
  }

  private async readResource(params: unknown): Promise<ResourceContents[]> {
    const uri = (params as { uri?: string } | undefined)?.uri;
    if (!uri) throw new RpcError(ErrorCodes.InvalidParams, 'resources/read needs a "uri".');

    if (uri === 'prosebind://report') {
      const tool = toolByName('list_findings');
      const result = await tool?.run({}, this.context());
      return [{ uri, mimeType: 'text/plain', text: result?.content[0]?.text ?? '' }];
    }

    if (uri.startsWith('prosebind://bible/')) {
      const file = uri.slice('prosebind://bible/'.length);
      // Contain the read to the bible directory; a uri is untrusted input.
      if (!(BIBLE_FILES as readonly string[]).includes(file)) {
        throw new RpcError(ErrorCodes.InvalidParams, `Not a bible file: ${file}`);
      }
      const text = await readFile(join(this.root, '.prosebind', 'bible', file), 'utf8');
      return [{ uri, mimeType: 'application/yaml', text }];
    }

    if (uri.startsWith('prosebind://manuscript/')) {
      const wanted = uri.slice('prosebind://manuscript/'.length);
      for (const [path, doc] of this.session?.documents ?? []) {
        if (relative(this.root, path).split('\\').join('/') === wanted) {
          return [{ uri, mimeType: 'text/markdown', text: doc.text }];
        }
      }
      throw new RpcError(ErrorCodes.InvalidParams, `No manuscript file: ${wanted}`);
    }

    throw new RpcError(ErrorCodes.InvalidParams, `Unrecognised resource: ${uri}`);
  }
}

function emptyStats(): AnalysisResult['stats'] {
  return { documents: 0, segments: 0, segmentsAnalysed: 0, words: 0, durationMs: 0 };
}
