import type { Category, Severity } from '@prosebind/core';

/**
 * A Tier 2 lens: one question asked of one passage.
 *
 * Tier 2 is judgment, not arithmetic. Where Tier 0 can prove a contradiction from the
 * bible and Tier 1 extracts facts, a lens asks something a rule engine cannot —
 * does this turn feel earned, does this scene contradict itself, is the reader being
 * asked to accept something the prose has not paid for.
 *
 * Everything a lens produces is a **question**, not a verdict. § 10 is the constraint:
 * these are the kind of observations a good reader makes in the margin, and the writer
 * is the one who decides whether they are right.
 */

export interface LensFinding {
  /**
   * Verbatim text from the passage that the concern is about.
   *
   * Load-bearing. Every finding is resolved back to a span through the anchoring layer,
   * and one whose quote cannot be found in the passage is **dropped** — see
   * `anchorFindings`. A model that cannot point at what it means is guessing, and a
   * finding a writer cannot locate is worse than no finding at all.
   */
  quote: string;
  /** One sentence, addressed to the writer. */
  concern: string;
  /** The evidence, so the writer can judge the claim rather than trust it. */
  why?: string | undefined;
}

export interface LensResult {
  findings: LensFinding[];
}

export interface Lens {
  readonly id: string;
  readonly category: Category;
  /** Tier 2 findings are questions by default. Only raise this with good reason. */
  readonly severity: Severity;
  /** Shown in `prosebind lenses`, and in "why am I seeing this". */
  readonly describes: string;
  readonly system: string;
  /** Build the user prompt for a passage. */
  prompt(context: LensContext): string;
  /** Ceiling on confidence for anything this lens produces. */
  readonly maxConfidence: number;
}

export interface LensContext {
  /** The passage under analysis. Scene- or chapter-scoped, never the whole book. */
  text: string;
  /** Where it sits, to orient the model. */
  label?: string | undefined;
  /** Canon the writer has declared, so the lens argues with the book and not itself. */
  canon?: string | undefined;
}

/** JSON Schema handed to providers that can constrain decoding. */
export const LENS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          concern: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['quote', 'concern'],
      },
    },
  },
  required: ['findings'],
};

const MAX_FINDINGS = 12;

function clean(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > limit) return undefined;
  return trimmed;
}

/**
 * Normalise whatever came back.
 *
 * Same posture as Tier 1: the response is untrusted input. A finding with no quote is
 * discarded here rather than later, because the quote is the only thing that makes the
 * finding checkable.
 */
export function normalizeLensResult(raw: unknown): LensResult {
  if (raw === null || typeof raw !== 'object') return { findings: [] };
  const record = raw as Record<string, unknown>;
  const items = Array.isArray(record['findings']) ? record['findings'].slice(0, MAX_FINDINGS) : [];

  const findings: LensFinding[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const quote = clean(entry['quote'], 400);
    const concern = clean(entry['concern'], 300);
    if (!quote || !concern) continue;
    // A one-word quote anchors nothing and matches everywhere.
    if (quote.split(/\s+/).length < 3) continue;
    findings.push({ quote, concern, why: clean(entry['why'], 400) });
  }
  return { findings };
}

/** The shared framing every lens inherits. */
export const TIER2_SYSTEM = `You are a continuity editor reading a passage from a manuscript in progress.

You never write, rewrite, or suggest prose. You ask questions a careful reader would ask
in the margin.

Rules you do not break:
- Quote the passage verbatim for every observation. If you cannot quote it, do not raise it.
- Report only what the passage shows. Do not speculate about what might happen later.
- A draft is allowed to have loose ends. Ambiguity, withheld information, an unreliable
  narrator and a slow reveal are craft, not errors. Raise something only when the passage
  appears to work against itself.
- Say nothing rather than fill a quota. An empty list is the correct answer for most
  passages, and a wrong observation costs the writer more than a missed one.`;
