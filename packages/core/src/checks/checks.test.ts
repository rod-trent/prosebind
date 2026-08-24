import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindEvents } from '../graph/bind.js';
import { ContinuityGraph, detectMentions } from '../graph/graph.js';
import type { Entity, StoryEvent, StoryMeta } from '../graph/types.js';
import { segmentDocument } from '../segment/segment.js';
import { runChecks } from './registry.js';
import type { Diagnostic } from './types.js';

interface Fixture {
  entities?: Array<Partial<Entity> & { name: string }>;
  events?: Array<Partial<StoryEvent> & { id: string; label: string }>;
  meta?: StoryMeta;
}

/** Build a project in memory and run every Tier 0 check over all of it. */
function analyse(fixture: Fixture, text: string): Diagnostic[] {
  const graph = new ContinuityGraph();
  graph.meta = fixture.meta ?? {};

  for (const spec of fixture.entities ?? []) {
    const entity: Entity = {
      id: spec.id ?? spec.name.toLowerCase().replace(/\W+/g, '-'),
      name: spec.name,
      type: spec.type ?? 'character',
      aliases: spec.aliases ?? [],
      attributes: spec.attributes ?? {},
      deceasedAfter: spec.deceasedAfter,
      introducedAt: spec.introducedAt,
      born: spec.born,
    };
    graph.addEntity(entity);
    for (const [predicate, value] of Object.entries(entity.attributes)) {
      graph.addFact({
        id: `${entity.id}:${predicate}`,
        entityId: entity.id,
        predicate,
        value,
        tier: 'canon',
        confidence: 1,
        provenance: { source: 'bible', file: 'characters.yaml' },
      });
    }
  }

  for (const [index, spec] of (fixture.events ?? []).entries()) {
    graph.addEvent({
      id: spec.id,
      label: spec.label,
      date: spec.date,
      ordinal: index,
      chapter: spec.chapter,
      at: spec.at,
      provenance: { source: 'bible', file: 'timeline.yaml' },
    });
  }

  const doc = segmentDocument('book.md', text);
  for (const segment of doc.segments) {
    graph.setMentions(segment.id, detectMentions(graph, segment));
  }
  bindEvents(graph, [doc]);

  return runChecks({ doc, graph, segments: doc.segments, documents: [doc] });
}

const only = (diagnostics: Diagnostic[], check: string): Diagnostic[] =>
  diagnostics.filter((d) => d.check === check);

// --- deceased-active -------------------------------------------------------

const DEATH_FIXTURE: Fixture = {
  entities: [{ name: 'Marcus', deceasedAfter: 'funeral' }],
  events: [{ id: 'funeral', label: 'The funeral', at: 'The coffin went down badly.' }],
};

test('deceased-active fires when a dead character speaks', () => {
  const found = analyse(
    DEATH_FIXTURE,
    'The coffin went down badly.\n\nLater that week, "You came back," Marcus said quietly.\n',
  );
  assert.equal(only(found, 'deceased-active').length, 1);
  assert.equal(only(found, 'deceased-active')[0]?.severity, 'contradiction');
});

test('deceased-active stays silent before the death', () => {
  const found = analyse(
    DEATH_FIXTURE,
    '"You came back," Marcus said quietly.\n\nThe coffin went down badly.\n',
  );
  assert.equal(only(found, 'deceased-active').length, 0);
});

test('deceased-active stays silent when the death event cannot be placed', () => {
  const found = analyse(
    { entities: [{ name: 'Marcus', deceasedAfter: 'funeral' }], events: [{ id: 'funeral', label: 'The funeral' }] },
    'Nothing anchors this.\n\n"Here I am," Marcus said.\n',
  );
  assert.equal(only(found, 'deceased-active').length, 0);
});

// --- name-variant ----------------------------------------------------------

test('name-variant catches a one-letter misspelling', () => {
  const found = analyse({ entities: [{ name: 'Elena Vasquez', aliases: ['Elena'] }] }, 'Then Elana stood by the window.\n');
  assert.equal(only(found, 'name-variant').length, 1);
});

test('name-variant does not fire on a declared alias', () => {
  const found = analyse(
    { entities: [{ name: 'Elena Vasquez', aliases: ['Elena', 'Elly'] }] },
    'Then Elly stood by the window, and Elena did not move.\n',
  );
  assert.equal(only(found, 'name-variant').length, 0);
});

