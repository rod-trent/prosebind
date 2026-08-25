import { createAnchor, normalize, resolveAnchor, snapToWordBoundaries } from '@prosebind/core';
import type { ContinuityGraph, Diagnostic, Document, Segment } from '@prosebind/core';
import {
  assertPermitted,
  extractJson,
  LOCAL_ONLY,
  ModelUnavailableError,
  type LanguageModel,
  type NetworkPolicy,
} from '@prosebind/extract';
import { LENS_SCHEMA, normalizeLensResult, type Lens, type LensFinding } from './lens.js';

/**
 * Tier 2: judgment analysis over one passage at a time.
 *
 * Three constraints from DESIGN.md § 7, all enforced structurally rather than by
 * convention:
 *
 *   **Never whole-manuscript.** There is no API here that accepts a book. A lens runs
 *   against one scene or chapter, because § 4's evidence is that long context is where
 *   this kind of reasoning degrades — the whole argument of this project.
 *
 *   **Cloud is opt-in and announced.** `assertPermitted` refuses a cloud model unless
 *   the writer allowed it, and calls back before the manuscript leaves the machine.
 *
 *   **Debounced and background.** Enforced by the caller (§ 10), and made affordable
 *   here by caching on segment hash + lens.
 */

/**
 * How much of the quote must actually survive in the located text.
 *
 * Deliberately stricter than the anchoring layer's own fuzzy floor. That floor is tuned
 * for "the writer reworded this sentence", where a loose match is a recovery. Here the
 * question is different — *did the model quote this passage at all* — and a loose match
 * is a false accept.
 *
 * Found by test: `"Beta sentence here"` from one scene fuzzy-matched `"Alpha sentence
 * here."` in another and passed the gate at 0.6. Two unrelated sentences sharing a
 * common tail are not the same sentence.
 */
export const QUOTE_SIMILARITY_FLOOR = 0.75;

/** Retained for callers; the effective gate is `QUOTE_SIMILARITY_FLOOR`. */
export const ANCHOR_FLOOR = QUOTE_SIMILARITY_FLOOR;

/**
 * Sampling temperature for lenses. See `AnalyzerOptions.temperature` for the measurement
 * behind this number.
 */
export const DEFAULT_TEMPERATURE = 0.7;

export interface AnalyzerOptions {
  model: LanguageModel;
  lenses: readonly Lens[];
  policy?: NetworkPolicy | undefined;
  /**
   * Sampling temperature. **0.7 by default**, which is a measured choice.
   *
   * At 0 the same passage always yields the same questions, which is the obvious thing
   * to want. But on FlawedFictions, 0.7 recovers +5.6 points of recall for 3.1 points of
   * precision — F1 0.797 to 0.822, paired on 146 stories — and that is a better trade
   * for a tier whose findings are questions in a sidebar rather than inline marks.
   *
   * The cost is determinism: a writer whose cache is cold may see a slightly different
   * set of questions on a re-run. Within a session the per-passage cache keeps it
   * stable. Set 0 if reproducibility matters more than coverage.
   */
  temperature?: number | undefined;
  onError?: ((segmentId: string, lens: string, error: Error) => void) | undefined;
  /** Announce each passage before it is analysed, for progress and for consent UX. */
  onProgress?: ((segmentId: string, lens: string) => void) | undefined;
}

export interface AnalysisRecord {
  readonly segmentId: string;
  readonly lens: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly durationMs: number;
  readonly cached: boolean;
  /** Findings the model produced that could not be anchored, and were discarded. */
  readonly dropped: number;
}

let counter = 0;

export class Analyzer {
  private readonly cache = new Map<string, Diagnostic[]>();
  private readonly policy: NetworkPolicy;

  constructor(private readonly options: AnalyzerOptions) {
    this.policy = options.policy ?? LOCAL_ONLY;
  }

  get model(): LanguageModel {
    return this.options.model;
  }

