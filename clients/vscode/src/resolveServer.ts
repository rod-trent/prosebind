import { join } from 'node:path';

/**
 * Deciding how to launch the language server, with no dependency on the VS Code API.
 *
 * Kept pure so it can be tested: this is where the classic "works on the maintainer's
 * machine" bug lives. In an extension host `process.execPath` is the Code binary
 * rather than Node, so a `.js` entry point has to be launched with
 * `ELECTRON_RUN_AS_NODE` set. Nothing about that is discoverable from a stack trace
 * when it is wrong.
 */

export interface LaunchSpec {
  command: string;
  args: string[];
  options?: { env: Record<string, string | undefined> };
}

export interface ServerLocation {
  executable: LaunchSpec;
  /** How we found it, quoted back to the writer when startup fails. */
  origin: string;
}

export interface ResolveInput {
  /** The `prosebind.serverPath` setting, if the writer set one. */
  configured?: string | undefined;
  /** First workspace folder, if any. */
  root?: string | undefined;
  exists: (path: string) => boolean;
  platform: NodeJS.Platform;
  /** `process.execPath` — the Code binary inside an extension host. */
  nodePath: string;
  env: Record<string, string | undefined>;
}

export function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'prosebind-lsp.cmd' : 'prosebind-lsp';
}

function viaBundledNode(script: string, input: ResolveInput): LaunchSpec {
  return {
    command: input.nodePath,
    args: [script],
    options: { env: { ...input.env, ELECTRON_RUN_AS_NODE: '1' } },
  };
}

export function resolveServer(input: ResolveInput): ServerLocation {
  const configured = input.configured?.trim();

  if (configured) {
    // An explicit setting is honoured even if the path does not exist yet — the
    // writer may be mid-build, and a premature "not found" is more confusing than
    // letting the spawn fail with a real error.
    return {
      executable: configured.endsWith('.js')
        ? viaBundledNode(configured, input)
        : { command: configured, args: [] },
      origin: `prosebind.serverPath setting (${configured})`,
    };
  }

  if (input.root) {
    const local = join(input.root, 'node_modules', '.bin', binaryName(input.platform));
    if (input.exists(local)) {
      return { executable: { command: local, args: [] }, origin: 'workspace node_modules' };
    }

    // Working inside the Prosebind monorepo itself. Saves contributors a symlink dance.
    const inRepo = join(input.root, 'packages', 'lsp', 'dist', 'cli.js');
    if (input.exists(inRepo)) {
      return {
        executable: viaBundledNode(inRepo, input),
        origin: 'this repository (packages/lsp/dist)',
      };
    }
  }

  return {
    executable: { command: binaryName(input.platform), args: [] },
    origin: 'PATH',
  };
}
