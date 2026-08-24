import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ContinuityGraph, segmentDocument } from '@prosebind/core';
import type { Entity, Segment } from '@prosebind/core';
import { SceneExtractor, knownNamesFrom } from './extract.js';
import { canonicalNames, isNameSubset, isPlausibleAttribute, linkExtraction } from './link.js';
import { inferredFacts, mergeExtraction } from './merge.js';
import { bootstrap, renderProposal } from './bootstrap.js';
import { LOCAL_ONLY, ModelUnavailableError, assertPermitted, extractJson } from './provider.js';
import type { LanguageModel } from './provider.js';
import { StubModel, fixedExtraction } from './providers/stub.js';
import { normalizeExtraction } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const SCENE_TEXT = 'Elena walked the rim of the quarry. Marcus said nothing.\n';

function scene(text = SCENE_TEXT, path = '/book/ch01.md'): Segment {
  const doc = segmentDocument(path, `# One\n\n${text}`);
  return doc.segments.find((s) => s.kind === 'scene') ?? doc.segments[0]!;
}

function graphWith(entities: Array<Partial<Entity> & { name: string }>): ContinuityGraph {
  const graph = new ContinuityGraph();
  for (const spec of entities) {
    const id = spec.id ?? spec.name.toLowerCase().replace(/\W+/g, '-');
    graph.addEntity({
      id,
      name: spec.name,
      type: 'character',
      tier: 'canon',
      aliases: spec.aliases ?? [],
      attributes: spec.attributes ?? {},
    });
    for (const [predicate, value] of Object.entries(spec.attributes ?? {})) {
      graph.addFact({
        id: `${id}:${predicate}`,
        entityId: id,
        predicate,
        value,
        tier: 'canon',
        confidence: 1,
        provenance: { source: 'bible', file: 'characters.yaml' },
      });
    }
  }
  return graph;
}

// --- the tier boundary -----------------------------------------------------