  /**
   * Analyse one passage with one lens.
   *
   * Deliberately the only entry point that talks to a model. Anything wanting the whole
   * book has to loop, which makes the cost visible at the call site.
   */
  async analyzeSegment(
    doc: Document,
    segment: Segment,
    lens: Lens,
    graph?: ContinuityGraph,
  ): Promise<AnalysisRecord> {
    if (segment.kind === 'paragraph') {
      // A paragraph is too small to judge motivation or self-consistency against.
      return { segmentId: segment.id, lens: lens.id, diagnostics: [], durationMs: 0, cached: false, dropped: 0 };
    }

    const key = `${lens.id}:${segment.hash}`;
    const cached = this.cache.get(key);
    if (cached) {
      return { segmentId: segment.id, lens: lens.id, diagnostics: cached, durationMs: 0, cached: true, dropped: 0 };
    }

    this.options.onProgress?.(segment.id, lens.id);

    try {
      assertPermitted(this.options.model, this.policy, segment.text.length);

      const response = await this.options.model.generate({
        system: lens.system,
        prompt: lens.prompt({
          text: segment.text,
          label: segment.title,
          canon: graph ? summariseCanon(graph) : undefined,
        }),
        schema: LENS_SCHEMA,
        temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: 2000,
      });

      const result = normalizeLensResult(extractJson(response.text));
      const { diagnostics, dropped } = anchorFindings(result.findings, doc, segment, lens);

      this.cache.set(key, diagnostics);
      return {
        segmentId: segment.id,
        lens: lens.id,
        diagnostics,
        durationMs: response.durationMs,
        cached: false,
        dropped,
      };
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) {
        this.options.onError?.(segment.id, lens.id, error as Error);
      } else {
        this.options.onError?.(segment.id, lens.id, error);
      }
      // Tier 2 failing costs the writer nothing they had. Tiers 0 and 1 are untouched.
      this.cache.set(key, []);
      return { segmentId: segment.id, lens: lens.id, diagnostics: [], durationMs: 0, cached: false, dropped: 0 };
    }
  }

  /** Every lens over one passage. */
  async analyzeAll(
    doc: Document,
    segment: Segment,
    graph?: ContinuityGraph,
  ): Promise<AnalysisRecord[]> {
    const records: AnalysisRecord[] = [];
    for (const lens of this.options.lenses) {
      records.push(await this.analyzeSegment(doc, segment, lens, graph));
    }
    return records;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Resolve each finding's quote back to a span, and discard the ones that will not.
 *
 * This is the quality gate for the whole tier. A language model asked to quote a passage
 * will sometimes produce a quote that is *nearly* the text, and sometimes one that is not
 * in the passage at all — a paraphrase it believes it read. The first is recoverable and
 * the anchoring layer handles it. The second is a hallucination, and it is exactly the
 * kind of finding that would send a writer hunting for a line that does not exist.
 *
 * Anything that will not re-anchor above `ANCHOR_FLOOR` is dropped, silently and on
 * purpose. Reporting it with a caveat would still be reporting it.
 */
export function anchorFindings(
  findings: readonly LensFinding[],
  doc: Document,
  segment: Segment,
  lens: Lens,
): { diagnostics: Diagnostic[]; dropped: number } {
  const diagnostics: Diagnostic[] = [];
  let dropped = 0;

  for (const finding of findings) {
    // Locate within the segment, then translate to a document offset. Searching the
    // whole document would let a quote from chapter 12 satisfy a finding about chapter 3.
    const local = locate(segment.text, finding.quote);
    if (!local) {
      dropped++;
      continue;
    }

    const span = {
      start: segment.span.start + local.start,
      end: segment.span.start + local.end,
    };

    diagnostics.push({
      id: `t2:${lens.id}:${(counter++).toString(36)}`,
      check: `t2:${lens.id}`,
      category: lens.category,
      severity: lens.severity,
      message: finding.concern,
      detail: finding.why,
      file: doc.path,
      span,
      anchor: createAnchor(doc.text, span),
      segmentId: segment.id,
      // Scaled by how well the quote resolved: a reworded quote is a weaker finding.
      confidence: Math.min(lens.maxConfidence, lens.maxConfidence * local.confidence),
      suppressionKey: `t2:${lens.id}/${segment.hash.slice(0, 8)}/${hashQuoteShort(finding.quote)}`,
    });
  }

  return { diagnostics, dropped };
}

function locate(text: string, quote: string): { start: number; end: number; confidence: number } | undefined {
  const exact = text.indexOf(quote);
  if (exact !== -1) return { start: exact, end: exact + quote.length, confidence: 1 };

  // Fall back to the fuzzy machinery that keeps diagnostics attached through an edit —
  // a model that reworded its own quote is the same problem as a writer who reworded
  // the sentence.
  const anchor = createAnchor(quote, { start: 0, end: quote.length });
  const resolution = resolveAnchor(text, { ...anchor, start: 0 });
  if (!resolution.span) return undefined;

  // The fuzzy window is sized in characters and happily stops mid-word — "…had prom"
  // for "…had promised". A truncated word is both a bad span to show a writer and a
  // false signal that the quote does not match, so snap outward first.
  const span = snapToWordBoundaries(text, resolution.span);

  // Do not trust the anchoring layer's confidence for this decision: it blends in
  // context agreement, which is meaningless when the "context" is a quote we invented
  // an anchor for. Compare the located text against the quote directly — by words.
  const located = text.slice(span.start, span.end);
  const overlap = wordSimilarity(located, quote);
  if (overlap < QUOTE_SIMILARITY_FLOOR) return undefined;

  return { ...span, confidence: overlap };
}

/**
 * Similarity by words, not characters.
 *
 * Character similarity is the wrong instrument here and produced a real false accept:
 * `"lpha sentence here"` and `"Beta sentence here"` score 0.83 on characters, because
 * they share a fourteen-character tail. By words they score 0.67 — one substitution out
 * of three — which is what a reader would say too.
 *
 * A swapped word is one edit. That is the unit a quote is wrong in.
 */
export function wordSimilarity(a: string, b: string): number {
  // Punctuation is stripped per word: a quote that ends before the full stop is the
  // same quote. Leaving it attached made "promised." and "promised" a substitution and
  // rejected a correctly located passage.
  const words = (value: string): string[] =>
    normalize(value)
      .split(/\s+/)
      .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter(Boolean);

  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;

  // Levenshtein over word arrays.
  let previous = Array.from({ length: left.length + 1 }, (_, i) => i);
  for (let j = 1; j <= right.length; j++) {
    const current = [j];
    for (let i = 1; i <= left.length; i++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[i] = Math.min(
        (current[i - 1] ?? 0) + 1,
        (previous[i] ?? 0) + 1,
        (previous[i - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  const distance = previous[left.length] ?? 0;
  return 1 - distance / Math.max(left.length, right.length);
}

function hashQuoteShort(quote: string): string {
  let hash = 0;
  for (let i = 0; i < quote.length; i++) {
    hash = (hash * 31 + quote.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** A compact statement of canon, so a lens argues with the book rather than itself. */
export function summariseCanon(graph: ContinuityGraph): string | undefined {
  const lines: string[] = [];
  for (const entity of graph.entities) {
    if (entity.tier === 'inferred') continue; // never present a guess as established
    const facts = graph
      .factsFor(entity.id)
      .filter((f) => f.tier === 'canon')
      .map((f) => `${f.predicate} ${f.value}`);
    lines.push(`- ${entity.name}${facts.length > 0 ? `: ${facts.join(', ')}` : ''}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}
