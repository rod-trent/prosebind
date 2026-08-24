#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineIndex, Project } from '@prosebind/core';
import type { Diagnostic } from '@prosebind/core';
import { findManuscripts } from '@prosebind/daemon';
import { SUPPORTED_MUTATIONS, makeRandom, mutateDocument, type Mutation } from './mutate.js';
import { score, scoreClean, type CleanRunScore, type RunScore } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

interface Options {
  project: string;
  clean: string;
  trials: number;
  errors: number;
  seed: number;
  json: boolean;
}

function parse(argv: readonly string[]): Options {
  // One corpus serves both experiments: mutated copies in memory for detection, and
  // the untouched original for false positives. It must start with zero findings, or
  // pre-existing ones contaminate both columns — see `detection`.
  const options: Options = {
    project: resolve(repoRoot, 'benchmarks', 'fixtures', 'quarry-clean'),
    clean: resolve(repoRoot, 'benchmarks', 'fixtures', 'quarry-clean'),
    trials: 20,
    errors: 3,
    seed: 1,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => argv[++i] ?? '';
    if (arg === '--project') options.project = resolve(next());
    else if (arg === '--clean') options.clean = resolve(next());
    else if (arg === '--trials') options.trials = Number.parseInt(next(), 10) || options.trials;
    else if (arg === '--errors') options.errors = Number.parseInt(next(), 10) || options.errors;
    else if (arg === '--seed') options.seed = Number.parseInt(next(), 10) || options.seed;
    else if (arg === '--json') options.json = true;
  }
  return options;
}

async function loadProject(root: string): Promise<{ project: Project; texts: Map<string, string> }> {
  const project = await Project.open(root);
  const texts = new Map<string, string>();
  for (const path of await findManuscripts(root)) {
    const text = await readFile(path, 'utf8');
    texts.set(path, text);
    project.setDocument(path, text);
  }
  return { project, texts };
}

function lineLookup(project: Project): (diagnostic: Diagnostic) => number {
  const cache = new Map<string, LineIndex>();
  return (diagnostic) => {
    let index = cache.get(diagnostic.file);
    if (!index) {
      const doc = project.document(diagnostic.file);
      if (!doc) return -1;
      index = new LineIndex(doc.text);
      cache.set(diagnostic.file, index);
    }
    return index.positionAt(diagnostic.span.start).line;
  };
}

/**
 * Detection experiment: inject known errors, measure whether Tier 0 finds them and
 * whether it invents anything along the way.
 */
async function detection(options: Options): Promise<{ runs: RunScore[]; totalMutations: number }> {
  const { project: clean, texts } = await loadProject(options.project);
  const baseline = clean.analyze().diagnostics;

  // The experiment is only sound on a corpus that starts clean.
  //
  // Subtracting a non-empty baseline by finding identity looks like it works and does
  // not: several checks emit a message with no location in it, so a newly injected
  // pov-drift is indistinguishable from a pre-existing one and gets discarded as
  // "already there". That silently converts real detections into misses. Refusing to
  // run is better than reporting a number produced that way.
  if (baseline.length > 0) {
    const summary = [...new Set(baseline.map((d) => d.check))].join(', ');
    throw new Error(
      `The detection corpus must start with zero findings; ${relative(repoRoot, options.project)} ` +
        `has ${baseline.length} (${summary}).\n` +
        'Injected errors cannot be told apart from pre-existing ones, because some checks ' +
        'emit identical messages regardless of location.\n' +
        'Pass --project with a clean corpus.',
    );
  }

  const runs: RunScore[] = [];
  let totalMutations = 0;

  for (let trial = 0; trial < options.trials; trial++) {
    const random = makeRandom(options.seed + trial * 7919);
    const mutated = await Project.open(options.project);
    const mutations: Mutation[] = [];

    for (const [path, original] of texts) {
      const doc = clean.document(path);
      if (!doc) continue;
      const result = mutateDocument(doc, clean.graph, {
        count: options.errors,
        random,
        checks: SUPPORTED_MUTATIONS,
      });
      mutations.push(...result.mutations);
      mutated.setDocument(path, result.text || original);
    }

    const found = mutated.analyze().diagnostics;
    totalMutations += mutations.length;
    runs.push(score({ baseline, mutated: found, mutations, lineOf: lineLookup(mutated) }));
  }

  return { runs, totalMutations };
}

/** False-positive experiment: prose believed clean, so every finding is a mistake. */
async function cleanRun(root: string): Promise<CleanRunScore | undefined> {
  try {
    const { project } = await loadProject(root);
    const result = project.analyze();
    return scoreClean(result.diagnostics, result.stats.words);
  } catch {
    return undefined;
  }
}

