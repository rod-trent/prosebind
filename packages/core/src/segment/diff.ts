import { similarity } from '../anchor/similarity.js';
import { normalize } from '../text.js';
import type { Segment, SegmentChange, SegmentDelta } from './types.js';

/** Below this, two segments are different scenes rather than one edited scene. */
const REWRITE_FLOOR = 0.45;

/**
 * Work out what actually changed between two versions of a document.
 *
 * This function is the reason the engine is affordable. Everything expensive
 * downstream — extraction, checks, model calls in later tiers — consumes only
 * `added` and `changed`. A writer fixing a typo in chapter 14 must not cost a
 * re-read of chapters 1 through 13.
 *
 * Matching runs in three passes, cheapest first:
 *   1. identical hash at an identical offset  → unchanged
 *   2. identical hash elsewhere               → moved (re-anchor, do not re-analyse)
 *   3. best-scoring survivor above the floor  → changed
 */
export function diffSegments(before: readonly Segment[], after: readonly Segment[]): SegmentDelta {
  const unchanged: Segment[] = [];
  const moved: SegmentChange[] = [];
  const changed: SegmentChange[] = [];

  const remainingBefore = new Set(before);
  const remainingAfter = new Set(after);

  // Pass 1 & 2 — hash identity. Bucket by hash so this is linear.
  const beforeByHash = new Map<string, Segment[]>();
  for (const seg of before) {
    const bucket = beforeByHash.get(seg.hash);
    if (bucket) bucket.push(seg);
    else beforeByHash.set(seg.hash, [seg]);
  }

  for (const next of after) {
    const bucket = beforeByHash.get(next.hash);
    if (!bucket || bucket.length === 0) continue;
    // Prefer the candidate closest in the document, so duplicated boilerplate
    // pairs up positionally instead of arbitrarily.
    let bestIndex = 0;
    let bestDrift = Infinity;
    for (let i = 0; i < bucket.length; i++) {
      const cand = bucket[i]!;
      if (!remainingBefore.has(cand)) continue;
      const drift = Math.abs(cand.span.start - next.span.start);
      if (drift < bestDrift) {
        bestDrift = drift;
        bestIndex = i;
      }
    }
    const prev = bucket[bestIndex];
    if (!prev || !remainingBefore.has(prev)) continue;

    remainingBefore.delete(prev);
    remainingAfter.delete(next);
    if (prev.span.start === next.span.start && prev.kind === next.kind) {
      unchanged.push(next);
    } else {
      moved.push({ before: prev, after: next, similarity: 1 });
    }
  }

  // Pass 3 — content similarity among the survivors, best pairs first.
  const candidates: Array<{ before: Segment; after: Segment; score: number }> = [];
  for (const prev of remainingBefore) {
    for (const next of remainingAfter) {
      if (prev.kind !== next.kind) continue;
      // A segment that moved half the manuscript away is a different segment.
      const drift = Math.abs(prev.ordinal - next.ordinal);
      if (drift > 8) continue;
      const score = similarity(normalize(prev.text), normalize(next.text));
      if (score >= REWRITE_FLOOR) candidates.push({ before: prev, after: next, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  for (const cand of candidates) {
    if (!remainingBefore.has(cand.before) || !remainingAfter.has(cand.after)) continue;
    remainingBefore.delete(cand.before);
    remainingAfter.delete(cand.after);
    changed.push({ before: cand.before, after: cand.after, similarity: cand.score });
  }

  return {
    added: [...remainingAfter],
    removed: [...remainingBefore],
    changed,
    moved,
    unchanged,
  };
}

/**
 * The segments that need re-analysis: everything new or edited, plus the scene each
 * dirty paragraph belongs to, since a claim can span paragraphs within a scene.
 */
export function dirtySegments(delta: SegmentDelta, all: readonly Segment[]): Segment[] {
  const dirty = new Map<string, Segment>();
  const add = (s: Segment): void => {
    dirty.set(s.id, s);
  };

  for (const s of delta.added) add(s);
  for (const c of delta.changed) add(c.after);

  // Pull in parents: a changed paragraph makes its scene's claims suspect.
  const byId = new Map(all.map((s) => [s.id, s]));
  for (const seed of [...dirty.values()]) {
    let parentId = seed.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      add(parent);
      parentId = parent.parentId;
    }
  }

  return [...dirty.values()].sort((a, b) => a.span.start - b.span.start);
}
