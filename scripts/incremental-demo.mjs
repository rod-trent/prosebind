#!/usr/bin/env node
/**
 * Demonstrates the claim the whole design rests on: editing one paragraph costs one
 * paragraph's worth of work, not a manuscript's.
 *
 *   node scripts/incremental-demo.mjs [project-dir]
 *
 * Run it after `npm run build`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Project } from '../packages/core/dist/index.js';
import { findManuscripts } from '../packages/daemon/dist/watcher.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '..', 'examples', 'the-quarry'));

const project = await Project.open(root);
const paths = await findManuscripts(root);
if (paths.length === 0) {
  console.error(`No manuscript files under ${root}`);
  process.exit(1);
}

for (const path of paths) project.setDocument(path, await readFile(path, 'utf8'));

const cold = project.analyze();
console.log(`cold start    ${cold.stats.segmentsAnalysed} of ${cold.stats.segments} segments · ${cold.stats.durationMs.toFixed(1)}ms`);

// A writer adds three words to one paragraph.
const target = paths[0];
const original = await readFile(target, 'utf8');
const paragraphBreak = original.indexOf('\n\n', original.indexOf('\n\n') + 2);
const edited =
  paragraphBreak === -1
    ? `${original}\n\nA sentence added during revision.\n`
    : `${original.slice(0, paragraphBreak)} A clause added during revision.${original.slice(paragraphBreak)}`;

project.setDocument(target, edited);
const warm = project.analyze();

console.log(`after one edit ${warm.stats.segmentsAnalysed} of ${warm.stats.segments} segments · ${warm.stats.durationMs.toFixed(1)}ms`);

const avoided = 1 - warm.stats.segmentsAnalysed / Math.max(1, cold.stats.segmentsAnalysed);
console.log(`work avoided  ${(avoided * 100).toFixed(0)}%`);
console.log(`findings      ${cold.diagnostics.length} cold → ${warm.diagnostics.length} warm`);

// The incremental path must not change the answer. If it does, the optimisation is
// a bug, and a silent one.
const coldKeys = cold.diagnostics.map((d) => d.suppressionKey).sort().join('|');
const warmKeys = warm.diagnostics.map((d) => d.suppressionKey).sort().join('|');
if (coldKeys !== warmKeys) {
  console.error('\nMISMATCH: incremental analysis produced a different result from a cold start.');
  process.exit(1);
}
console.log('\nIncremental result matches a cold start exactly.');