function aggregate(runs: readonly RunScore[]): {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  byCheck: Map<string, { tp: number; fp: number; fn: number }>;
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const byCheck = new Map<string, { tp: number; fp: number; fn: number }>();

  for (const run of runs) {
    tp += run.truePositives;
    fp += run.falsePositives;
    fn += run.falseNegatives;
    for (const [check, value] of run.byCheck) {
      const bucket = byCheck.get(check) ?? { tp: 0, fp: 0, fn: 0 };
      bucket.tp += value.truePositives;
      bucket.fp += value.falsePositives;
      bucket.fn += value.falseNegatives;
      byCheck.set(check, bucket);
    }
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1, byCheck };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));

  const { runs, totalMutations } = await detection(options);
  const totals = aggregate(runs);
  const clean = await cleanRun(options.clean);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          project: relative(repoRoot, options.project),
          trials: options.trials,
          errorsPerTrial: options.errors,
          seed: options.seed,
          injected: totalMutations,
          detection: {
            truePositives: totals.tp,
            falsePositives: totals.fp,
            falseNegatives: totals.fn,
            precision: totals.precision,
            recall: totals.recall,
            f1: totals.f1,
            byCheck: Object.fromEntries(totals.byCheck),
          },
          cleanCorpus: clean
            ? { words: clean.words, findings: clean.findings, per10k: clean.per10k }
            : null,
        },
        null,
        2,
      )}\n`,
    );
    return totals.fp > 0 ? 1 : 0;
  }

  const out: string[] = [];
  out.push('Prosebind Tier 0 — benchmark');
  out.push('');
  out.push(`corpus        ${relative(repoRoot, options.project)}`);
  out.push(`trials        ${options.trials} × ${options.errors} injected errors (seed ${options.seed})`);
  out.push('');
  out.push('DETECTION — injected errors of classes Tier 0 claims to catch');
  out.push(`  injected    ${totalMutations}`);
  out.push(`  caught      ${totals.tp}`);
  out.push(`  missed      ${totals.fn}`);
  out.push(`  invented    ${totals.fp}`);
  out.push('');
  out.push(`  precision   ${pct(totals.precision)}   (of what it reported, how much was real)`);
  out.push(`  recall      ${pct(totals.recall)}   (of what was there, how much it found)`);
  out.push(`  F1          ${totals.f1.toFixed(3)}`);
  out.push('');
  out.push('  by check');
  const width = Math.max(...[...totals.byCheck.keys()].map((k) => k.length), 12);
  for (const [check, value] of [...totals.byCheck].sort((a, b) => a[0].localeCompare(b[0]))) {
    const p = value.tp + value.fp === 0 ? 1 : value.tp / (value.tp + value.fp);
    const r = value.tp + value.fn === 0 ? 1 : value.tp / (value.tp + value.fn);
    out.push(
      `    ${check.padEnd(width)}  caught ${String(value.tp).padStart(3)}  missed ${String(value.fn).padStart(3)}  ` +
        `invented ${String(value.fp).padStart(3)}   P ${pct(p).padStart(6)}  R ${pct(r).padStart(6)}`,
    );
  }

  out.push('');
  out.push('FALSE POSITIVES — prose with no known errors, so every finding is a mistake');
  if (!clean) {
    out.push('  (no clean corpus found; pass --clean <dir>)');
  } else {
    out.push(`  words       ${clean.words.toLocaleString('en-US')}`);
    out.push(`  findings    ${clean.findings}`);
    out.push(`  per 10k     ${clean.per10k.toFixed(3)}`);
    out.push(`  95% bound   < ${clean.upperBound95.toFixed(1)} per 10k`);
    if (clean.findings > 0) {
      for (const [check, count] of clean.byCheck) out.push(`    ${check}: ${count}`);
    }
    out.push('');
    out.push(`  Zero findings in ${clean.words.toLocaleString('en-US')} words does not establish a zero rate. The bound above`);
    out.push('  is what the corpus size actually supports, and it is wide. Narrowing it needs');
    out.push('  more clean prose, not better checks.');
  }

  out.push('');
  out.push('HOW TO READ THIS');
  out.push('  A perfect detection score here is weak evidence. The errors were injected by');
  out.push('  the same project that wrote the checks, in exactly the classes those checks');
  out.push('  target, into a corpus of a few hundred words. That makes this a regression');
  out.push('  harness — it tells you when a check breaks — and not a measure of how good');
  out.push('  the engine is.');
  out.push('');
  out.push('  These numbers are not comparable to FlawedFictions or ConStory-Bench, and');
  out.push('  must never be quoted as though they were.');
  out.push('');
  out.push('WHAT THIS DOES NOT MEASURE');
  out.push('  Tier 0 is deterministic and needs a writer-authored bible. It is not run');
  out.push('  against FlawedFictions or ConStory-Bench, which supply stories with no bible');
  out.push('  and test errors requiring inference. With no declared entities no mentions');
  out.push('  are detected and nothing fires, so a near-zero score there would be a');
  out.push('  category error rather than a finding. Those benchmarks become meaningful');
  out.push('  once Tier 1 extraction can build a bible from prose — DESIGN.md § 7 and § 12.');

  process.stdout.write(`${out.join('\n')}\n`);

  // A false positive is the product risk. Fail the run so CI notices a regression.
  return totals.fp > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 70;
  });
