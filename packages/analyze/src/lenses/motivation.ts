import type { Lens, LensContext } from '../lens.js';
import { TIER2_SYSTEM } from '../lens.js';

/**
 * Motivation gaps and unearned turns — the lens DESIGN.md § 7 actually names.
 *
 * The judgment Tier 0 cannot reach: not "is this fact wrong" but "does this follow".
 * A character doing something the passage has not paid for is the most common note a
 * developmental editor writes, and no rule engine will ever produce it.
 */
export const motivationLens: Lens = {
  id: 'unearned-turn',
  category: 'characterization',
  severity: 'question',
  maxConfidence: 0.6,
  describes: 'A character does something the passage has not given them a reason to do.',
  system: TIER2_SYSTEM,

  prompt(context: LensContext): string {
    return `${context.canon ? `Established for this book:\n${context.canon}\n\n` : ''}Read the passage and look for turns the prose has not paid for: a decision that arrives
without the feeling behind it, a reversal with nothing between the two positions, a
character acting on knowledge the passage has not shown them getting, or an emotional
shift the reader is asked to accept rather than watch happen.

You are reading a draft. Restraint, understatement, and things left unsaid are craft —
a character who is quiet about something is not unmotivated. Raise a turn only when the
passage seems to expect the reader to already agree with it.

Quote the moment of the turn.

Return JSON: {"findings": [{"quote": "...", "concern": "...", "why": "..."}]}
An empty list is the expected answer for most passages.

${context.label ? `Passage (${context.label}):` : 'Passage:'}
"""
${context.text}
"""`;
  },
};
