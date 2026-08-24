import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContinuityGraph, segmentDocument } from '@prosebind/core';
import type { Document, Segment } from '@prosebind/core';
import { StubModel, fixedExtraction } from '@prosebind/extract';
import type { LanguageModel } from '@prosebind/extract';
import { Analyzer, anchorFindings, summariseCanon } from './analyze.js';
import { normalizeLensResult } from './lens.js';
import { continuityLens, motivationLens } from './index.js';
import { TIER2_LENSES } from './index.js';

const PROSE = `# One

The quarry had been dry since the spring. Elena walked the rim of it, counting the
places where the rock had given way over the winter.

Marcus arrived later than he had promised. He had driven up from the coast that
morning and had not taken off his coat.
`;

function fixture(): { doc: Document; scene: Segment } {
  const doc = segmentDocument('/book/ch01.md', PROSE);
  const scene = doc.segments.find((s) => s.kind === 'scene') ?? doc.segments[0]!;
  return { doc, scene };
}

function modelReturning(findings: unknown): StubModel {
  return new StubModel(() => JSON.stringify({ findings }));
}

// --- the anchoring gate ----------------------------------------------------

test('a finding that quotes the passage is kept', () => {
  const { doc, scene } = fixture();
  const { diagnostics, dropped } = anchorFindings(
    [{ quote: 'Marcus arrived later than he had promised', concern: 'Unexplained delay.' }],
    doc,
    scene,
    continuityLens,
  );

  assert.equal(diagnostics.length, 1);
  assert.equal(dropped, 0);
  assert.equal(
    doc.text.slice(diagnostics[0]!.span.start, diagnostics[0]!.span.end),
    'Marcus arrived later than he had promised',
  );
});

test('a finding that quotes text not in the passage is dropped', () => {
  // The failure mode this gate exists for: a model paraphrasing something it believes
  // it read. A writer sent hunting for a line that does not exist loses trust in every
  // other finding too.
  const { doc, scene } = fixture();
  const { diagnostics, dropped } = anchorFindings(
    [{ quote: 'Elena drew the revolver from her coat and fired twice', concern: 'Sudden violence.' }],
    doc,
    scene,
    continuityLens,
  );

  assert.equal(diagnostics.length, 0);
  assert.equal(dropped, 1);
});

test('a lightly reworded quote is recovered rather than discarded', () => {
  // Models paraphrase their own quotes. That is recoverable, and the anchoring layer
  // already solves exactly this problem for edited manuscripts.
  const { doc, scene } = fixture();
  const { diagnostics, dropped } = anchorFindings(
    [{ quote: 'Marcus arrived later than he promised', concern: 'Unexplained delay.' }],
    doc,
    scene,
    continuityLens,
  );

  assert.equal(dropped, 0);
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0]!.confidence < continuityLens.maxConfidence, 'and it costs confidence');
});

test('a quote is located within its own passage, not the whole document', () => {
  // Otherwise a quote from a later chapter would satisfy a finding about an earlier one.
  const doc = segmentDocument('/book/ch01.md', `# One\n\nAlpha sentence here.\n\n***\n\nBeta sentence here.\n`);
  const scenes = doc.segments.filter((s) => s.kind === 'scene');
  assert.ok(scenes.length >= 2);

  const { diagnostics, dropped } = anchorFindings(
    [{ quote: 'Beta sentence here', concern: 'From the other scene.' }],
    doc,
    scenes[0]!,
    continuityLens,
  );
  assert.equal(diagnostics.length, 0);
  assert.equal(dropped, 1);
});

test('a quote too short to anchor is rejected before it reaches the gate', () => {
  const result = normalizeLensResult({
    findings: [
      { quote: 'the', concern: 'too short' },
      { quote: 'Marcus arrived later', concern: 'long enough' },
    ],
  });
  assert.equal(result.findings.length, 1);
});

test('a finding with no quote is discarded', () => {
  const result = normalizeLensResult({ findings: [{ concern: 'Something feels off.' }] });
  assert.equal(result.findings.length, 0);
});

// --- scope -----------------------------------------------------------------

test('paragraphs are not analysed', async () => {
  // Too small to judge motivation or self-consistency against, and analysing every
  // paragraph would multiply the cost of the most expensive tier.
  const doc = segmentDocument('/book/ch01.md', PROSE);
  const paragraph = doc.segments.find((s) => s.kind === 'paragraph')!;
  const model = modelReturning([{ quote: 'The quarry had been dry', concern: 'x' }]);

  const analyzer = new Analyzer({ model, lenses: [continuityLens] });
  const record = await analyzer.analyzeSegment(doc, paragraph, continuityLens);

  assert.equal(record.diagnostics.length, 0);
  assert.equal(model.calls.length, 0, 'and the model is never called');
});

test('there is no API that accepts a whole manuscript', () => {
  // § 7: never whole-manuscript. Enforced structurally — anything wanting the book has
  // to loop, which puts the cost at the call site where it is visible.
  const analyzer = new Analyzer({ model: fixedExtraction({}), lenses: TIER2_LENSES });
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(analyzer));
  assert.ok(methods.includes('analyzeSegment'));
  assert.ok(!methods.some((m) => /manuscript|project|book|all Documents/i.test(m)));
});