test('name-variant does not fire on short similar names', () => {
  // Ann, Anna and Anne are three different people, not three typos.
  const found = analyse({ entities: [{ name: 'Ann' }] }, 'Then Anna crossed the room and Anne followed.\n');
  assert.equal(only(found, 'name-variant').length, 0);
});

test('name-variant does not fire on ordinary capitalised words', () => {
  const found = analyse(
    { entities: [{ name: 'Marcus' }] },
    'On Tuesday the March rain came in from the Atlantic, and Marcus waited.\n',
  );
  assert.equal(only(found, 'name-variant').length, 0);
});

// --- attribute-contradiction ----------------------------------------------

const EYES: Fixture = { entities: [{ name: 'Elena', attributes: { eyes: 'grey', hair: 'black' } }] };

test('attribute-contradiction catches a conflicting eye colour', () => {
  const found = analyse(EYES, 'Elena turned. Her green eyes were wet.\n');
  assert.equal(only(found, 'attribute-contradiction').length, 1);
});

test('attribute-contradiction accepts spelling variants of the same colour', () => {
  const found = analyse(
    { entities: [{ name: 'Elena', attributes: { eyes: 'grey' } }] },
    'Elena turned. Her gray eyes were wet.\n',
  );
  assert.equal(only(found, 'attribute-contradiction').length, 0);
});

test('attribute-contradiction ignores descriptions that are not colours', () => {
  const found = analyse(EYES, 'Elena turned. Her tangled hair fell across her tired eyes.\n');
  assert.equal(only(found, 'attribute-contradiction').length, 0);
});

test('attribute-contradiction stays silent with no nearby named character', () => {
  // No pronoun resolution in Tier 0. Guessing the subject would be the fastest
  // possible route to false positives.
  const found = analyse(EYES, 'Her green eyes were wet, though the wind was reason enough.\n');
  assert.equal(only(found, 'attribute-contradiction').length, 0);
});

// --- age-arithmetic --------------------------------------------------------

const AGED: Fixture = {
  entities: [{ name: 'Elena', born: '1987-04-02' }],
  meta: { storyDate: '2019-03-08' },
};

test('age-arithmetic catches an impossible age', () => {
  const found = analyse(AGED, 'Elena was 38 years old and unafraid.\n');
  assert.equal(only(found, 'age-arithmetic').length, 1);
});

test('age-arithmetic allows a year of slack for birthdays', () => {
  const found = analyse(AGED, 'Elena was 31 years old and unafraid.\n');
  assert.equal(only(found, 'age-arithmetic').length, 0);
});

test('age-arithmetic stays silent without a story date', () => {
  const found = analyse({ entities: [{ name: 'Elena', born: '1987-04-02' }] }, 'Elena was 38 years old.\n');
  assert.equal(only(found, 'age-arithmetic').length, 0);
});

// --- narration -------------------------------------------------------------

test('pov-drift ignores first person inside dialogue', () => {
  const found = analyse(
    { entities: [{ name: 'Marcus' }], meta: { pov: 'third-limited' } },
    '"I never understood why she went back," Marcus said. "I told her so at the time, and I meant it."\n',
  );
  assert.equal(only(found, 'pov-drift').length, 0);
});

test('pov-drift fires on first person in narration', () => {
  const found = analyse(
    { meta: { pov: 'third-limited' } },
    'I never understood why she went back to the water after everything that had happened there.\n',
  );
  assert.equal(only(found, 'pov-drift').length, 1);
});

test('tense-drift does not fire on a mixed paragraph', () => {
  const found = analyse(
    { meta: { tense: 'past' } },
    'She walked to the gate and the wind comes hard off the water, and she remembered the sound of it from before.\n',
  );
  assert.equal(only(found, 'tense-drift').length, 0);
});

test('tense-drift does not fire on short paragraphs', () => {
  const found = analyse({ meta: { tense: 'past' } }, 'She walks. She turns. She waits.\n');
  assert.equal(only(found, 'tense-drift').length, 0);
});

// --- suppression -----------------------------------------------------------

test('every diagnostic carries a suppression key', () => {
  const found = analyse(
    { ...EYES, meta: { pov: 'third-limited', tense: 'past' } },
    'Elena turned. Her green eyes were wet.\n',
  );
  assert.ok(found.length > 0);
  for (const diagnostic of found) {
    assert.ok(diagnostic.suppressionKey.length > 0, `${diagnostic.check} has no suppression key`);
    assert.ok(diagnostic.suppressionKey.includes('/'), `${diagnostic.check} key must be scoped by check`);
  }
});
