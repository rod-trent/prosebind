#!/usr/bin/env node
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmentDocument } from '@prosebind/core';
import { Analyzer, GrokModel, continuityLens } from '@prosebind/analyze';
import { balancedSample, loadFlawedFictions, type FlawedFictionsRow } from './flawedfictions.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Prosebind **Tier 2** against FlawedFictions.
 *
 * The companion to `run-ff.ts`, which measured Tier 0 plus a bootstrapped bible and
 * scored exactly chance. That result was architectural, not a bug: a bible derived from
 * a story cannot contradict that story, and five of eight checks need facts a writer
 * declares. See FLAWEDFICTIONS.md.
 *
 * Tier 2 is the only tier that can attempt this task — cold-read contradiction
 * detection with no oracle at all. Every finding still has to quote the passage and
 * survive re-anchoring, so a hallucinated location cannot become a positive.
 *
 * The stories are public-domain Gutenberg text, which is why `cloudAllowed` is set here
 * without ceremony. The same flag on a writer's own manuscript is a different decision.
 */

interface Options {
  scope: 'scene' | 'chapter';
  concurrency: number;
  all: boolean;
  limit: number;
  seed: number;
  model: string | undefined;
  out: string | undefined;
}

function parse(argv: readonly string[]): Options {
  const options: Options = { scope: 'chapter', concurrency: 4, all: false, limit: 10, seed: 3, model: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => argv[++i] ?? '';
    if (arg === '--limit') options.limit = Number.parseInt(next(), 10) || options.limit;
    else if (arg === '--seed') options.seed = Number.parseInt(next(), 10) || options.seed;
    else if (arg === '--model') options.model = next();
    else if (arg === '--scope') options.scope = next() === 'scene' ? 'scene' : 'chapter';
    else if (arg === '--out') options.out = resolve(next());
    else if (arg === '--concurrency') options.concurrency = Math.max(1, Number.parseInt(next(), 10) || options.concurrency);
    else if (arg === '--all') options.all = true;
  }
  return options;
}

interface Outcome {
  id: string;
  label: number;
  predicted: number;
  findings: string[];
  dropped: number;
  seconds: number;
}

async function evaluate(
  row: FlawedFictionsRow,
  model: GrokModel,
  scope: Options['scope'],
): Promise<Outcome> {
  const started = performance.now();
  const doc = segmentDocument(`${row.example_id}.md`, row.story);

  // A per-story analyzer, so a failure can be attributed to this story.
  //
  // The Analyzer deliberately degrades a failed call to "no findings" — correct for a
  // writer, whose other tiers keep working. In a benchmark it is poison: a rate limit
  // would silently become a confident "clean" verdict and deflate recall. So any error
  // here aborts the story instead, leaving it unrecorded for the resume pass.
  let failure: Error | undefined;
  const analyzer = new Analyzer({
    model,
    lenses: [continuityLens],
    // Gutenberg text, already public. A writer's manuscript is a different decision.
    policy: { cloudAllowed: true },
    onError: (_s, _l, error) => {
      failure ??= error;
    },
  });

  // One passage per call, and each passage exactly once. Scenes and chapters overlap —
  // taking both analysed the same prose twice, doubling cost and duplicating findings.
  //
  // Chapter is the default, and that is a measured choice rather than a taste. On the
  // same 20 stories, scene scope scored recall 40% and chapter scope 70%: a
  // contradiction whose halves sit in different scenes is invisible to a lens that only
  // ever sees one of them. Still well inside § 7 — chapter-scoped, never whole-manuscript.
  const scenes = doc.segments.filter((s) => s.kind === 'scene');
  const chapters = doc.segments.filter((s) => s.kind === 'chapter');
  const preferred = scope === 'chapter' ? chapters : scenes;
  const fallback = scope === 'chapter' ? scenes : chapters;
  const targets = preferred.length > 0 ? preferred : fallback.length > 0 ? fallback : doc.segments.slice(0, 1);

  const findings: string[] = [];
  let dropped = 0;
  for (const passage of targets) {
    const record = await analyzer.analyzeSegment(doc, passage, continuityLens);
    if (failure) throw failure;
    dropped += record.dropped;
    for (const diagnostic of record.diagnostics) findings.push(diagnostic.message);
  }

  return {
    id: row.example_id,
    label: row.cont_error,
    predicted: findings.length > 0 ? 1 : 0,
    findings,
    dropped,
    seconds: (performance.now() - started) / 1000,
  };
}

