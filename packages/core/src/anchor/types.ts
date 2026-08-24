import type { Span } from '../text.js';

/**
 * A content-addressed reference to a passage.
 *
 * Deliberately modelled on the W3C Web Annotation selectors: a quote with its
 * surrounding context (which survives the text moving) plus a position (which makes
 * re-finding it cheap). Neither is trusted alone. Position is a hint; the quote and
 * its context are the identity.
 */
export interface Anchor {
  /** The anchored text itself, verbatim from the document. */
  readonly quote: string;
  /** Characters immediately before the quote, for disambiguation. */
  readonly prefix: string;
  /** Characters immediately after the quote, for disambiguation. */
  readonly suffix: string;
  /** Where the quote was when the anchor was made. A hint, never a guarantee. */
  readonly start: number;
  /** Hash of the normalised quote, for fast equality checks. */
  readonly quoteHash: string;
}

export type ResolutionStatus =
  /** Found verbatim at the recorded offset. */
  | 'exact'
  /** Found verbatim, but the text moved. */
  | 'shifted'
  /** Found something close enough to be the same passage, reworded. */
  | 'fuzzy'
  /** Several equally plausible candidates. We refuse to guess. */
  | 'ambiguous'
  /** Gone. The passage was deleted or rewritten past recognition. */
  | 'lost';

export interface Resolution {
  readonly status: ResolutionStatus;
  /** Where the quote now lives. Absent when status is `lost` or `ambiguous`. */
  readonly span?: Span | undefined;
  /** 0..1. Diagnostics built on a low-confidence anchor must not be shown inline. */
  readonly confidence: number;
  /** Populated when `ambiguous`, so a caller can present the choice. */
  readonly candidates?: readonly Span[] | undefined;
}

/** Anchors below this confidence never produce an inline diagnostic. */
export const INLINE_CONFIDENCE_FLOOR = 0.75;
