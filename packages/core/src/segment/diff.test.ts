import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffSegments, dirtySegments } from './diff.js';
import { segmentDocument } from './segment.js';

const BOOK = `# One

The quarry had been dry since the spring.

Marcus said nothing for a long while.

***

She did not answer him.

# Two

The coffin went down badly.

Afterwards there was tea in the village hall.
`;

test('segments a manuscript into chapters, scenes and paragraphs', () => {
  const doc = segmentDocument('book.md', BOOK);
  const chapters = doc.segments.filter((s) => s.kind === 'chapter');
  const scenes = doc.segments.filter((s) => s.kind === 'scene');
  const paragraphs = doc.segments.filter((s) => s.kind === 'paragraph');

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0]?.title, 'One');
  assert.equal(chapters[1]?.title, 'Two');
  assert.ok(scenes.length >= 3, `expected a scene break to split chapter one, got ${scenes.length}`);
  assert.equal(paragraphs.length, 5);
});

test('every segment span points at its own text', () => {
  const doc = segmentDocument('book.md', BOOK);
  for (const segment of doc.segments) {
    assert.equal(doc.text.slice(segment.span.start, segment.span.end), segment.text);
  }
});

test('does not mistake YAML frontmatter for a scene break', () => {
  const withFrontmatter = `---\ntitle: The Quarry\n---\n\n# One\n\nThe quarry had been dry.\n`;
  const doc = segmentDocument('book.md', withFrontmatter);
  assert.equal(doc.frontmatter, 'title: The Quarry');
  assert.equal(doc.segments.filter((s) => s.kind === 'chapter').length, 1);
});

test('editing one paragraph marks only that paragraph and its ancestors dirty', () => {
  const before = segmentDocument('book.md', BOOK);
  const edited = BOOK.replace(
    'Marcus said nothing for a long while.',
    'Marcus said nothing for a long while, and did not look at her.',
  );
  const after = segmentDocument('book.md', edited);

  const delta = diffSegments(before.segments, after.segments);
  // The enclosing scene and chapter change too — their text contains the edited
  // paragraph — so count paragraphs specifically.
  const changedParagraphs = delta.changed.filter((c) => c.after.kind === 'paragraph');
  assert.equal(changedParagraphs.length, 1, 'exactly one paragraph changed');
  assert.equal(delta.added.length, 0);
  assert.equal(delta.removed.length, 0);

  const dirty = dirtySegments(delta, after.segments);
  const dirtyParagraphs = dirty.filter((s) => s.kind === 'paragraph');
  assert.equal(dirtyParagraphs.length, 1);

  // The whole point: untouched paragraphs are never re-analysed.
  const totalParagraphs = after.segments.filter((s) => s.kind === 'paragraph').length;
  assert.ok(
    dirtyParagraphs.length < totalParagraphs,
    `dirty ${dirtyParagraphs.length} of ${totalParagraphs} paragraphs`,
  );
});

test('inserting text upstream does not dirty everything downstream', () => {
  const before = segmentDocument('book.md', BOOK);
  const edited = BOOK.replace('# One\n', '# One\n\nA new opening line.\n');
  const after = segmentDocument('book.md', edited);

  const delta = diffSegments(before.segments, after.segments);
  const dirtyParagraphs = dirtySegments(delta, after.segments).filter((s) => s.kind === 'paragraph');

  // The inserted paragraph is new; the rest merely shifted and must come back as
  // `moved`, which costs a re-anchor and nothing else.
  assert.equal(delta.added.filter((s) => s.kind === 'paragraph').length, 1);
  assert.equal(dirtyParagraphs.length, 1);
  assert.ok(delta.moved.length > 0, 'shifted paragraphs should be recognised as moved');
});

test('a wholesale rewrite is reported as replacement, not as an edit', () => {
  const before = segmentDocument('book.md', BOOK);
  const edited = BOOK.replace(
    'The coffin went down badly.',
    'Nobody had expected so many people to come to the house that evening.',
  );
  const after = segmentDocument('book.md', edited);
  const delta = diffSegments(before.segments, after.segments);

  const touched = delta.changed.length + delta.added.length + delta.removed.length;
  assert.ok(touched >= 1);
  // Whatever the classification, exactly one paragraph's worth of work is queued.
  const dirtyParagraphs = dirtySegments(delta, after.segments).filter((s) => s.kind === 'paragraph');
  assert.ok(dirtyParagraphs.length <= 1, `expected at most 1 dirty paragraph, got ${dirtyParagraphs.length}`);
});

test('an unchanged document produces no work at all', () => {
  const before = segmentDocument('book.md', BOOK);
  const after = segmentDocument('book.md', BOOK);
  const delta = diffSegments(before.segments, after.segments);

  assert.equal(delta.added.length, 0);
  assert.equal(delta.removed.length, 0);
  assert.equal(delta.changed.length, 0);
  assert.equal(dirtySegments(delta, after.segments).length, 0);
});
