import { createAnchor } from '../anchor/anchor.js';
import type { Document, Segment } from '../segment/types.js';
import type { Span } from '../text.js';
import type { Category, Diagnostic, RelatedSpan, Severity } from './types.js';

let counter = 0;

export interface DiagnosticInit {
  check: string;
  category: Category;
  severity: Severity;
  message: string;
  detail?: string;
  doc: Document;
  segment: Segment;
  span: Span;
  confidence: number;
  related?: RelatedSpan[];
  suppressionKey: string;
}

export function makeDiagnostic(init: DiagnosticInit): Diagnostic {
  const anchor = createAnchor(init.doc.text, init.span);
  return {
    id: `${init.check}:${init.suppressionKey}:${(counter++).toString(36)}`,
    check: init.check,
    category: init.category,
    severity: init.severity,
    message: init.message,
    detail: init.detail,
    file: init.doc.path,
    span: init.span,
    anchor,
    segmentId: init.segment.id,
    confidence: init.confidence,
    related: init.related,
    suppressionKey: init.suppressionKey,
  };
}

/**
 * Blank out quoted dialogue while preserving every offset.
 *
 * Narration checks must not read what characters say. A character speaking in the
 * present tense inside a past-tense novel is correct prose; the narrator doing it is
 * the drift we are looking for.
 */
export function maskDialogue(text: string): string {
  const out = text.split('');
  let inDouble = false;
  let quoteChar = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (!inDouble && (ch === '"' || ch === '“' || ch === '«')) {
      inDouble = true;
      quoteChar = ch;
      continue;
    }
    if (inDouble) {
      const closes =
        (quoteChar === '"' && ch === '"') ||
        (quoteChar === '“' && ch === '”') ||
        (quoteChar === '«' && ch === '»');
      if (closes) {
        inDouble = false;
        continue;
      }
      if (ch !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

/** Words that begin sentences and are capitalised for grammar, not identity. */
export const CAPITALISED_STOPWORDS = new Set([
  'A', 'An', 'And', 'As', 'At', 'But', 'By', 'For', 'From', 'He', 'Her', 'Here', 'His',
  'How', 'I', 'If', 'In', 'It', 'Its', 'Later', 'Me', 'My', 'No', 'Not', 'Now', 'Of',
  'On', 'Once', 'One', 'Or', 'She', 'So', 'That', 'The', 'Their', 'Then', 'There',
  'These', 'They', 'This', 'Those', 'Through', 'To', 'Up', 'We', 'What', 'When',
  'Where', 'Which', 'While', 'Who', 'Why', 'With', 'Yes', 'Yet', 'You', 'Your',
  'After', 'Again', 'All', 'Almost', 'Already', 'Also', 'Always', 'Am', 'Are', 'Be',
  'Because', 'Been', 'Before', 'Below', 'Between', 'Both', 'Down', 'Even', 'Every',
  'Had', 'Has', 'Have', 'Him', 'Into', 'Just', 'Like', 'Made', 'Many', 'More', 'Most',
  'Much', 'Must', 'Never', 'Only', 'Other', 'Our', 'Out', 'Over', 'Own', 'Perhaps',
  'Said', 'Same', 'Should', 'Since', 'Some', 'Still', 'Such', 'Than', 'Them', 'Too',
  'Under', 'Until', 'Very', 'Was', 'Were', 'Will', 'Would', 'Nothing', 'Something',
  'Someone', 'Anything', 'Everything', 'Mr', 'Mrs', 'Ms', 'Dr',
  // Capitalised by convention, not by identity. Months and weekdays sit close enough
  // to real names in edit distance to be a standing false-positive source.
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'God', 'Lord', 'Christmas', 'Easter', 'English', 'French', 'German',
]);

/** Capitalised tokens that could plausibly be names, with their offsets. */
export function properNounCandidates(text: string): Array<{ word: string; start: number }> {
  const found: Array<{ word: string; start: number }> = [];
  const pattern = /\b\p{Lu}[\p{L}'’-]{2,}\b/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const word = match[0];
    if (CAPITALISED_STOPWORDS.has(word)) continue;
    found.push({ word, start: match.index });
  }
  return found;
}

/** Nearest entity mentioned at or before `offset` within the same segment. */
export function nearestSubject(
  mentions: ReadonlyArray<{ entityId: string; span: Span }>,
  offset: number,
  maxDistance = 240,
): string | undefined {
  let best: { entityId: string; distance: number } | undefined;
  for (const m of mentions) {
    if (m.span.end > offset) continue;
    const distance = offset - m.span.end;
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) best = { entityId: m.entityId, distance };
  }
  return best?.entityId;
}
