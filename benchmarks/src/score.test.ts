import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Diagnostic } from '@prosebind/core';
import type { Mutation } from './mutate.js';
import { MATCH_WINDOW_LINES, score, scoreClean } from './score.js';

/**
 * The harness has to be harder to fool than the thing it measures. A scorer that
 * credits a finding for landing anywhere in the file, or that counts a pre-existing
 * finding as a detection, produces a number that flatters and means nothing.
 */

function diagnostic(partial: Partial<Diagnostic> & { check: string }): Diagnostic {
  return {
    id: `${partial.check}-${Math.random()}`,
    check: partial.check,
    category: 'factual',
    severity: 'contradiction',
    message: partial.message ?? `${partial.check} fired`,
    file: partial.file ?? '/corpus/ch01.md',
    span: partial.span ?? { start: 0, end: 1 },
    anchor: { quote: '', prefix: '', suffix: '', start: 0, quoteHash: '' },
    segmentId: 'seg',
    confidence: partial.confidence ?? 0.9,
    suppressionKey: partial.suppressionKey ?? `${partial.check}/x`,
  } as Diagnostic;
}

function mutation(check: string, line: number, file = '/corpus/ch01.md'): Mutation {
  return { expectedCheck: check, line, file, inserted: 'x', note: 'n' };
}

const at = (lines: Map<Diagnostic, number>) => (d: Diagnostic) => lines.get(d) ?? -999;

test('a finding at the injected line counts as a detection', () => {
  const found = diagnostic({ check: 'name-variant' });
  const result = score({
    baseline: [],
    mutated: [found],
    mutations: [mutation('name-variant', 10)],
    lineOf: at(new Map([[found, 10]])),
  });
  assert.equal(result.truePositives, 1);
  assert.equal(result.falsePositives, 0);
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 1);
});

test('a finding of the right check at the wrong place is not a detection', () => {
  // Otherwise a check that fires constantly would score perfectly.
  const found = diagnostic({ check: 'name-variant' });
  const result = score({
    baseline: [],
    mutated: [found],
    mutations: [mutation('name-variant', 10)],
    lineOf: at(new Map([[found, 10 + MATCH_WINDOW_LINES + 1]])),
  });
  assert.equal(result.truePositives, 0);
  assert.equal(result.falseNegatives, 1);
  assert.equal(result.falsePositives, 1, 'and the stray finding is counted against precision');
});

test('a finding of the wrong check does not satisfy a mutation', () => {
  const found = diagnostic({ check: 'tense-drift' });
  const result = score({
    baseline: [],
    mutated: [found],
    mutations: [mutation('pov-drift', 10)],
    lineOf: at(new Map([[found, 10]])),
  });
  assert.equal(result.truePositives, 0);
  assert.equal(result.falseNegatives, 1);
  assert.equal(result.falsePositives, 1);
});

test('one finding cannot satisfy two injected errors', () => {
  const found = diagnostic({ check: 'name-variant' });
  const result = score({
    baseline: [],
    mutated: [found],
    mutations: [mutation('name-variant', 10), mutation('name-variant', 11)],
    lineOf: at(new Map([[found, 10]])),
  });
  assert.equal(result.truePositives, 1);
  assert.equal(result.falseNegatives, 1);
});

test('pre-existing findings are excluded from both columns', () => {
  const existing = diagnostic({ check: 'pov-drift', message: 'First-person narration here.' });
  const fresh = diagnostic({ check: 'name-variant', message: 'Elana / Elena' });
  const result = score({
    baseline: [existing],
    mutated: [existing, fresh],
    mutations: [mutation('name-variant', 4)],
    lineOf: at(new Map([[fresh, 4], [existing, 99]])),
  });
  assert.equal(result.truePositives, 1);
  assert.equal(result.falsePositives, 0, 'the baseline finding is neither a success nor a failure');
});

test('findings in a different file do not count', () => {
  const found = diagnostic({ check: 'name-variant', file: '/corpus/ch09.md' });
  const result = score({
    baseline: [],
    mutated: [found],
    mutations: [mutation('name-variant', 10, '/corpus/ch01.md')],
    lineOf: at(new Map([[found, 10]])),
  });
  assert.equal(result.truePositives, 0);
});

test('per-check breakdown keeps a weak check from hiding behind a strong one', () => {
  const good = diagnostic({ check: 'name-variant' });
  const result = score({
    baseline: [],
    mutated: [good],
    mutations: [mutation('name-variant', 5), mutation('tense-drift', 20)],
    lineOf: at(new Map([[good, 5]])),
  });
  assert.equal(result.byCheck.get('name-variant')?.recall, 1);
  assert.equal(result.byCheck.get('tense-drift')?.recall, 0);
  assert.equal(result.recall, 0.5, 'and the aggregate reflects the miss');
});

test('clean-corpus scoring reports a bound, not just a point estimate', () => {
  const zero = scoreClean([], 577);
  assert.equal(zero.findings, 0);
  assert.equal(zero.per10k, 0);
  // Rule of three: 3/577 * 10000. Zero observed is not evidence of a zero rate.
  assert.ok(zero.upperBound95 > 50 && zero.upperBound95 < 55, `bound was ${zero.upperBound95}`);

  const bigger = scoreClean([], 200_000);
  assert.ok(bigger.upperBound95 < 1, 'a large corpus is what narrows the bound');
});

test('clean-corpus scoring counts every finding as a mistake', () => {
  const result = scoreClean([diagnostic({ check: 'pov-drift' }), diagnostic({ check: 'pov-drift' })], 10_000);
  assert.equal(result.findings, 2);
  assert.equal(result.per10k, 2);
  assert.equal(result.byCheck.get('pov-drift'), 2);
  assert.ok(result.upperBound95 > result.per10k);
});
