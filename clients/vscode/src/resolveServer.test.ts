import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { binaryName, resolveServer, type ResolveInput } from './resolveServer.js';

const base: ResolveInput = {
  configured: undefined,
  root: undefined,
  exists: () => false,
  platform: 'linux',
  nodePath: '/opt/vscode/code',
  env: { PATH: '/usr/bin' },
};

test('falls back to PATH when nothing else is available', () => {
  const found = resolveServer(base);
  assert.equal(found.executable.command, 'prosebind-lsp');
  assert.equal(found.origin, 'PATH');
});

test('uses the Windows shim on Windows', () => {
  assert.equal(binaryName('win32'), 'prosebind-lsp.cmd');
  assert.equal(binaryName('darwin'), 'prosebind-lsp');
  const found = resolveServer({ ...base, platform: 'win32' });
  assert.equal(found.executable.command, 'prosebind-lsp.cmd');
});

test('prefers a binary in the workspace node_modules', () => {
  const root = '/home/writer/novel';
  const expected = join(root, 'node_modules', '.bin', 'prosebind-lsp');
  const found = resolveServer({ ...base, root, exists: (p) => p === expected });
  assert.equal(found.executable.command, expected);
  assert.equal(found.origin, 'workspace node_modules');
});

test('finds the in-repo build when working on Prosebind itself', () => {
  const root = '/home/dev/prosebind';
  const expected = join(root, 'packages', 'lsp', 'dist', 'cli.js');
  const found = resolveServer({ ...base, root, exists: (p) => p === expected });
  assert.equal(found.executable.args[0], expected);
  assert.match(found.origin, /this repository/);
});

test('a .js entry point is launched with Node, not the Code binary', () => {
  // In an extension host process.execPath is Code itself. Launching a .js file with
  // it and no ELECTRON_RUN_AS_NODE opens a second editor window instead of a server,
  // which is a genuinely baffling thing to debug.
  const root = '/home/dev/prosebind';
  const script = join(root, 'packages', 'lsp', 'dist', 'cli.js');
  const found = resolveServer({ ...base, root, exists: (p) => p === script });

  assert.equal(found.executable.command, '/opt/vscode/code');
  assert.deepEqual(found.executable.args, [script]);
  assert.equal(found.executable.options?.env['ELECTRON_RUN_AS_NODE'], '1');
  assert.equal(found.executable.options?.env['PATH'], '/usr/bin', 'existing env must survive');
});

test('an explicit setting wins over everything else', () => {
  const root = '/home/writer/novel';
  const local = join(root, 'node_modules', '.bin', 'prosebind-lsp');
  const found = resolveServer({
    ...base,
    root,
    configured: '/usr/local/bin/my-prosebind-lsp',
    exists: (p) => p === local,
  });
  assert.equal(found.executable.command, '/usr/local/bin/my-prosebind-lsp');
  assert.match(found.origin, /setting/);
});

test('an explicit .js setting also gets the Node treatment', () => {
  const found = resolveServer({ ...base, configured: '/home/writer/build/cli.js' });
  assert.equal(found.executable.command, '/opt/vscode/code');
  assert.equal(found.executable.options?.env['ELECTRON_RUN_AS_NODE'], '1');
});

test('a configured path is honoured even if it does not exist yet', () => {
  // The writer may be mid-build. A premature "not found" is more confusing than
  // letting the spawn fail with a real error naming the real path.
  const found = resolveServer({ ...base, configured: '/not/built/yet/prosebind-lsp' });
  assert.equal(found.executable.command, '/not/built/yet/prosebind-lsp');
});

test('surrounding whitespace in the setting is ignored', () => {
  const found = resolveServer({ ...base, configured: '   ' });
  assert.equal(found.origin, 'PATH', 'a blank setting must not become a command');
});
