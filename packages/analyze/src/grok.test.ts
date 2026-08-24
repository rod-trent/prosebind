import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelUnavailableError } from '@prosebind/extract';
import { GrokModel } from './providers/grok.js';
import { pickNewestGrok } from './providers/grok.js';

/**
 * The Grok provider, tested without a key.
 *
 * The version-picking heuristic gets the most attention because it is the part most
 * able to fail silently: choosing an older model produces a worse analysis and no
 * error, and nobody would notice.
 */

test('the newest Grok wins on version number', () => {
  assert.equal(pickNewestGrok(['grok-3', 'grok-4.6', 'grok-4.3']), 'grok-4.6');
  assert.equal(pickNewestGrok(['grok-2', 'grok-3']), 'grok-3');
  assert.equal(pickNewestGrok(['grok-4', 'grok-4.6']), 'grok-4.6');
});

test('a date suffix is not read as a minor version', () => {
  // `grok-4-0709` is a dated snapshot of 4, not version 4.709. Reading it as a minor
  // version would rank a snapshot above every later release.
  assert.equal(pickNewestGrok(['grok-4-0709', 'grok-4.6']), 'grok-4.6');
});

test('the version is a decimal, so 4.20 is older than 4.6', () => {
  // Caught against the live API. xAI's docs name 4.6 the flagship — "the most
  // intelligent and fastest model we've built" — while the 4.20 variants are earlier.
  // Reading the minor as an integer made 4.20 rank highest and silently selected a
  // weaker model, with no error anywhere.
  assert.equal(pickNewestGrok(['grok-4.20-0309-reasoning', 'grok-4.6']), 'grok-4.6');
});

test('the real model list from the xAI API resolves to the flagship', () => {
  const live = [
    'grok-4.20-0309-non-reasoning',
    'grok-4.20-0309-reasoning',
    'grok-4.20-multi-agent-0309',
    'grok-4.3',
    'grok-4.5',
    'grok-4.6',
    'grok-build-0.1',
    'grok-imagine-image',
    'grok-imagine-video',
  ];
  assert.equal(pickNewestGrok(live), 'grok-4.6');
});

test('an unpinned id beats a dated snapshot of the same version', () => {
  // The plain id is the one xAI keeps current.
  assert.equal(pickNewestGrok(['grok-4.6-0709', 'grok-4.6']), 'grok-4.6');
});

test('non-Grok models are ignored', () => {
  assert.equal(pickNewestGrok(['gpt-4o', 'claude-opus-5', 'grok-3']), 'grok-3');
  assert.equal(pickNewestGrok(['gpt-4o', 'some-other-model']), undefined);
  assert.equal(pickNewestGrok([]), undefined);
});

test('the provider is cloud, so the network boundary applies', () => {
  const model = new GrokModel({ apiKey: 'test', model: 'grok-4.6' });
  assert.equal(model.location, 'cloud');
  assert.match(model.describe, /sent to xAI/, 'the writer is told where their prose goes');
});

test('a missing key fails with something actionable', async () => {
  const model = new GrokModel({ apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'grok-4.6' });
  await assert.rejects(
    () => model.generate({ prompt: 'hello' }),
    (error: unknown) => {
      assert.ok(error instanceof ModelUnavailableError);
      assert.match(error.message, /XAI_API_KEY/);
      // A writer whose Tier 2 went quiet needs to know the rest still works.
      assert.match(error.message, /Tiers 0 and 1 keep working/);
      return true;
    },
  );
});

test('an unreachable endpoint degrades rather than hangs', async () => {
  const model = new GrokModel({
    apiKey: 'test',
    model: 'grok-4.6',
    baseUrl: 'http://127.0.0.1:9',
    timeoutMs: 1500,
  });
  await assert.rejects(() => model.generate({ prompt: 'hello' }), ModelUnavailableError);
  assert.equal(await model.available(), true, 'an explicitly named model needs no lookup');
});

test('model discovery reports unavailable rather than guessing', async () => {
  const model = new GrokModel({ apiKey: 'test', baseUrl: 'http://127.0.0.1:9', timeoutMs: 1500 });
  assert.equal(await model.available(), false, 'with no name and no reachable list, say so');
});
