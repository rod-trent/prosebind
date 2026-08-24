import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { segmentDocument } from '@prosebind/core';
import { SceneExtractor } from './extract.js';
import { canonicalNames } from './link.js';
import { OllamaModel, listOllamaModels } from './providers/ollama.js';

/**
 * Integration coverage against a real local model.
 *
 * Skipped when Ollama is not running, because a suite that fails on a contributor's
 * laptop for want of a 3GB model download is a suite people learn to ignore. The
 * deterministic tests in `extract.test.ts` carry the pipeline's logic; these check the
 * one thing a stub cannot — that a small model actually produces something usable.
 *
 * Set PROSEBIND_LIVE_MODEL to pick a tag.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const FIXTURE = join(repoRoot, 'benchmarks', 'fixtures', 'quarry-clean');

const MODEL = process.env['PROSEBIND_LIVE_MODEL'] ?? 'gemma3:4b';
// Cold start on a 4B model is tens of seconds; see the latency note in the README.
const TIMEOUT_MS = 180_000;

async function liveModel(): Promise<OllamaModel | undefined> {
  const available = await listOllamaModels();
  if (available.length === 0) return undefined;
  const tag = available.includes(MODEL) ? MODEL : available[0];
  if (!tag) return undefined;
  return new OllamaModel({ model: tag, timeoutMs: TIMEOUT_MS });
}

function fixtureScene(file: string) {
  const path = join(FIXTURE, file);
  const doc = segmentDocument(path, readFileSync(path, 'utf8'));
  const scene = doc.segments.find((s) => s.kind === 'scene');
  assert.ok(scene, 'fixture should contain a scene');
  return scene;
}

test('a real local model extracts usable structure', { timeout: TIMEOUT_MS + 30_000 }, async (t) => {
  const model = await liveModel();
  if (!model) {
    t.skip('no Ollama models available');
    return;
  }

  const extractor = new SceneExtractor({ model, retries: 0 });
  const canonical = new Map([
    ['elena', 'Elena Vasquez'],
    ['elena vasquez', 'Elena Vasquez'],
    ['marcus', 'Marcus Vasquez'],
    ['marcus vasquez', 'Marcus Vasquez'],
  ]);

  const record = await extractor.extract(
    fixtureScene('ch01.md'),
    ['Elena Vasquez', 'Elena', 'Marcus Vasquez', 'Marcus'],
    canonical,
  );

  const names = record.extraction.characters.map((c) => c.name);

  // Both are unmistakably in the passage. If a model cannot find them, it is not
  // usable for Tier 1 and the writer should be told so rather than left guessing.
  assert.ok(names.includes('Elena Vasquez'), `expected Elena; got ${names.join(', ')}`);
  assert.ok(names.includes('Marcus Vasquez'), `expected Marcus; got ${names.join(', ')}`);

  // The failure that made linking necessary in the first place.
  assert.equal(
    new Set(names.map((n) => n.toLowerCase())).size,
    names.length,
    `the same person was returned twice: ${names.join(', ')}`,
  );
  assert.ok(!names.includes('Elena'), 'a short form should have been linked to the canonical name');
});

test('extracted attributes survive the plausibility filter', { timeout: TIMEOUT_MS + 30_000 }, async (t) => {
  const model = await liveModel();
  if (!model) {
    t.skip('no Ollama models available');
    return;
  }

  const extractor = new SceneExtractor({ model, retries: 0 });
  const record = await extractor.extract(fixtureScene('ch01.md'), [], new Map());

  // The fixture states no eye colour, age or occupation. Anything reported here is
  // something the model invented — the exact failure mode the filter exists for.
  for (const attribute of record.extraction.attributes) {
    assert.ok(
      attribute.value.split(/\s+/).length <= 3,
      `attribute leaked a sentence: ${attribute.predicate}=${attribute.value}`,
    );
  }
});

test('a missing model degrades instead of throwing', async () => {
  // No skip: this must hold everywhere, including CI with no Ollama at all.
  const absent = new OllamaModel({ model: 'definitely-not-pulled', host: 'http://127.0.0.1:9', timeoutMs: 1500 });
  assert.equal(await absent.available(), false);

  const errors: string[] = [];
  const extractor = new SceneExtractor({ model: absent, retries: 0, onError: (_id, e) => { errors.push(e.message); } });
  const record = await extractor.extract(fixtureScene('ch01.md'), []);

  assert.deepEqual(record.extraction.characters, [], 'Tier 1 yields nothing');
  assert.ok(errors.length > 0, 'and says why');
  assert.match(errors[0] ?? '', /Tier 0 keeps working/, 'the message tells the writer what still works');
});
