import { projectOffset } from '../graph/bind.js';
import type { Check, CheckContext, Diagnostic, RelatedSpan } from './types.js';
import { makeDiagnostic } from './util.js';

/**
 * A character who is dead does not speak.
 *
 * The highest-value Tier 0 check and the cheapest: the writer declares the death event
 * in the bible, the engine knows where every mention is, and the arithmetic is trivial.
 * It is also the check most likely to catch a real error in a long manuscript, because
 * a death in chapter 9 is 200 pages away from the slip in chapter 31.
 */
export const deceasedActive: Check = {
  id: 'deceased-active',
  category: 'timeline',
  describes: 'A character acts or speaks after the point where your bible says they died.',

  run(context: CheckContext): Diagnostic[] {
    const { doc, graph, segments, documents } = context;
    const diagnostics: Diagnostic[] = [];

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;

      for (const mention of graph.mentionsIn(segment.id)) {
        const entity = graph.entity(mention.entityId);
        if (!entity?.deceasedAfter) continue;

        const death = graph.event(entity.deceasedAfter);
        const position = death?.position;
        if (!death || !position) continue;

        const mentionAt = projectOffset(documents, doc.path, mention.span.start);
        const deathAt = projectOffset(documents, position.file, position.offset);
        if (mentionAt <= deathAt) continue;

        const related: RelatedSpan[] = [
          {
            file: position.file,
            span: { start: position.offset, end: position.offset + 60 },
            label: `${death.label}${death.date ? ` (${death.date})` : ''}`,
          },
        ];

        diagnostics.push(
          makeDiagnostic({
            check: 'deceased-active',
            category: 'timeline',
            severity: mention.speaking ? 'contradiction' : 'question',
            message: mention.speaking
              ? `${entity.name} speaks here, but died at "${death.label}".`
              : `${entity.name} appears here, but died at "${death.label}".`,
            detail:
              position.via === 'quote'
                ? `Death pinned to a quoted line${death.date ? ` on ${death.date}` : ''}.`
                : `Death pinned to chapter ${death.chapter ?? '?'} — approximate, so check the ordering yourself.`,
            doc,
            segment,
            span: mention.span,
            // A coarse chapter pin is weaker evidence than a quoted line.
            confidence: (mention.speaking ? 0.95 : 0.8) * position.confidence,
            related,
            suppressionKey: `deceased-active/${entity.id}/${segment.hash.slice(0, 8)}`,
          }),
        );
      }
    }

    return diagnostics;
  },
};

/**
 * A character referenced before the reader has met them.
 *
 * Milder than it sounds and deliberately a `question`: deliberate foreshadowing looks
 * identical to an accident, and only the writer knows which this is.
 */
export const unintroducedMention: Check = {
  id: 'unintroduced-mention',
  category: 'narrative',
  describes: 'A character is named before the point where your bible says they are introduced.',

  run(context: CheckContext): Diagnostic[] {
    const { doc, graph, segments, documents } = context;
    const diagnostics: Diagnostic[] = [];

    for (const segment of segments) {
      if (segment.kind !== 'paragraph') continue;

      for (const mention of graph.mentionsIn(segment.id)) {
        const entity = graph.entity(mention.entityId);
        if (!entity?.introducedAt) continue;

        const intro = graph.event(entity.introducedAt);
        const position = intro?.position;
        if (!intro || !position) continue;

        const mentionAt = projectOffset(documents, doc.path, mention.span.start);
        const introAt = projectOffset(documents, position.file, position.offset);
        if (mentionAt >= introAt) continue;

        diagnostics.push(
          makeDiagnostic({
            check: 'unintroduced-mention',
            category: 'narrative',
            severity: 'question',
            message: `${entity.name} is named here, before "${intro.label}" introduces them.`,
            detail: 'If this is deliberate foreshadowing, suppress it — the engine cannot tell the difference, and should not pretend to.',
            doc,
            segment,
            span: mention.span,
            confidence: 0.7 * position.confidence,
            related: [
              {
                file: position.file,
                span: { start: position.offset, end: position.offset + 60 },
                label: intro.label,
              },
            ],
            suppressionKey: `unintroduced-mention/${entity.id}`,
          }),
        );
      }
    }

    return diagnostics;
  },
};