test('the engine has no dependency on the model layer', () => {
  // Tier 0's model-free guarantee is structural, not a matter of discipline. If core
  // ever depends on @prosebind/extract, the promise in § 7 is quietly gone.
  const core = JSON.parse(readFileSync(join(repoRoot, 'packages', 'core', 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  assert.ok(!Object.keys(core.dependencies ?? {}).includes('@prosebind/extract'));
});

test('no check imports the model layer', () => {
  const dir = join(repoRoot, 'packages', 'core', 'src', 'checks');
  for (const file of ['registry.ts', 'naming.ts', 'presence.ts', 'attributes.ts', 'narration.ts']) {
    const source = readFileSync(join(dir, file), 'utf8');
    assert.doesNotMatch(source, /@prosebind\/extract|fetch\(|ollama/i, `${file} reaches outside Tier 0`);
  }
});

// --- untrusted output ------------------------------------------------------

test('JSON is recovered from a fenced block', () => {
  const parsed = extractJson('Sure!\n```json\n{"characters":[]}\n```\nHope that helps.');
  assert.deepEqual(parsed, { characters: [] });
});

test('JSON is recovered from surrounding prose', () => {
  const parsed = extractJson('Here you go: {"places":["quarry"]} — let me know.');
  assert.deepEqual(parsed, { places: ['quarry'] });
});

test('unparseable output degrades to an empty extraction rather than throwing', async () => {
  const model = new StubModel(() => 'I am afraid I cannot help with that.');
  const errors: string[] = [];
  const extractor = new SceneExtractor({ model, onError: (_id, e) => errors.push(e.message) });

  const record = await extractor.extract(scene(), []);
  assert.deepEqual(record.extraction.characters, []);
  assert.ok(errors.length > 0, 'the failure is reported, not swallowed silently');
});

test('structurally wrong fields are rejected', () => {
  const result = normalizeExtraction({
    characters: [
      { name: 'Elena', present: 'yes', speaks: true },
      { name: 'She walked to the gate and considered everything', present: true, speaks: false },
      { name: 42 },
    ],
    attributes: [
      { subject: 'Elena', predicate: 'eyes', value: 'GREY' },
      { subject: 'Elena', predicate: 'mood', value: 'sad' },
    ],
    places: ['quarry', 17],
    events: [{ summary: 'The funeral' }, { nope: true }],
  });

  assert.equal(result.characters.length, 1, 'a sentence is not a name');
  assert.equal(result.characters[0]?.present, true, '"yes" counts as true');
  assert.equal(result.attributes.length, 1, 'predicates outside the enum are dropped');
  assert.equal(result.attributes[0]?.value, 'grey', 'values are normalised');
  assert.deepEqual(result.places, ['quarry']);
  assert.equal(result.events.length, 1);
});

// --- entity linking --------------------------------------------------------

test('a full name and a short form become one character', () => {
  // The live model did exactly this: "Elena Vasquez" and "Elena" as two people.
  const canonical = canonicalNames(graphWith([{ name: 'Elena Vasquez', aliases: ['Elena'] }]));
  const linked = linkExtraction(
    {
      characters: [
        { name: 'Elena Vasquez', aliases: [], present: true, speaks: false },
        { name: 'Elena', aliases: [], present: false, speaks: true },
      ],
      attributes: [],
      places: [],
      events: [],
    },
    canonical,
  );

  assert.equal(linked.characters.length, 1);
  assert.equal(linked.characters[0]?.name, 'Elena Vasquez');
  assert.equal(linked.characters[0]?.present, true, 'presence survives the merge');
  assert.equal(linked.characters[0]?.speaks, true, 'so does speech');
});

test('short forms fold into longer names with no bible at all', () => {
  // The bootstrap case: no canon to link against.
  const linked = linkExtraction(
    {
      characters: [
        { name: 'Elena', aliases: [], present: true, speaks: false },
        { name: 'Elena Vasquez', aliases: [], present: false, speaks: false },
      ],
      attributes: [{ subject: 'Elena', predicate: 'eyes', value: 'grey' }],
      places: [],
      events: [],
    },
    new Map(),
  );
  assert.equal(linked.characters.length, 1);
  assert.equal(linked.characters[0]?.name, 'Elena Vasquez');
  assert.equal(linked.attributes[0]?.subject, 'Elena Vasquez', 'attributes follow the rename');
});

test('different people are never merged', () => {
  // Fusing two characters silently merges their facts, which is far worse than
  // leaving a duplicate for the writer to notice.
  assert.equal(isNameSubset('Ruth', 'Elena Vasquez'), false);
  assert.equal(isNameSubset('Elena', 'Elena Vasquez'), true);
  assert.equal(isNameSubset('Vasquez', 'Elena Vasquez'), true);
  assert.equal(isNameSubset('Elena Vasquez', 'Elena'), false, 'longer never folds into shorter');
  assert.equal(isNameSubset('Marcus', 'Marcus'), false);
});

test('implausible attribute values are rejected', () => {
  // Both of these came out of the live 4B model on the fixture.
  assert.equal(isPlausibleAttribute('age', 'eleven years'), false, 'a duration is not an age');
  assert.equal(isPlausibleAttribute('age', '38'), true);
  assert.equal(isPlausibleAttribute('age', 'thirty-two'), true);
  assert.equal(isPlausibleAttribute('age', 'years ago'), false);
  assert.equal(isPlausibleAttribute('eyes', 'grey'), true);
  assert.equal(
    isPlausibleAttribute('occupation', 'he had driven up from the coast that morning'),
    false,
  );
});

// --- caching ---------------------------------------------------------------

test('an unchanged scene is never sent to the model twice', async () => {
  const model = fixedExtraction({ characters: [{ name: 'Elena', present: true, speaks: false }] });
  const extractor = new SceneExtractor({ model });
  const target = scene();

  await extractor.extract(target, []);
  await extractor.extract(target, []);
  const third = await extractor.extract(target, []);

  assert.equal(model.calls.length, 1, 'the incremental contract must hold across the tier boundary');
  assert.equal(third.cached, true);
});

test('edited prose is re-extracted', async () => {
  const model = fixedExtraction({ characters: [] });
  const extractor = new SceneExtractor({ model });
  await extractor.extract(scene('Elena walked.'), []);
  await extractor.extract(scene('Elena walked to the gate and waited.'), []);
  assert.equal(model.calls.length, 2);
});

test('an unparseable scene is not retried forever', async () => {
  const model = new StubModel(() => 'nonsense');
  const extractor = new SceneExtractor({ model, retries: 0 });
  const target = scene();
  await extractor.extract(target, []);
  await extractor.extract(target, []);
  assert.equal(model.calls.length, 1, 'failure is cached too, or the budget burns on it');
});

// --- the network boundary --------------------------------------------------

test('a cloud model is refused by default', () => {
  const cloud: LanguageModel = {
    id: 'cloud:test',
    location: 'cloud',
    describe: 'a hosted model',
    generate: async () => ({ text: '{}', durationMs: 0, model: 'cloud:test' }),
    available: async () => true,
  };
  assert.throws(() => assertPermitted(cloud, LOCAL_ONLY, 1000), ModelUnavailableError);
});

test('an allowed cloud call is announced before it happens', () => {
  const cloud: LanguageModel = {
    id: 'cloud:test',
    location: 'cloud',
    describe: 'a hosted model',
    generate: async () => ({ text: '{}', durationMs: 0, model: 'cloud:test' }),
    available: async () => true,
  };
  const announced: Array<{ model: string; bytes: number }> = [];
  assertPermitted(cloud, {
    cloudAllowed: true,
    onCloudCall: (model, bytes) => announced.push({ model: model.id, bytes }),
  }, 4096);
  assert.deepEqual(announced, [{ model: 'cloud:test', bytes: 4096 }]);
});

test('a local model needs no permission', () => {
  const model = fixedExtraction({});
  assert.doesNotThrow(() => assertPermitted(model, LOCAL_ONLY, 1000));
});

// --- merging ---------------------------------------------------------------

test('extraction never overwrites canon', () => {
  const graph = graphWith([{ name: 'Elena', attributes: { eyes: 'grey' } }]);
  const report = mergeExtraction({
    graph,
    extraction: {
      characters: [],
      attributes: [{ subject: 'Elena', predicate: 'eyes', value: 'green' }],
      places: [],
      events: [],
    },
    file: '/book/ch01.md',
    segmentId: 'seg-1',
  });

  assert.equal(report.conflicts.length, 1, 'the disagreement is reported');
  const resolved = graph.resolveFact('elena', 'eyes');
  assert.equal(resolved?.value, 'grey', 'canon still wins');
  assert.equal(resolved?.tier, 'canon');
});

test('discovered characters are marked inferred, not canon', () => {
  const graph = graphWith([{ name: 'Elena' }]);
  const report = mergeExtraction({
    graph,
    extraction: {
      characters: [{ name: 'The Ferryman', aliases: [], present: true, speaks: true }],
      attributes: [],
      places: [],
      events: [],
    },
    file: '/book/ch01.md',
    segmentId: 'seg-1',
  });

  assert.equal(report.discovered.length, 1);
  assert.equal(report.discovered[0]?.tier, 'inferred');
  assert.equal(graph.entity('inferred:the-ferryman')?.tier, 'inferred');
  assert.equal(graph.entity('elena')?.tier, 'canon', 'the bible entry is untouched');
});

test('inferred facts carry provenance back to the prose', () => {
  const graph = graphWith([{ name: 'Elena' }]);
  mergeExtraction({
    graph,
    extraction: {
      characters: [],
      attributes: [{ subject: 'Elena', predicate: 'hair', value: 'black' }],
      places: [],
      events: [],
    },
    file: '/book/ch01.md',
    segmentId: 'seg-1',
  });

  const facts = inferredFacts(graph);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.provenance.source, 'text');
  assert.equal(facts[0]?.provenance.file, '/book/ch01.md');
  assert.ok((facts[0]?.confidence ?? 1) < 1, 'and never full confidence');
});

// --- bootstrap -------------------------------------------------------------

test('bootstrap aggregates across scenes and votes on attributes', async () => {
  let call = 0;
  const model = new StubModel(() => {
    call++;
    // Two scenes say grey, one says blue. Plurality should win.
    const eyes = call === 3 ? 'blue' : 'grey';
    return JSON.stringify({
      characters: [{ name: 'Elena Vasquez', aliases: ['Elena'], present: true, speaks: true }],
      attributes: [{ subject: 'Elena Vasquez', predicate: 'eyes', value: eyes }],
      places: ['the quarry'],
      events: [{ summary: `event ${call}` }],
    });
  });

  const documents = ['a', 'b', 'c'].map((name, i) =>
    segmentDocument(`/book/ch0${i + 1}.md`, `# ${name}\n\nElena Vasquez walked on. ${name}\n`),
  );

  const result = await bootstrap({ extractor: new SceneExtractor({ model }), documents });

  assert.equal(result.characters.length, 1);
  assert.equal(result.characters[0]?.name, 'Elena Vasquez');
  assert.equal(result.characters[0]?.scenes, 3);
  assert.equal(result.characters[0]?.attributes['eyes'], 'grey', 'plurality across scenes');
});

test('a proposal is marked as not canon and never written as one', async () => {
  const model = fixedExtraction({
    characters: [{ name: 'Elena', aliases: [], present: true, speaks: true }],
    attributes: [],
    places: [],
    events: [],
  });
  const documents = [segmentDocument('/book/ch01.md', '# One\n\nElena walked.\n')];
  const result = await bootstrap({ extractor: new SceneExtractor({ model }), documents });
  const yaml = renderProposal(result, 'stub');

  assert.match(yaml, /PROPOSED — not canon/);
  assert.match(yaml, /Review it/);
  assert.match(yaml, /scenes: 1/, 'frequency is shown so a walk-on is recognisable');
});

test('known names are offered to the model for linking', () => {
  const graph = graphWith([{ name: 'Elena Vasquez', aliases: ['Elena'] }, { name: 'Ruth' }]);
  const names = knownNamesFrom(graph);
  assert.ok(names.includes('Elena Vasquez'));
  assert.ok(names.includes('Elena'));
  assert.ok(names.includes('Ruth'));
});
