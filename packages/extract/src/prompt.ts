import { PREDICATES } from './schema.js';

/**
 * The extraction prompt.
 *
 * Written for a 3–4B local model, which shapes everything about it: short instructions,
 * one job, an explicit refusal to speculate, and known names supplied up front so the
 * model links rather than invents. Larger models tolerate vaguer prompts; the whole
 * point of Tier 1 is that it does not need one.
 */

export const EXTRACTION_SYSTEM = `You extract facts from fiction. You do not write fiction, summarise it, or judge it.

Report only what the passage states or directly shows. If the passage does not say
something, leave it out. Never infer a detail because it seems likely — an invented fact
is worse than a missing one, because it will later be used to contradict the author.`;

export interface PromptContext {
  /** Names already in the writer's bible. Supplied so the model links instead of inventing. */
  knownNames: readonly string[];
  /** Scene text. */
  text: string;
  /** Where this sits, purely to help the model orient. */
  label?: string | undefined;
}

export function buildExtractionPrompt(context: PromptContext): string {
  const known =
    context.knownNames.length > 0
      ? `Known characters in this book: ${context.knownNames.join(', ')}.

This is a reference list, not a checklist. Include a character ONLY if this passage
actually names them. If the passage refers to one of them by a shorter form, report the
longest matching name from the list, once. Never list both a full name and a short form
as two characters.`
      : 'No characters are known yet for this book. Name everyone the passage names.';

  return `${known}

Extract from the passage below:

- characters: people this passage names. One entry per person. "present" means they are
  physically in the scene; "speaks" means they have dialogue here.
- attributes: lasting characteristics of a person that the passage states outright.
  Allowed predicates: ${PREDICATES.join(', ')}.
  "age" is how old someone is — never a length of time, a duration, or how long they
  have done something. "occupation" is a job they hold — never an action they happened
  to perform once.
  If the passage does not state a characteristic plainly, omit it. Omitting is correct;
  guessing is not.
- places: named locations.
- events: things that happen which matter to the story's timeline. Put any wording
  about when it happened in "when", copied from the passage.

Return JSON only.

${context.label ? `Passage (${context.label}):` : 'Passage:'}
"""
${context.text}
"""`;
}

/** Bounds the prose sent per call, so one enormous scene cannot blow the latency budget. */
export const MAX_SCENE_CHARS = 6000;

export function clampScene(text: string): string {
  if (text.length <= MAX_SCENE_CHARS) return text;
  // Keep the opening and the close: entrances and exits carry most of the presence
  // information, and the middle of a long scene is the least informative part to drop.
  const half = Math.floor(MAX_SCENE_CHARS / 2) - 20;
  return `${text.slice(0, half)}\n\n[…]\n\n${text.slice(-half)}`;
}
