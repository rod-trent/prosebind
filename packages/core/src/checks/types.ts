import type { Anchor } from '../anchor/types.js';
import type { ContinuityGraph } from '../graph/graph.js';
import type { Document, Segment } from '../segment/types.js';
import type { Span } from '../text.js';

/**
 * Error categories taken verbatim from ConStory-Bench (ACL Findings 2026).
 *
 * Adopting the published taxonomy rather than inventing one means our diagnostics are
 * directly comparable to benchmark results, and legible to anyone who reads the
 * literature. See DESIGN.md § 4.
 */
export type Category =
  | 'timeline'
  | 'characterization'
  | 'worldbuilding'
  | 'factual'
  | 'narrative';

/**
 * How loudly a finding is allowed to speak.
 *
 * `contradiction` may draw an inline mark. `question` and `note` accumulate quietly in
 * the sidebar. Nothing interrupts. See DESIGN.md § 10.
 */
export type Severity = 'contradiction' | 'question' | 'note';

export interface RelatedSpan {
  readonly file: string;
  readonly span: Span;
  readonly label: string;
}

export interface Diagnostic {
  readonly id: string;
  /** Which check produced this, e.g. `deceased-active`. */
  readonly check: string;
  readonly category: Category;
  readonly severity: Severity;
  /** One sentence, addressed to the writer. No jargon, no hedging. */
  readonly message: string;
  /** The evidence, so the writer can judge the claim without trusting us. */
  readonly detail?: string | undefined;
  readonly file: string;
  readonly span: Span;
  readonly anchor: Anchor;
  readonly segmentId: string;
  readonly confidence: number;
  readonly related?: readonly RelatedSpan[] | undefined;
  /**
   * The token a writer adds to `.prosebind/suppress.yaml` to silence this finding
   * permanently. Every check must be overridable: unreliable narrators, characters who
   * lie, and withheld information are normal fiction, not bugs. See DESIGN.md § 8.
   */
  readonly suppressionKey: string;
}

export interface CheckContext {
  readonly doc: Document;
  readonly graph: ContinuityGraph;
  /** Only the segments that changed. Checks must not scan the whole document. */
  readonly segments: readonly Segment[];
  /** Every document in the project, for cross-file reasoning. */
  readonly documents: readonly Document[];
}

export interface Check {
  readonly id: string;
  readonly category: Category;
  /** Shown in `prosebind explain`, and in the sidebar's "why am I seeing this". */
  readonly describes: string;
  run(context: CheckContext): Diagnostic[];
}

/**
 * Tier 0 checks are deterministic, explainable and fast enough to run on every pause.
 * A check that needs a language model belongs in Tier 1 or 2, not here.
 */
export type Tier0Check = Check;
