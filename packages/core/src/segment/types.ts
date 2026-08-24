import type { Span } from '../text.js';

/**
 * Manuscripts have a structure writers already think in. We segment along those
 * seams rather than by token windows, because a continuity claim belongs to a scene,
 * and "which scene" is the question every Tier 0 check ends up asking.
 */
export type SegmentKind = 'chapter' | 'scene' | 'paragraph';

export interface Segment {
  readonly id: string;
  readonly kind: SegmentKind;
  readonly span: Span;
  readonly text: string;
  /** Hash of the normalised text. Identity for incremental recompute. */
  readonly hash: string;
  readonly parentId: string | undefined;
  /** Position among siblings, zero-based. */
  readonly ordinal: number;
  /** Heading text for chapters, or an inferred label for scenes. */
  readonly title: string | undefined;
  readonly wordCount: number;
}

export interface Document {
  readonly path: string;
  readonly text: string;
  readonly segments: readonly Segment[];
  /** Frontmatter block, if the file opened with one. */
  readonly frontmatter: string | undefined;
}

export interface SegmentChange {
  readonly before: Segment;
  readonly after: Segment;
  /** 0..1 — how much of the old text survives. Low values mean a rewrite, not an edit. */
  readonly similarity: number;
}

/**
 * What actually changed between two versions of a document.
 *
 * This is the whole point of the incremental design: everything downstream consumes
 * `added` and `changed` and ignores `unchanged`, so editing one scene costs one
 * scene's worth of work rather than a manuscript's worth.
 */
export interface SegmentDelta {
  readonly added: readonly Segment[];
  readonly removed: readonly Segment[];
  readonly changed: readonly SegmentChange[];
  /** Same content, possibly at a new offset. Cheap to re-anchor, never re-analysed. */
  readonly moved: readonly SegmentChange[];
  readonly unchanged: readonly Segment[];
}

export function isDirty(delta: SegmentDelta): boolean {
  return delta.added.length > 0 || delta.removed.length > 0 || delta.changed.length > 0;
}
