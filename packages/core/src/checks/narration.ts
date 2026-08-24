import { countWords } from '../text.js';
import type { Check, CheckContext, Diagnostic } from './types.js';
import { makeDiagnostic, maskDialogue } from './util.js';

const PRESENT_VERBS =
  /\b(?:is|are|walks|runs|says|looks|turns|stands|sits|opens|closes|takes|goes|comes|knows|feels|sees|hears|reaches|pulls|pushes|watches|holds|waits|steps|moves|thinks)\b/gi;
const PAST_MARKERS =
  /\b(?:was|were|had|did|could|would|said|looked|turned|walked|took|went|came|knew|felt|saw|heard|reached|pulled|pushed|watched|held|waited|stepped|moved|thought)\b/gi;

function count(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let n = 0;
  while (pattern.exec(text) !== null) n++;
  return n;
}

/**
 * Narration slipping out of the manuscript's declared tense.
 *
 * Dialogue is masked before counting, because a character speaking in the present
 * inside a past-tense novel is correct prose. We only speak up when a paragraph is
 * unambiguously present-tense and contains no past-tense narration at all — a
 * deliberately high bar, because tense is the check most able to become noise.
 */
export const tenseDrift: Check = {
  id: 'tense-drift',
  category: 'narrative',
  describes: 'A paragraph of narration is in a different tense from the rest of the manuscript.',

  run(context: CheckContext): Diagnostic[] {
    const declared = context.graph.meta.tense?.toLowerCase();
    if (declared !== 'past' && declared !== 'present') return [];

    const { doc, segments } = context;
    const diagnostics: Diagnostic[] = [];

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;
      const prose = maskDialogue(segment.text);
      if (countWords(prose) < 25) continue;

      const present = count(prose, PRESENT_VERBS);
      const past = count(prose, PAST_MARKERS);

      const drifting =
        declared === 'past' ? present >= 3 && past === 0 : past >= 3 && present === 0;
      if (!drifting) continue;

      diagnostics.push(
        makeDiagnostic({
          check: 'tense-drift',
          category: 'narrative',
          severity: 'question',
          message: `This paragraph reads as ${declared === 'past' ? 'present' : 'past'} tense. The manuscript is ${declared} tense.`,
          detail: `${declared === 'past' ? present : past} verbs in the other tense, none in ${declared}. Dialogue was excluded from the count.`,
          doc,
          segment,
          span: { start: segment.span.start, end: Math.min(segment.span.end, segment.span.start + 120) },
          confidence: 0.7,
          suppressionKey: `tense-drift/${segment.hash.slice(0, 8)}`,
        }),
      );
    }

    return diagnostics;
  },
};

/**
 * First-person narration in a third-person manuscript.
 *
 * Dialogue and direct interior monologue are masked first. What survives is the
 * narrator's own voice, and a bare "I" there is either a real slip or a deliberate
 * shift the writer will suppress once.
 */
export const povDrift: Check = {
  id: 'pov-drift',
  category: 'narrative',
  describes: 'First-person narration appears in a manuscript declared as third person.',

  run(context: CheckContext): Diagnostic[] {
    const pov = context.graph.meta.pov?.toLowerCase();
    if (!pov || !pov.startsWith('third')) return [];

    const { doc, segments } = context;
    const diagnostics: Diagnostic[] = [];
    const firstPerson = /\b(?:I|I'm|I'd|I'll|I've|my|me)\b/g;

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;
      const prose = maskDialogue(segment.text);

      firstPerson.lastIndex = 0;
      const hits: number[] = [];
      let match: RegExpExecArray | null;
      while ((match = firstPerson.exec(prose)) !== null) hits.push(match.index);
      if (hits.length === 0) continue;

      const first = hits[0]!;
      const start = segment.span.start + first;
      diagnostics.push(
        makeDiagnostic({
          check: 'pov-drift',
          category: 'narrative',
          severity: hits.length > 1 ? 'contradiction' : 'question',
          message: `First-person narration here, but the manuscript is ${pov}.`,
          detail: `${hits.length} first-person pronoun${hits.length === 1 ? '' : 's'} outside dialogue. If this is interior monologue, mark it with italics or suppress this finding.`,
          doc,
          segment,
          span: { start, end: start + 1 },
          confidence: hits.length > 1 ? 0.8 : 0.6,
          suppressionKey: `pov-drift/${segment.hash.slice(0, 8)}`,
        }),
      );
    }

    return diagnostics;
  },
};
