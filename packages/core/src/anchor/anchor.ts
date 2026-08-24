import { createHash } from 'node:crypto';
import type { Span } from '../text.js';
import { normalize, normalizePreservingLength } from '../text.js';
import { DEFAULT_BITAP, MAX_BITS, matchBitap } from './bitap.js';
import { contextScore, similarity } from './similarity.js';
import type { Anchor, Resolution } from './types.js';

/** How much surrounding text an anchor carries for disambiguation. */
export const CONTEXT_LENGTH = 48;

/** Below this similarity, a candidate is a different passage rather than a reworded one. */
const FUZZY_FLOOR = 0.6;

/** Two candidates scoring within this of each other are a genuine ambiguity. */
const AMBIGUITY_EPSILON = 0.05;

/** A quote appearing more often than this is boilerplate and cannot be disambiguated by context alone. */
const TOO_COMMON = 40;

export function hashQuote(quote: string): string {
  return createHash('sha256').update(normalize(quote)).digest('hex').slice(0, 16);
}

/** Captures a passage as an anchor that can survive the document being edited around it. */
export function createAnchor(text: string, span: Span, contextLength = CONTEXT_LENGTH): Anchor {
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.end, text.length));
  const quote = text.slice(start, end);
  return {
    quote,
    prefix: text.slice(Math.max(0, start - contextLength), start),
    suffix: text.slice(end, Math.min(text.length, end + contextLength)),
    start,
    quoteHash: hashQuote(quote),
  };
}

function allOccurrences(haystack: string, needle: string, limit: number): number[] {
  const found: number[] = [];
  if (needle.length === 0) return found;
  let from = 0;
  while (found.length <= limit) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    found.push(at);
    from = at + 1;
  }
  return found;
}

/**
 * How well a candidate position agrees with the anchor's recorded context and position.
 * Context dominates; proximity only breaks ties, because a large upstream insert moves
 * everything downstream without making any of it a worse match.
 */
function scoreCandidate(text: string, anchor: Anchor, at: number, quoteLength: number): number {
  const prefixActual = text.slice(Math.max(0, at - anchor.prefix.length), at);
  const suffixActual = text.slice(at + quoteLength, at + quoteLength + anchor.suffix.length);
  const ctx =
    0.5 * contextScore(anchor.prefix, prefixActual, 'right') +
    0.5 * contextScore(anchor.suffix, suffixActual, 'left');
  const drift = Math.abs(at - anchor.start);
  const proximity = 1 / (1 + drift / 2000);
  return 0.85 * ctx + 0.15 * proximity;
}

/**
 * Re-find an anchored passage in a possibly-edited document.
 *
 * The escalation is deliberate and ordered by cost: verbatim at the old offset,
 * verbatim elsewhere, then approximate search biased toward the old offset, then
 * reconstruction from surrounding context. Each rung is slower and less certain than
 * the one above, and the returned confidence reflects which rung answered.
 */
export function resolveAnchor(text: string, anchor: Anchor): Resolution {
  const len = anchor.quote.length;
  if (len === 0) return { status: 'lost', confidence: 0 };

  // 1. Verbatim, right where we left it.
  if (text.startsWith(anchor.quote, anchor.start)) {
    return { status: 'exact', span: { start: anchor.start, end: anchor.start + len }, confidence: 1 };
  }

  // 2. Verbatim somewhere else — the common case after an upstream edit.
  const exact = allOccurrences(text, anchor.quote, TOO_COMMON);
  if (exact.length === 1) {
    const at = exact[0] ?? 0;
    const score = scoreCandidate(text, anchor, at, len);
    return {
      status: 'shifted',
      span: { start: at, end: at + len },
      confidence: Math.max(0.8, Math.min(0.99, score)),
    };
  }
  if (exact.length > 1 && exact.length <= TOO_COMMON) {
    const ranked = exact
      .map((at) => ({ at, score: scoreCandidate(text, anchor, at, len) }))
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const next = ranked[1];
    if (top && next && top.score - next.score < AMBIGUITY_EPSILON) {
      return {
        status: 'ambiguous',
        confidence: 0,
        candidates: ranked.slice(0, 5).map((c) => ({ start: c.at, end: c.at + len })),
      };
    }
    if (top) {
      return {
        status: 'shifted',
        span: { start: top.at, end: top.at + len },
        confidence: Math.max(0.75, Math.min(0.98, top.score)),
      };
    }
  }

  // 3. Approximate. Search on length-preserving normalised text so that a word
  //    processor swapping quote characters does not read as a rewrite.
  const haystack = normalizePreservingLength(text);
  const needle = normalizePreservingLength(anchor.quote);
  const probe = needle.slice(0, Math.min(MAX_BITS, needle.length));
  const at = matchBitap(haystack, probe, anchor.start, {
    ...DEFAULT_BITAP,
    distance: Math.max(1000, Math.floor(text.length / 4)),
  });

  if (at !== -1) {
    const verified = verifyWindow(text, anchor, at);
    if (verified) return verified;
  }

  // 4. Reconstruct from context: if both shoulders survived, the passage between
  //    them is the passage, however heavily it was rewritten.
  const fromContext = resolveByContext(text, anchor);
  if (fromContext) return fromContext;

  return { status: 'lost', confidence: 0 };
}

/**
 * Confirm that the text at `at` really is the anchored passage, allowing for the
 * quote having grown or shrunk slightly during a rewrite.
 */
function verifyWindow(text: string, anchor: Anchor, at: number): Resolution | undefined {
  const len = anchor.quote.length;
  let best: { span: Span; score: number } | undefined;

  for (const scale of [1, 0.85, 1.15, 0.7, 1.3]) {
    const width = Math.max(1, Math.round(len * scale));
    const candidate = text.slice(at, at + width);
    const score = similarity(normalize(candidate), normalize(anchor.quote));
    if (!best || score > best.score) best = { span: { start: at, end: at + width }, score };
  }

  if (!best || best.score < FUZZY_FLOOR) return undefined;

  const ctx = scoreCandidate(text, anchor, best.span.start, best.span.end - best.span.start);
  // A reworded passage in the right place is trustworthy; the same words in an
  // unrecognisable context are not.
  const confidence = Math.min(0.9, 0.65 * best.score + 0.35 * ctx);
  return { status: 'fuzzy', span: best.span, confidence };
}

/** Last resort: locate the shoulders and take what sits between them. */
function resolveByContext(text: string, anchor: Anchor): Resolution | undefined {
  const { prefix, suffix } = anchor;
  if (prefix.length < 12 || suffix.length < 12) return undefined;

  const prefixTail = prefix.slice(-Math.min(MAX_BITS, prefix.length));
  const suffixHead = suffix.slice(0, Math.min(MAX_BITS, suffix.length));
  const haystack = normalizePreservingLength(text);

  const pAt = matchBitap(haystack, normalizePreservingLength(prefixTail), anchor.start, DEFAULT_BITAP);
  if (pAt === -1) return undefined;
  const contentStart = pAt + prefixTail.length;

  const sAt = matchBitap(
    haystack,
    normalizePreservingLength(suffixHead),
    contentStart + anchor.quote.length,
    DEFAULT_BITAP,
  );
  if (sAt === -1 || sAt <= contentStart) return undefined;

  const width = sAt - contentStart;
  // Refuse absurd reconstructions — a passage that tripled in length is not the
  // same passage, it is a new scene that happens to sit between familiar shoulders.
  if (width > anchor.quote.length * 3 + 64) return undefined;

  return {
    status: 'fuzzy',
    span: { start: contentStart, end: sAt },
    confidence: 0.7,
  };
}
