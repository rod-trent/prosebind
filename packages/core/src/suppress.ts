import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SuppressionSet } from './checks/registry.js';

export const SUPPRESS_FILE = '.prosebind/suppress.yaml';

/**
 * Findings the writer has told us to stop raising.
 *
 * This file is the mechanism that makes deliberate inconsistency workable
 * (DESIGN.md § 8). Unreliable narrators, characters who lie, and withheld information
 * all look exactly like errors from the outside, and the writer is the only one who
 * knows the difference. Dismissal must be permanent, or the tool becomes an argument.
 */
export class Suppressions implements SuppressionSet {
  private readonly keys: Set<string>;

  constructor(keys: Iterable<string> = []) {
    this.keys = new Set(keys);
  }

  has(key: string): boolean {
    if (this.keys.has(key)) return true;
    // A whole check can be silenced with a bare `check-id/*` entry.
    const slash = key.indexOf('/');
    if (slash !== -1 && this.keys.has(`${key.slice(0, slash)}/*`)) return true;
    return false;
  }

  add(key: string): void {
    this.keys.add(key);
  }

  get size(): number {
    return this.keys.size;
  }

  toArray(): string[] {
    return [...this.keys].sort();
  }
}

export async function loadSuppressions(root: string): Promise<Suppressions> {
  try {
    const raw = await readFile(join(root, SUPPRESS_FILE), 'utf8');
    const parsed = parseYaml(raw);
    if (Array.isArray(parsed)) {
      return new Suppressions(parsed.filter((v): v is string => typeof v === 'string'));
    }
    if (parsed && typeof parsed === 'object') {
      const entries = (parsed as Record<string, unknown>)['suppress'];
      if (Array.isArray(entries)) {
        return new Suppressions(entries.filter((v): v is string => typeof v === 'string'));
      }
    }
    return new Suppressions();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Suppressions();
    throw error;
  }
}

export async function saveSuppressions(root: string, suppressions: Suppressions): Promise<void> {
  const path = join(root, SUPPRESS_FILE);
  await mkdir(dirname(path), { recursive: true });
  const body = [
    '# Findings Prosebind should stop raising.',
    '#',
    '# Add a key to silence one finding, or "check-id/*" to silence a whole check.',
    '# Deliberate inconsistency is normal fiction — this file is how you say so.',
    '',
    ...suppressions.toArray().map((key) => `- ${JSON.stringify(key)}`),
    '',
  ].join('\n');
  await writeFile(path, body, 'utf8');
}
