import { normalize } from '../text.js';
import type { Check, CheckContext, Diagnostic } from './types.js';
import { makeDiagnostic, maskDialogue, nearestSubject } from './util.js';

/**
 * Values we are confident enough to compare.
 *
 * Restricting to a closed vocabulary is what keeps this check quiet. "Her tangled
 * hair" must not argue with a canon value of "black" — tangled is not a colour, so we
 * say nothing rather than guessing.
 */
const COLOURS = new Set([
  'black', 'brown', 'blonde', 'blond', 'red', 'auburn', 'ginger', 'grey', 'gray',
  'white', 'silver', 'blue', 'green', 'hazel', 'amber', 'chestnut', 'copper',
  'sandy', 'golden', 'dark', 'pale', 'olive',
]);

interface AttributePattern {
  predicate: string;
  noun: string;
  patterns: RegExp[];
}

const ATTRIBUTES: AttributePattern[] = [
  {
    predicate: 'eyes',
    noun: 'eyes',
    patterns: [
      /\b(?:her|his|their)\s+([a-z]+)\s+eyes\b/gi,
      /\beyes\s+(?:were|are|had\s+gone)\s+([a-z]+)\b/gi,
      /\b([a-z]+)-eyed\b/gi,
    ],
  },
  {
    predicate: 'hair',
    noun: 'hair',
    patterns: [
      /\b(?:her|his|their)\s+([a-z]+)\s+hair\b/gi,
      /\bhair\s+(?:was|is)\s+([a-z]+)\b/gi,
      /\b([a-z]+)-haired\b/gi,
    ],
  },
];

/**
 * The prose asserts a physical detail that contradicts the bible.
 *
 * Canon always wins here (DESIGN.md § 6): we are not questioning the bible, we are
 * reporting that the manuscript disagrees with it. If the bible is the thing that is
 * wrong, the writer fixes the bible and the finding disappears.
 */
export const attributeContradiction: Check = {
  id: 'attribute-contradiction',
  category: 'factual',
  describes: 'A physical detail in the prose contradicts a value pinned in your bible.',

  run(context: CheckContext): Diagnostic[] {
    const { doc, graph, segments } = context;
    const diagnostics: Diagnostic[] = [];

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;
      const mentions = graph
        .mentionsIn(segment.id)
        .map((m) => ({ entityId: m.entityId, span: { start: m.span.start - segment.span.start, end: m.span.end - segment.span.start } }));
      if (mentions.length === 0) continue;

      const prose = maskDialogue(segment.text);

      for (const attribute of ATTRIBUTES) {
        for (const pattern of attribute.patterns) {
          pattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(prose)) !== null) {
            const asserted = (match[1] ?? '').toLowerCase();
            if (!COLOURS.has(asserted)) continue;

            const entityId = nearestSubject(mentions, match.index);
            if (!entityId) continue;

            const canon = graph.resolveFact(entityId, attribute.predicate);
            if (!canon || canon.tier !== 'canon') continue;

            const canonValue = normalize(canon.value);
            if (canonValue === asserted) continue;
            // Only argue when both sides name a colour; "dark" vs "black" is a
            // description, not a contradiction.
            if (!COLOURS.has(canonValue)) continue;
            if (areCompatible(canonValue, asserted)) continue;

            const entity = graph.entity(entityId);
            if (!entity) continue;

            const start = segment.span.start + match.index;
            diagnostics.push(
              makeDiagnostic({
                check: 'attribute-contradiction',
                category: 'factual',
                severity: 'contradiction',
                message: `${entity.name}'s ${attribute.noun} are ${asserted} here. Your bible says ${canon.value}.`,
                detail: `Canon set in ${canon.provenance.file}. Change the prose, or update the bible if the prose is right.`,
                doc,
                segment,
                span: { start, end: start + match[0].length },
                confidence: 0.85,
                suppressionKey: `attribute-contradiction/${entity.id}/${attribute.predicate}`,
              }),
            );
          }
        }
      }
    }

    return diagnostics;
  },
};

/** Pairs a careful writer uses interchangeably. */
const COMPATIBLE: ReadonlyArray<readonly [string, string]> = [
  ['grey', 'gray'],
  ['blonde', 'blond'],
  ['blonde', 'golden'],
  ['red', 'auburn'],
  ['red', 'ginger'],
  ['brown', 'chestnut'],
  ['brown', 'auburn'],
  ['silver', 'grey'],
  ['silver', 'gray'],
  ['silver', 'white'],
];

function areCompatible(a: string, b: string): boolean {
  return COMPATIBLE.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/**
 * A stated age that the arithmetic does not support.
 *
 * Needs `born` on the character and `storyDate` in meta.yaml. Without both we stay
 * silent rather than inferring a timeline the writer never committed to.
 */
export const ageArithmetic: Check = {
  id: 'age-arithmetic',
  category: 'timeline',
  describes: 'A character\'s stated age does not match their birth date and the story date.',

  run(context: CheckContext): Diagnostic[] {
    const { doc, graph, segments } = context;
    const storyDate = graph.meta.storyDate;
    if (!storyDate) return [];
    const storyYear = Number.parseInt(storyDate.slice(0, 4), 10);
    if (Number.isNaN(storyYear)) return [];

    const diagnostics: Diagnostic[] = [];
    const pattern = /\b(\d{1,3})[-\s]year[s]?[-\s]old\b|\bwas\s+(\d{1,3})\s+years?\s+old\b/gi;

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;
      const mentions = graph
        .mentionsIn(segment.id)
        .map((m) => ({ entityId: m.entityId, span: { start: m.span.start - segment.span.start, end: m.span.end - segment.span.start } }));
      if (mentions.length === 0) continue;

      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(segment.text)) !== null) {
        const stated = Number.parseInt(match[1] ?? match[2] ?? '', 10);
        if (Number.isNaN(stated)) continue;

        const entityId = nearestSubject(mentions, match.index);
        if (!entityId) continue;
        const entity = graph.entity(entityId);
        if (!entity?.born) continue;

        const bornYear = Number.parseInt(entity.born.slice(0, 4), 10);
        if (Number.isNaN(bornYear)) continue;

        const expected = storyYear - bornYear;
        // One year of slack absorbs birthdays we cannot place within the story's span.
        if (Math.abs(expected - stated) <= 1) continue;

        const start = segment.span.start + match.index;
        diagnostics.push(
          makeDiagnostic({
            check: 'age-arithmetic',
            category: 'timeline',
            severity: 'contradiction',
            message: `${entity.name} is ${stated} here, but would be ${expected} in ${storyYear}.`,
            detail: `Born ${entity.born}; story opens ${storyDate}.`,
            doc,
            segment,
            span: { start, end: start + match[0].length },
            confidence: 0.9,
            suppressionKey: `age-arithmetic/${entity.id}/${stated}`,
          }),
        );
      }
    }

    return diagnostics;
  },
};
