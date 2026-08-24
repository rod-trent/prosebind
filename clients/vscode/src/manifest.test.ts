import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * Keeps `package.json` and the extension source honest about each other.
 *
 * A command declared in the manifest but never registered shows up in the palette and
 * fails when clicked. One registered but never declared is invisible. A setting
 * declared but never read does nothing at all. All three are silent, all three are
 * easy to introduce, and none of them are caught by the type checker.
 *
 * Full activation cannot be tested here — `vscode-languageclient` needs a real
 * extension host — so this checks the part that can be checked without pretending.
 */

// This package compiles to CommonJS, so __dirname is the portable choice here.
const extensionRoot = resolve(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')) as {
  main: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    configuration: { properties: Record<string, { type: string; default?: unknown }> };
  };
};

const source = readFileSync(join(extensionRoot, 'src', 'extension.ts'), 'utf8');

function registeredCommands(): string[] {
  return [...source.matchAll(/registerCommand\(\s*'([^']+)'/g)].map((m) => m[1]!);
}

test('every command in the manifest is registered in code', () => {
  const registered = new Set(registeredCommands());
  for (const { command } of manifest.contributes.commands) {
    assert.ok(registered.has(command), `"${command}" is in the palette but never registered`);
  }
});

test('every registered command is declared in the manifest', () => {
  const declared = new Set(manifest.contributes.commands.map((c) => c.command));
  for (const command of registeredCommands()) {
    assert.ok(declared.has(command), `"${command}" is registered but invisible to the user`);
  }
});

test('every command is namespaced and has a category', () => {
  for (const command of manifest.contributes.commands) {
    assert.match(command.command, /^prosebind\./, 'commands must be namespaced');
    assert.equal(command.category, 'Prosebind', `${command.command} needs a palette category`);
    assert.ok(command.title.length > 0);
  }
});

test('every declared setting is actually read', () => {
  const keys = Object.keys(manifest.contributes.configuration.properties);
  assert.ok(keys.length > 0);

  for (const key of keys) {
    const short = key.replace(/^prosebind\./, '');
    assert.match(key, /^prosebind\./, 'settings must be namespaced');
    // Read either by the extension itself or by the server-path resolver.
    const readSomewhere =
      source.includes(`'${short}'`) ||
      readFileSync(join(extensionRoot, 'src', 'serverPath.ts'), 'utf8').includes(`'${short}'`);
    assert.ok(readSomewhere, `setting "${key}" is declared but never read`);
  }
});

test('settings defaults match what the server expects', () => {
  const props = manifest.contributes.configuration.properties;
  // The server's own defaults, from packages/lsp/src/server.ts.
  assert.equal(props['prosebind.debounceMs']?.default, 900, 'must match the server default');
  assert.equal(props['prosebind.severityFloor']?.default, 'note', 'must match the server default');
});

test('the extension ships the bundle, not the raw compile output', () => {
  // dist/ is build input and test output; only bundle/ is packaged. Pointing main at
  // dist/ produces an extension that works locally and breaks for everyone else,
  // because vscode-languageclient would not be included.
  assert.match(manifest.main, /^\.\/bundle\//, 'main must point at the esbuild bundle');
});

test('activation is scoped to projects that actually use Prosebind', () => {
  // Activating on every markdown file would put this extension in the startup path of
  // every note-taking workspace on the machine.
  assert.ok(
    manifest.activationEvents.some((event) => event.includes('.prosebind')),
    'activate only where a continuity bible exists',
  );
  assert.ok(
    !manifest.activationEvents.includes('*'),
    'never activate unconditionally',
  );
});
