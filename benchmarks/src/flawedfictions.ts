import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The FlawedFictions benchmark (arXiv 2504.11900), fetched from HuggingFace.
 *
 * 414 short stories from Project Gutenberg — 207 with a continuity error synthesised
 * into them by FlawedFictionsMaker, 207 originals. MIT licensed. The task is binary:
 * does this story contain a continuity error?
 *
 * The corpus is cached locally and never committed. It is not ours to redistribute,
 * and vendoring a benchmark into the repository that measures you is how a benchmark
 * quietly stops measuring anything.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = resolve(here, '..', 'corpus');

const ROWS_API = 'https://datasets-server.huggingface.co/rows';
const DATASET = 'kahuja/flawed-fictions';
const PAGE = 100;

export interface FlawedFictionsRow {
  /** The story text. */
  story: string;
  /** 1 if a continuity error was synthesised into it, 0 if this is the original. */
  cont_error: number;
  /** Description of the injected error, or "No error". */
  cont_error_expl: string;
  cont_error_lines: string;
  contradicted_lines: string;
  example_id: string;
}

export type Split =
  | 'flawed_fictions'
  | 'flawed_fictions_long'
  | 'flawed_fictions_cf_negs'
  | 'flawed_fictions_error_resolved_negs';

function cachePath(split: Split): string {
  return join(CACHE_DIR, `${split}.json`);
}

async function readCache(split: Split): Promise<FlawedFictionsRow[] | undefined> {
  try {
    return JSON.parse(await readFile(cachePath(split), 'utf8')) as FlawedFictionsRow[];
  } catch {
    return undefined;
  }
}

/**
 * Load a split, downloading it once and caching it.
 *
 * Returns `undefined` rather than throwing when the dataset cannot be reached, so a
 * benchmark run offline degrades to "did not run" instead of "failed" — the harness
 * has other experiments that do not need the network.
 */
export async function loadFlawedFictions(
  split: Split = 'flawed_fictions',
  onProgress?: (fetched: number, total: number) => void,
): Promise<FlawedFictionsRow[] | undefined> {
  const cached = await readCache(split);
  if (cached && cached.length > 0) return cached;

  const rows: FlawedFictionsRow[] = [];
  let total = Number.POSITIVE_INFINITY;

  try {
    for (let offset = 0; offset < total; offset += PAGE) {
      const url =
        `${ROWS_API}?dataset=${encodeURIComponent(DATASET)}&config=default` +
        `&split=${split}&offset=${offset}&length=${PAGE}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) return undefined;

      const body = (await response.json()) as {
        num_rows_total?: number;
        rows?: Array<{ row: FlawedFictionsRow }>;
      };
      if (typeof body.num_rows_total === 'number') total = body.num_rows_total;
      for (const entry of body.rows ?? []) rows.push(entry.row);
      onProgress?.(rows.length, Number.isFinite(total) ? total : rows.length);
      if ((body.rows ?? []).length === 0) break;
    }
  } catch {
    return rows.length > 0 ? rows : undefined;
  }

  if (rows.length === 0) return undefined;

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(split), JSON.stringify(rows), 'utf8');
  return rows;
}

/**
 * A deterministic sample, balanced across labels.
 *
 * Every story costs a Tier 1 bootstrap, which is tens of seconds — the full 414 is
 * hours. Sampling is honest as long as it is stated and reproducible, and balancing
 * matters because an unbalanced sample makes accuracy meaningless: a model that always
 * says "clean" scores 70% on a 70/30 split and has learned nothing.
 */
export function balancedSample(
  rows: readonly FlawedFictionsRow[],
  size: number,
  seed = 1,
): FlawedFictionsRow[] {
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };

  const flawed = rows.filter((r) => r.cont_error === 1);
  const clean = rows.filter((r) => r.cont_error === 0);
  const half = Math.floor(size / 2);

  const take = (pool: readonly FlawedFictionsRow[], n: number): FlawedFictionsRow[] => {
    const shuffled = [...pool].sort(() => random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  };

  return [...take(flawed, half), ...take(clean, size - half)].sort((a, b) =>
    a.example_id.localeCompare(b.example_id),
  );
}