function report(outcomes: readonly Outcome[], options: Options, model: string): string {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const o of outcomes) {
    if (o.label === 1 && o.predicted === 1) tp++;
    else if (o.label === 0 && o.predicted === 1) fp++;
    else if (o.label === 0 && o.predicted === 0) tn++;
    else fn++;
  }

  const n = outcomes.length || 1;
  const accuracy = (tp + tn) / n;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const seconds = outcomes.reduce((s, o) => s + o.seconds, 0);
  const dropped = outcomes.reduce((s, o) => s + o.dropped, 0);

  return [
    'Prosebind Tier 2 on FlawedFictions (arXiv 2504.11900)',
    '',
    `sample      ${outcomes.length} stories, ${options.all ? 'the full set' : `balanced, seed ${options.seed}`}`,
    `pipeline    passage-contradiction lens (${model}), ${options.scope} scope -> any finding = "flawed"`,
    `time        ${(seconds / 60).toFixed(1)} min (${(seconds / n).toFixed(1)}s per story)`,
    '',
    '                 predicted flawed   predicted clean',
    `  actually flawed       ${String(tp).padStart(4)}              ${String(fn).padStart(4)}`,
    `  actually clean        ${String(fp).padStart(4)}              ${String(tn).padStart(4)}`,
    '',
    `  accuracy    ${pct(accuracy)}   (chance is 50.0% on a balanced sample)`,
    `  precision   ${pct(precision)}`,
    `  recall      ${pct(recall)}`,
    `  F1          ${f1.toFixed(3)}`,
    '',
    `  ${dropped} finding${dropped === 1 ? '' : 's'} dropped by the anchor gate (quote not locatable)`,
    '',
    'For comparison, Tier 0 with a bootstrapped bible scored 50.0% / F1 0.000 on the',
    'same benchmark — see FLAWEDFICTIONS.md for why that was architectural.',
  ].join('\n');
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));

  const model = new GrokModel({
    ...(options.model ? { model: options.model } : {}),
    timeoutMs: 180_000,
  });
  if (!(await model.available())) {
    process.stderr.write('No xAI model reachable. Set XAI_API_KEY (see the README).\n');
    return 1;
  }

  process.stderr.write('Loading FlawedFictions…\n');
  const rows = await loadFlawedFictions('flawed_fictions');
  if (!rows) {
    process.stderr.write('Could not load the dataset.\n');
    return 1;
  }

  // The full 414 takes hours, so completed stories are checkpointed and skipped on a
  // re-run with the same --out. --all uses every story rather than a balanced sample.
  const sample = options.all ? [...rows] : balancedSample(rows, options.limit, options.seed);

  const done = new Map<string, Outcome>();
  if (options.out) {
    try {
      const prior = JSON.parse(await readFile(options.out, 'utf8')) as { outcomes?: Outcome[] };
      for (const outcome of prior.outcomes ?? []) done.set(outcome.id, outcome);
      if (done.size > 0) process.stderr.write(`  resuming: ${done.size} already done
`);
    } catch {
      // No checkpoint yet.
    }
  }
  const analyzer = new Analyzer({
    model,
    lenses: [continuityLens],
    // Gutenberg text, already public. A writer's manuscript is a different decision.
    policy: { cloudAllowed: true },
    onError: (_s, _l, error) => process.stderr.write(`  ! ${error.message.slice(0, 100)}\n`),
  });

  const outcomes: Outcome[] = [...done.values()];
  const pending = sample.filter((row) => !done.has(row.example_id));
  process.stderr.write(`  ${pending.length} to run, ${options.concurrency} at a time\n`);

  const checkpoint = async (): Promise<void> => {
    if (!options.out) return;
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, JSON.stringify({ options, model: model.id, outcomes }, null, 2), 'utf8');
  };

  let next = 0;
  let finished = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const row = pending[index];
      if (!row) return;
      try {
        const outcome = await evaluate(row, model, options.scope);
        outcomes.push(outcome);
        finished++;
        process.stderr.write(
          `  [${finished}/${pending.length}] ${row.example_id} label=${row.cont_error} ` +
            `predicted=${outcome.predicted} (${outcome.seconds.toFixed(0)}s)\n`,
        );
        // Checkpoint often. Losing hours of work to a dropped connection would be its
        // own kind of bug, and this run is long enough for that to be likely.
        if (finished % 5 === 0) await checkpoint();
      } catch (error) {
        // One story failing must not end the run.
        process.stderr.write(`  ! ${row.example_id}: ${(error as Error).message.slice(0, 90)}\n`);
      }
    }
  };

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  await checkpoint();

  process.stdout.write(`${report(outcomes, options, model.id)}\n`);

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 70;
  });
