import type { Lens, LensContext } from '../lens.js';
import { TIER2_SYSTEM } from '../lens.js';

/**
 * Cold-read contradiction detection, tuned for recall.
 *
 * The first version of this lens scored precision 91.8% and recall 65.5% on the full
 * FlawedFictions set. Inspecting the 71 misses showed a pattern: they were not failures
 * of attention but of *scope of search*. The model was looking for flat factual
 * restatements, and the missed errors were a coal-black horse later described otherwise,
 * a merchant's established urgency contradicted by later ease, a character's manner of
 * speech shifting without cause.
 *
 * So this version names the kinds of contradiction worth checking rather than leaving
 * the model to decide what counts. That is a recall lever, not a licence: every
 * restraint from the original survives, because a lens that invents findings is worse
 * than one that misses them.
 *
 * The categories are drawn from ConStory-Bench's published error taxonomy rather than
 * from the misses themselves — tuning a prompt against the answer key would produce a
 * number that means nothing outside this benchmark.
 */
export const continuityLensV2: Lens = {
  id: 'passage-contradiction',
  category: 'factual',
  severity: 'question',
  maxConfidence: 0.65,
  describes: 'Something in this passage appears to contradict something else in the same passage.',
  system: TIER2_SYSTEM,

  prompt(context: LensContext): string {
    return `${context.canon ? `Established for this book:\n${context.canon}\n\n` : ''}Read the passage and find places where it states something one way and later another way.

Work through these kinds deliberately — a contradiction is easy to read past when you are
not looking for its particular shape:

- **Appearance and physical detail.** A person, animal, or object described one way and
  later differently — colour, size, age, condition, what someone is wearing or carrying.
- **Established traits and manner.** A habit, temperament, skill, accent or way of
  speaking that changes with nothing in the passage to change it.
- **Presence and place.** Someone taking part in a scene the passage placed them away
  from, or absent where it put them. Someone who was never introduced acting as though
  they had been.
- **Stated intent against behaviour.** An urgency, fear, refusal or promise the passage
  established, then contradicted by later conduct with nothing in between to explain it.
- **Objects.** Something whose location, owner, condition or identity changes with no
  event to change it.
- **Names and titles.** The same person or place referred to by a different name or
  spelling.
- **Sequence.** Events in an order that cannot have happened, or an effect before
  its cause.

Both halves must be present in this passage. If one half is only implied, or would
depend on text you cannot see, leave it out.

Quote the *second* half — the part that conflicts with what came before — and say what it
conflicts with.

Most passages contain none of these, and an empty list is a good answer. But check each
kind before concluding that. Do not report a difference the passage itself explains: a
character who changes clothes, ages, learns something, or is transformed by the story is
not contradicting anything.

Return JSON: {"findings": [{"quote": "...", "concern": "...", "why": "..."}]}

${context.label ? `Passage (${context.label}):` : 'Passage:'}
"""
${context.text}
"""`;
  },
};
