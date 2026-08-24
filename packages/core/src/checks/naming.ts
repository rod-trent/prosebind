import { levenshtein } from '../anchor/similarity.js';
import type { Check, CheckContext, Diagnostic } from './types.js';
import { makeDiagnostic, properNounCandidates } from './util.js';

/**
 * Catches "Elena" becoming "Elaina" three hundred pages later.
 *
 * Deliberately narrow. We only compare against names the writer declared in the bible,
 * we require a close but non-identical match, and we ignore anything already declared
 * as an alias. A tool that guesses at undeclared names would flag every place name and
 * every walk-on character, and be uninstalled by lunchtime.
 */
export const nameVariant: Check = {
  id: 'name-variant',
  category: 'factual',
  describes: 'A name that is one or two letters away from a name in your bible, but not declared as an alias.',

  run(context: CheckContext): Diagnostic[] {
    const { doc, graph, segments } = context;
    const known = new Set(graph.surfaces.map((s) => s.surface));
    const diagnostics: Diagnostic[] = [];

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;

      for (const candidate of properNounCandidates(segment.text)) {
        if (known.has(candidate.word)) continue;

        for (const { surface, entityId } of graph.surfaces) {
          // Short names produce false positives at distance 1 (Ann/Anna/Anne are
          // three different people), so require real length before we speak up.
          if (surface.length < 4 || candidate.word.length < 4) continue;
          if (Math.abs(surface.length - candidate.word.length) > 2) continue;

          const distance = levenshtein(candidate.word, surface, 2);
          if (distance === 0 || distance > 2) continue;

          // Distance 2 is where this check earns its false positives: "March" is two
          // edits from "Marcus", and flagging the month as a typo for the brother is
          // exactly the kind of wrong that gets a tool uninstalled. Require the word
          // to agree with the name at both ends before we accept that much drift.
          if (distance === 2) {
            if (surface.length < 6) continue;
            if (candidate.word.charAt(0) !== surface.charAt(0)) continue;
            if (candidate.word.slice(-1) !== surface.slice(-1)) continue;
          }

          const entity = graph.entity(entityId);
          if (!entity) continue;

          const start = segment.span.start + candidate.start;
          diagnostics.push(
            makeDiagnostic({
              check: 'name-variant',
              category: 'factual',
              severity: 'contradiction',
              message: `"${candidate.word}" is one letter from "${surface}". Did you mean ${entity.name}?`,
              detail: `"${surface}" is declared in your bible. "${candidate.word}" is not, and appears nowhere else.`,
              doc,
              segment,
              span: { start, end: start + candidate.word.length },
              confidence: distance === 1 ? 0.9 : 0.75,
              suppressionKey: `name-variant/${candidate.word}`,
            }),
          );
          break;
        }
      }
    }

    return diagnostics;
  },
};

/**
 * Two characters answering to the same name is a continuity trap the writer usually
 * knows about — hence `note`, not `contradiction`. But it silently degrades every
 * other check, because mentions become unattributable, so it is worth saying once.
 */
export const aliasCollision: Check = {
  id: 'alias-collision',
  category: 'factual',
  describes: 'Two entities in your bible share a name or alias, so mentions of it cannot be attributed.',

  run(context: CheckContext): Diagnostic[] {
    const { doc, graph, segments } = context;
    const bySurface = new Map<string, Set<string>>();
    for (const { surface, entityId } of graph.surfaces) {
      const set = bySurface.get(surface) ?? new Set<string>();
      set.add(entityId);
      bySurface.set(surface, set);
    }

    const colliding = [...bySurface.entries()].filter(([, ids]) => ids.size > 1);
    if (colliding.length === 0) return [];

    // Report against the first dirty segment only — this is a bible problem, not a
    // prose problem, and it must not fire once per occurrence.
    const segment = segments.find((s) => s.kind === 'paragraph') ?? segments[0];
    if (!segment) return [];

    return colliding.map(([surface, ids]) => {
      const names = [...ids]
        .map((id) => graph.entity(id)?.name ?? id)
        .join(' and ');
      return makeDiagnostic({
        check: 'alias-collision',
        category: 'factual',
        severity: 'note',
        message: `"${surface}" refers to both ${names} in your bible.`,
        detail: 'Mentions of this name cannot be attributed to one character, so presence and knowledge checks will skip them. Give one of them a distinct alias.',
        doc,
        segment,
        span: { start: segment.span.start, end: Math.min(segment.span.end, segment.span.start + 40) },
        confidence: 1,
        suppressionKey: `alias-collision/${surface}`,
      });
    });
  },
};
