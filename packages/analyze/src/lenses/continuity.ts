import type { Lens, LensContext } from '../lens.js';
import { TIER2_SYSTEM } from '../lens.js';

/**
 * Cold-read contradiction detection.
 *
 * The lens the FlawedFictions run showed was missing. Tier 0 proves contradictions
 * against a bible the writer declared; this one reads the passage with no oracle at all
 * and asks whether it contradicts itself. That is the task those benchmarks actually
 * set, and the only tier that can attempt it is this one.
 *
 * Expect it to be the noisiest lens in the set. It is the one asked to find something
 * without being told what is true.
 */
export const continuityLens: Lens = {
  id: 'passage-contradiction',
  category: 'factual',
  severity: 'question',
  maxConfidence: 0.65,
  describes: 'Something in this passage appears to contradict something else in the same passage.',
  system: TIER2_SYSTEM,

  prompt(context: LensContext): string {
    return `${context.canon ? `Established for this book:\n${context.canon}\n\n` : ''}Read the passage and look for places where it contradicts itself: a detail stated one way
and later another, an object or person in two places, an action that undoes something the
passage already settled, a stated sequence that cannot have happened in that order.

Both halves of a contradiction must be present in this passage. If one half is only
implied, or would depend on a chapter you cannot see, leave it out.

Quote the *second* half — the part that conflicts with what came before — and say what it
conflicts with.

Return JSON: {"findings": [{"quote": "...", "concern": "...", "why": "..."}]}
An empty list is the expected answer for a passage that holds together.

${context.label ? `Passage (${context.label}):` : 'Passage:'}
"""
${context.text}
"""`;
  },
};
