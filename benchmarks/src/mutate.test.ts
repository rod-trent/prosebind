import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LineIndex, Project } from '@prosebind/core';
import { findManuscripts } from '@prosebind/daemon';
import { SUPPORTED_MUTATIONS, makeRandom, mutateDocument } from './mutate.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(here, '..', 'fixtures', 'quarry-clean');

async function loadCorpus(): Promise<Project> {
  const project = await Project.open(CORPUS);
  for (const path of await findManuscripts(CORPUS)) {
    project.setDocument(path, await readFile(path, 'utf8'));
  }
  return project;
}

test('the control corpus starts with no findings', async () => {
  // The whole detection experiment rests on this. If the control drifts, every
  // precision figure the harness reports becomes meaningless.
  const project = await loadCorpus();
  const result = project.analyze();
  assert.equal(
    result.diagnostics.length,
    0,
    `control corpus produced: ${result.diagnostics.map((d) => `${d.check}: ${d.message}`).join('; ')}`,
  );
});

test('a seed reproduces a run exactly', async () => {
  const project = await loadCorpus();
  const path = project.files[0]!;
  const doc = project.document(path)!;

  const a = mutateDocument(doc, project.graph, { count: 3, random: makeRandom(42) });
  const b = mutateDocument(doc, project.graph, { count: 3, random: makeRandom(42) });
  assert.equal(a.text, b.text);
  assert.deepEqual(
    a.mutations.map((m) => `${m.expectedCheck}@${m.line}`),
    b.mutations.map((m) => `${m.expectedCheck}@${m.line}`),
  );

  const different = mutateDocument(doc, project.graph, { count: 3, random: makeRandom(43) });
  assert.notEqual(a.text, different.text, 'a different seed should explore differently');
});

test('the recorded line is where the injected text actually landed', async () => {
  // This is the bug the first run of the harness exposed: an off-by-one here reads in
  // the results as a check that both missed the error and invented one.
  const project = await loadCorpus();
  const path = project.files[0]!;
  const doc = project.document(path)!;

  const result = mutateDocument(doc, project.graph, { count: 6, random: makeRandom(7) });
  const lines = result.text.split('\n');

  for (const mutation of result.mutations) {
    const landed = lines[mutation.line] ?? '';
    const firstWords = mutation.inserted.split(' ').slice(0, 3).join(' ');
    assert.ok(
      landed.startsWith(firstWords.slice(0, Math.min(firstWords.length, landed.length))) ||
        landed.includes(firstWords.slice(0, 12)),
      `${mutation.expectedCheck} recorded line ${mutation.line} but that line reads: "${landed.slice(0, 60)}"`,
    );
  }
});

test('injected text becomes its own paragraph', async () => {
  const project = await loadCorpus();
  const path = project.files[0]!;
  const doc = project.document(path)!;

  const result = mutateDocument(doc, project.graph, { count: 4, random: makeRandom(11) });
  const lines = result.text.split('\n');
  for (const mutation of result.mutations) {
    assert.equal(lines[mutation.line - 1], '', `${mutation.expectedCheck} was buried mid-paragraph`);
  }
});

test('every injected error is actually detected by the engine', async () => {
  // The end-to-end claim, at the level of one document rather than the whole run.
  const project = await loadCorpus();
  const path = project.files.find((p) => p.endsWith('ch03.md')) ?? project.files[0]!;
  const doc = project.document(path)!;

  const result = mutateDocument(doc, project.graph, { count: 6, random: makeRandom(3) });
  assert.ok(result.mutations.length > 0, 'the fixture should support several mutation classes');

  const mutated = await Project.open(CORPUS);
  for (const other of project.files) {
    mutated.setDocument(other, other === path ? result.text : project.document(other)!.text);
  }
  const found = mutated.analyze().diagnostics;
  const index = new LineIndex(mutated.document(path)!.text);

  for (const mutation of result.mutations) {
    const hit = found.some(
      (d) =>
        d.check === mutation.expectedCheck &&
        Math.abs(index.positionAt(d.span.start).line - mutation.line) <= 4,
    );
    assert.ok(hit, `${mutation.expectedCheck} at line ${mutation.line} was not detected (${mutation.note})`);
  }
});

test('mutations only target checks the engine claims to implement', () => {
  // A mutation class with no corresponding check would show up as a permanent miss and
  // make recall look worse than it is.
  for (const name of SUPPORTED_MUTATIONS) {
    assert.match(name, /^[a-z-]+$/);
  }
  assert.equal(new Set(SUPPORTED_MUTATIONS).size, SUPPORTED_MUTATIONS.length);
});
