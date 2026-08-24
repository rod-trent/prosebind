import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * Obsidian has its own packaging rules, and it enforces none of them at build time —
 * a malformed manifest simply means the plugin never appears, with no error anywhere
 * a writer would look.
 */

const root = resolve(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  isDesktopOnly: boolean;
};

const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
const settings = readFileSync(join(root, 'src', 'settings.ts'), 'utf8');

test('manifest has every field Obsidian requires', () => {
  for (const field of ['id', 'name', 'version', 'minAppVersion', 'description', 'author'] as const) {
    assert.ok(manifest[field], `manifest.json is missing "${field}"`);
  }
  assert.match(manifest.version, /^\d+\.\d+\.\d+/, 'version must be semver');
  assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+/);
  assert.match(manifest.id, /^[a-z0-9-]+$/, 'id must be lowercase and hyphenated');
});

test('the plugin declares itself desktop-only', () => {
  // It spawns a language server process. On mobile there is no child_process, and a
  // plugin that claims mobile support and then throws on load is worse than one that
  // is honestly unavailable.
  assert.equal(manifest.isDesktopOnly, true);
});

test('the description does not promise generation', () => {
  // DESIGN.md § 10: Prosebind never writes prose. The store listing is the first place
  // that promise is made or broken.
  assert.doesNotMatch(manifest.description, /\b(generate|write for you|co-?write|rewrite)\b/i);
});

test('every command has a stable id and a name', () => {
  const commands = [...main.matchAll(/addCommand\(\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)];
  assert.ok(commands.length >= 3, `expected several commands, found ${commands.length}`);
  for (const [, id, name] of commands) {
    assert.match(id!, /^[a-z0-9-]+$/, `command id "${id}" must be lowercase and hyphenated`);
    // Obsidian prefixes the plugin name in the palette itself, so repeating it reads
    // as "Prosebind: Prosebind recheck".
    assert.doesNotMatch(name!, /^Prosebind/i, `command name "${name}" should not repeat the plugin name`);
  }
});

test('the settings defaults match what the server expects', () => {
  assert.match(settings, /debounceMs:\s*900/, 'must match the server default');
  assert.match(settings, /severityFloor:\s*'note'/, 'must match the server default');
});

test('the sidebar is the only channel that reports findings', () => {
  // The one permitted Notice is a hard startup failure. Anything else would be a
  // popup during drafting, which § 10 forbids.
  const notices = [...main.matchAll(/new Notice\(/g)];
  assert.equal(notices.length, 1, 'exactly one Notice: the server failing to start');
  assert.match(main, /state === 'failed'/, 'and it must be gated on that failure');
});

test('styles use Obsidian theme variables rather than fixed colours', () => {
  const css = readFileSync(join(root, 'styles.css'), 'utf8');
  const hardCoded = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.equal(
    hardCoded.length,
    0,
    `hard-coded colours would fight the writer's theme: ${hardCoded.join(', ')}`,
  );
  assert.match(css, /var\(--text-/, 'colours come from the active theme');
});

test('the built plugin lands where Obsidian looks for it', () => {
  // Obsidian loads main.js from the plugin folder root, not from dist/.
  const built = join(root, 'main.js');
  if (!existsSync(built)) return; // not bundled yet in this run
  const size = readFileSync(built).length;
  assert.ok(size > 1000, 'main.js looks empty');
});
