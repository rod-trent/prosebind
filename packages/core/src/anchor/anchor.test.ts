import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnchor, resolveAnchor } from './anchor.js';
import { levenshtein, similarity } from './similarity.js';

const CH3 = `The quarry had been dry since the spring. Elena walked the rim of it, counting
the places where the rock had given way. Marcus said nothing for a long while.

"You knew," he said at last. "About the letter."

She did not answer him. Below them the floor of the quarry was pale as bone, and
the light went out of the afternoon slowly, the way it always did that far north.`;

function anchorTo(text: string, quote: string) {
  const start = text.indexOf(quote);
  assert.notEqual(start, -1, `fixture must contain: ${quote}`);
  return createAnchor(text, { start, end: start + quote.length });
}

test('resolves verbatim at the recorded offset', () => {
  const anchor = anchorTo(CH3, 'the floor of the quarry was pale as bone');
  const r = resolveAnchor(CH3, anchor);
  assert.equal(r.status, 'exact');
  assert.equal(r.confidence, 1);
  assert.equal(CH3.slice(r.span!.start, r.span!.end), 'the floor of the quarry was pale as bone');
});

test('follows the passage when text is inserted upstream', () => {
  const anchor = anchorTo(CH3, 'the floor of the quarry was pale as bone');
  const edited = 'A new opening paragraph, added later during revision.\n\n' + CH3;
  const r = resolveAnchor(edited, anchor);
  assert.equal(r.status, 'shifted');
  assert.ok(r.confidence > 0.8, `confidence ${r.confidence}`);
  assert.equal(edited.slice(r.span!.start, r.span!.end), 'the floor of the quarry was pale as bone');
});

test('follows the passage when a large block is deleted upstream', () => {
  const anchor = anchorTo(CH3, '"You knew," he said at last.');
  const edited = CH3.replace('The quarry had been dry since the spring. Elena walked the rim of it, counting\nthe places where the rock had given way. ', '');
  const r = resolveAnchor(edited, anchor);
  assert.ok(r.status === 'shifted' || r.status === 'exact', `got ${r.status}`);
  assert.equal(edited.slice(r.span!.start, r.span!.end), '"You knew," he said at last.');
});

test('survives a word processor substituting smart quotes', () => {
  const anchor = anchorTo(CH3, '"You knew," he said at last.');
  const edited = CH3.replace('"You knew," he said at last.', '“You knew,” he said at last.');
  const r = resolveAnchor(edited, anchor);
  assert.notEqual(r.status, 'lost');
  assert.ok(r.confidence >= 0.6, `confidence ${r.confidence}`);
});

test('recognises a lightly reworded passage as the same passage', () => {
  const anchor = anchorTo(CH3, 'Below them the floor of the quarry was pale as bone');
  const edited = CH3.replace(
    'Below them the floor of the quarry was pale as bone',
    'Below them the floor of the quarry was pale as old bone',
  );
  const r = resolveAnchor(edited, anchor);
  assert.equal(r.status, 'fuzzy');
  assert.ok(r.confidence >= 0.6, `confidence ${r.confidence}`);
  assert.ok(r.span!.start >= 0);
});

test('refuses to guess between genuinely identical candidates', () => {
  const repeated = 'She waited.\n\nShe waited.\n\nShe waited.\n';
  const anchor = createAnchor(repeated, { start: 13, end: 24 });
  const r = resolveAnchor(repeated, anchor);
  // The middle occurrence still resolves exactly; a *moved* one must not be guessed.
  const moved = 'Something new.\n\n' + repeated;
  const r2 = resolveAnchor(moved, { ...anchor, start: 999 });
  assert.equal(r.status, 'exact');
  assert.ok(r2.status === 'ambiguous' || r2.status === 'shifted', `got ${r2.status}`);
  if (r2.status === 'ambiguous') assert.equal(r2.confidence, 0);
});

test('disambiguates repeated text using surrounding context', () => {
  const doc = 'Marcus nodded. She waited. The rain began.\n\nElena sighed. She waited. The door opened.';
  const second = doc.lastIndexOf('She waited.');
  const anchor = createAnchor(doc, { start: second, end: second + 'She waited.'.length });
  const edited = 'An inserted first line.\n\n' + doc;
  const r = resolveAnchor(edited, anchor);
  assert.equal(r.status, 'shifted');
  const resolved = r.span!.start;
  assert.equal(edited.slice(resolved, resolved + 11), 'She waited.');
  // Must land on the *second* occurrence, the one whose context matches.
  assert.equal(resolved, edited.lastIndexOf('She waited.'));
});

test('reports lost when the passage is genuinely gone', () => {
  const anchor = anchorTo(CH3, 'the light went out of the afternoon slowly');
  const edited = CH3.replace(
    'and\nthe light went out of the afternoon slowly, the way it always did that far north.',
    'and everyone went home.',
  );
  const r = resolveAnchor(edited, anchor);
  assert.ok(r.status === 'lost' || r.confidence < 0.75, `got ${r.status} @ ${r.confidence}`);
});

test('bounded levenshtein abandons early without lying', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('kitten', 'sitting', 2), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('same', 'same'), 0);
  assert.ok(similarity('Elena', 'Elaina') > 0.6);
  assert.ok(similarity('Elena', 'Marcus') < 0.4);
});
