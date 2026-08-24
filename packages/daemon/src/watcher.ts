import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

/** Extensions we treat as manuscript. */
export const MANUSCRIPT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.mdown']);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.obsidian', '.vscode', '.idea', 'models',
]);

export function isManuscript(path: string): boolean {
  if (path.split(sep).some((part) => IGNORED_DIRS.has(part))) return false;
  // The bible is watched separately: editing it invalidates every check, not one file.
  if (path.includes(`.prosebind${sep}`) || path.includes('.prosebind/')) return false;
  return MANUSCRIPT_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isBibleFile(root: string, path: string): boolean {
  const rel = relative(root, path).split(sep).join('/');
  return rel.startsWith('.prosebind/');
}

/** Every manuscript file under `root`, in a stable order. */
export async function findManuscripts(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name === '.prosebind') continue;
        await walk(full);
      } else if (entry.isFile() && isManuscript(full)) {
        found.push(full);
      }
    }
  }

  await walk(root);
  return found.sort();
}

export interface WatchEvent {
  readonly path: string;
  readonly kind: 'manuscript' | 'bible';
}

export interface WatcherOptions {
  /**
   * Quiet period after the last change before we act.
   *
   * This is the first line of defence for DESIGN.md § 10: never interrupt a writer
   * mid-flow. Typing produces a save every few seconds in most editors, and we want
   * one analysis after they stop, not thirty during.
   */
  debounceMs?: number;
  onBatch: (events: readonly WatchEvent[]) => void | Promise<void>;
  onError?: (error: Error) => void;
}

/**
 * Watch a project for changes, batched and debounced.
 *
 * Uses Node's recursive `fs.watch` rather than a polling library — one fewer
 * dependency in something that has to ship as a single binary to people who do not
 * have a toolchain. Where recursion is unsupported the caller falls back to polling.
 */
export class ProjectWatcher {
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private pending = new Map<string, WatchEvent>();
  private readonly debounceMs: number;
  private closed = false;

  constructor(
    private readonly root: string,
    private readonly options: WatcherOptions,
  ) {
    this.debounceMs = options.debounceMs ?? 900;
  }

  start(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename || this.closed) return;
        const full = join(this.root, filename.toString());
        if (isBibleFile(this.root, full)) {
          this.enqueue({ path: full, kind: 'bible' });
        } else if (isManuscript(full)) {
          this.enqueue({ path: full, kind: 'manuscript' });
        }
      });
      this.watcher.on('error', (error) => this.options.onError?.(error as Error));
    } catch (error) {
      this.options.onError?.(
        new Error(
          `could not watch ${this.root}: ${(error as Error).message}. ` +
            'Recursive watching is unavailable on this platform; run "prosebind check" instead.',
        ),
      );
    }
  }

  private enqueue(event: WatchEvent): void {
    this.pending.set(`${event.kind}:${event.path}`, event);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending.values()];
    this.pending.clear();
    this.timer = undefined;
    if (batch.length === 0) return;

    // An editor's atomic-save dance briefly unlinks the file; confirm it exists
    // before reporting it, or we churn on phantom deletes.
    const live: WatchEvent[] = [];
    for (const event of batch) {
      try {
        const info = await stat(event.path);
        if (info.isFile()) live.push(event);
      } catch {
        live.push(event);
      }
    }

    try {
      await this.options.onBatch(live);
    } catch (error) {
      this.options.onError?.(error as Error);
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
  }
}
