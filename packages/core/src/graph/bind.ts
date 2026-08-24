import { createAnchor, resolveAnchor } from '../anchor/anchor.js';
import { segmentsOfKind } from '../segment/segment.js';
import type { Document } from '../segment/types.js';
import type { ContinuityGraph } from './graph.js';
import type { EventPosition } from './types.js';

/**
 * Pin every timeline event to a place in the manuscript.
 *
 * A writer says *where* an event happens in one of two ways, and the difference in
 * precision is reflected in the confidence we attach:
 *
 *   at: "the coffin went down badly"   → exact, survives editing, resolved by anchor
 *   chapter: 9                         → approximate, still useful
 *
 * Events with neither are still ordered by date, but cannot support the checks that
 * ask "did this happen before that point in the prose".
 */
export function bindEvents(graph: ContinuityGraph, documents: readonly Document[]): void {
  for (const event of graph.events) {
    event.position = resolvePosition(event.at, event.chapter, documents);
  }
}

function resolvePosition(
  quote: string | undefined,
  chapter: number | undefined,
  documents: readonly Document[],
): EventPosition | undefined {
  if (quote && quote.trim().length > 0) {
    for (const doc of documents) {
      const direct = doc.text.indexOf(quote);
      if (direct !== -1) {
        return { file: doc.path, offset: direct, via: 'quote', confidence: 1 };
      }
    }
    // Not verbatim any more — the writer edited the line they pinned to. Re-find it
    // with the same machinery that keeps diagnostics attached.
    for (const doc of documents) {
      const anchor = createAnchor(quote + doc.text, { start: 0, end: quote.length });
      const resolution = resolveAnchor(doc.text, { ...anchor, start: 0 });
      if (resolution.span && resolution.confidence >= 0.6) {
        return {
          file: doc.path,
          offset: resolution.span.start,
          via: 'quote',
          confidence: resolution.confidence,
        };
      }
    }
    return undefined;
  }

  if (typeof chapter === 'number' && chapter > 0) {
    for (const doc of documents) {
      const chapters = segmentsOfKind(doc, 'chapter');
      const target = chapters[chapter - 1];
      if (target) {
        return { file: doc.path, offset: target.span.start, via: 'chapter', confidence: 0.8 };
      }
    }
  }

  return undefined;
}

/**
 * Absolute position of a point in a multi-file project, so "before" and "after"
 * mean something across chapter files as well as within one.
 */
export function projectOffset(
  documents: readonly Document[],
  file: string,
  offset: number,
): number {
  let base = 0;
  for (const doc of documents) {
    if (doc.path === file) return base + offset;
    base += doc.text.length + 1;
  }
  return base + offset;
}