// --- the network boundary --------------------------------------------------

test('a cloud model is refused unless the writer allowed it', async () => {
  const cloud: LanguageModel = {
    id: 'cloud:test',
    location: 'cloud',
    describe: 'a hosted model',
    generate: async () => ({ text: '{"findings":[]}', durationMs: 0, model: 'cloud:test' }),
    available: async () => true,
  };
  const errors: string[] = [];
  const { doc, scene } = fixture();

  const analyzer = new Analyzer({
    model: cloud,
    lenses: [continuityLens],
    onError: (_s, _l, error) => errors.push(error.message),
  });
  const record = await analyzer.analyzeSegment(doc, scene, continuityLens);

  assert.equal(record.diagnostics.length, 0);
  assert.match(errors[0] ?? '', /Refusing to send manuscript text/);
});

test('an allowed cloud call is announced with the byte count', async () => {
  const announced: Array<{ id: string; bytes: number }> = [];
  const cloud: LanguageModel = {
    id: 'cloud:test',
    location: 'cloud',
    describe: 'a hosted model',
    generate: async () => ({ text: '{"findings":[]}', durationMs: 0, model: 'cloud:test' }),
    available: async () => true,
  };
  const { doc, scene } = fixture();

  const analyzer = new Analyzer({
    model: cloud,
    lenses: [continuityLens],
    policy: { cloudAllowed: true, onCloudCall: (m, bytes) => announced.push({ id: m.id, bytes }) },
  });
  await analyzer.analyzeSegment(doc, scene, continuityLens);

  assert.equal(announced.length, 1);
  assert.ok(announced[0]!.bytes > 0, 'the writer is told how much text is leaving');
});

// --- behaviour -------------------------------------------------------------

test('an unchanged passage is analysed once per lens', async () => {
  const { doc, scene } = fixture();
  const model = modelReturning([]);
  const analyzer = new Analyzer({ model, lenses: [continuityLens] });

  await analyzer.analyzeSegment(doc, scene, continuityLens);
  await analyzer.analyzeSegment(doc, scene, continuityLens);
  const third = await analyzer.analyzeSegment(doc, scene, continuityLens);

  assert.equal(model.calls.length, 1, 'Tier 2 is the most expensive tier; it must cache');
  assert.equal(third.cached, true);
});

test('a failing model costs the writer nothing they had', async () => {
  const { doc, scene } = fixture();
  const model = new StubModel(() => {
    throw new Error('model exploded');
  });
  const errors: string[] = [];
  const analyzer = new Analyzer({ model, lenses: [continuityLens], onError: (_s, _l, e) => errors.push(e.message) });

  const record = await analyzer.analyzeSegment(doc, scene, continuityLens);
  assert.equal(record.diagnostics.length, 0);
  assert.equal(errors.length, 1);
});

test('every lens produces questions, never contradictions', () => {
  // § 10: Tier 2 is judgment. A rule engine can prove a contradiction; a lens cannot,
  // and dressing an opinion as a verdict is how a tool loses a writer's trust.
  for (const lens of TIER2_LENSES) {
    assert.equal(lens.severity, 'question', `${lens.id} claims more certainty than it has`);
    assert.ok(lens.maxConfidence < 0.8, `${lens.id} is too confident for a judgment call`);
  }
});

test('findings are namespaced so the tier is visible', async () => {
  const { doc, scene } = fixture();
  const model = modelReturning([
    { quote: 'Marcus arrived later than he had promised', concern: 'Unexplained delay.' },
  ]);
  const analyzer = new Analyzer({ model, lenses: [motivationLens] });
  const record = await analyzer.analyzeSegment(doc, scene, motivationLens);

  assert.equal(record.diagnostics[0]?.check, 't2:unearned-turn');
  assert.match(record.diagnostics[0]!.suppressionKey, /^t2:unearned-turn\//);
});

// --- canon -----------------------------------------------------------------

test('only canon is shown to a lens, never inference', () => {
  // Presenting a Tier 1 guess to Tier 2 as established would let one model's error
  // become another model's premise.
  const graph = new ContinuityGraph();
  graph.addEntity({ id: 'elena', name: 'Elena', type: 'character', tier: 'canon', aliases: [], attributes: { eyes: 'grey' } });
  graph.addFact({
    id: 'elena:eyes', entityId: 'elena', predicate: 'eyes', value: 'grey',
    tier: 'canon', confidence: 1, provenance: { source: 'bible', file: 'characters.yaml' },
  });
  graph.addEntity({ id: 'inferred:ferryman', name: 'The Ferryman', type: 'character', tier: 'inferred', aliases: [], attributes: {} });

  const summary = summariseCanon(graph) ?? '';
  assert.match(summary, /Elena/);
  assert.match(summary, /grey/);
  assert.doesNotMatch(summary, /Ferryman/);
});

test('an empty bible produces no canon block', () => {
  assert.equal(summariseCanon(new ContinuityGraph()), undefined);
});
