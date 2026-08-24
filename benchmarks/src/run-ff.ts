#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContinuityGraph, detectMentions, runChecks, segmentDocument } from '@prosebind/core';
import type { Diagnostic, Document, Entity } from '@prosebind/core';
import { bindEvents } from '@prosebind/core';
import {
  OllamaModel,
  SceneExtractor,
  bootstrap,
  listOllamaModels,
  type ProposedCharacter,
} from '@prosebind/extract';
import { balancedSample, loadFlawedFictions, type FlawedFictionsRow } from './flawedfictions.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Prosebind against FlawedFictions.
 *
 * The pipeline stands in for a writer with an existing manuscript and no bible:
 * bootstrap one with Tier 1, then run Tier 0 against it. Predict "flawed" if any check
 * fires.
 *
 * One decision shapes the whole result and has to be stated plainly. The bootstrapped
 * bible is treated as **canon** for the run. In the product it is a proposal the writer
 * reviews (§ 6), and treating it as canon simulates a writer who accepted every line of
 * it unread. That is the worst case, and it is the right one to measure: it is where
 * false positives come from, and false positives are the product risk (§ 12).
 */

interface Options {
  limit: number;
  seed: number;
  model: string | undefined;
  split: 'flawed_fictions' | 'flawed_fictions_long';
  out: string | undefined;
}

function parse(argv: readonly string[]): Options {
  const options: Options = {
    limit: 40,
    seed: 1,
    model: undefined,
    split: 'flawed_fictions',
    out: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => argv[++i] ?? '';
    if (arg === '--limit') options.limit = Number.parseInt(next(), 10) || options.limit;
    else if (arg === '--seed') options.seed = Number.parseInt(next(), 10) || options.seed;
    else if (arg === '--model') options.model = next();
    else if (arg === '--long') options.split = 'flawed_fictions_long';
    else if (arg === '--out') options.out = resolve(next());
  }
  return options;
}

/** Turn a bootstrap proposal into a graph Tier 0 can check against. */
function graphFrom(characters: readonly ProposedCharacter[], doc: Document): ContinuityGraph {
  const graph = new ContinuityGraph();

  for (const character of characters) {
    const id = character.name.toLowerCase().replace(/\W+/g, '-');
    if (!id || graph.entity(id)) continue;

    const entity: Entity = {
      id,
      name: character.name,
      type: 'character',
      // Canon for the purposes of this run — see the header. In the product this is a
      // proposal, and the writer decides.
      tier: 'canon',
      aliases: character.aliases,
      attributes: character.attributes,
    };
    graph.addEntity(entity);

    for (const [predicate, value] of Object.entries(character.attributes)) {
      graph.addFact({
        id: `${id}:${predicate}`,
        entityId: id,
        predicate,
        value,
        tier: 'canon',
        confidence: 1,
        provenance: { source: 'bible', file: 'bootstrapped' },
      });
    }
  }

  // meta is deliberately left empty: nothing tells us the intended POV or tense, so
  // pov-drift and tense-drift stay silent rather than guessing and inventing findings.
  for (const segment of doc.segments) {
    graph.setMentions(segment.id, detectMentions(graph, segment));
  }
  bindEvents(graph, [doc]);
  return graph;
}

interface Outcome {
  id: string;
  label: number;
  predicted: number;
  findings: string[];
  characters: number;
  seconds: number;
  /** Which checks could even have fired, given what bootstrap produced. */
  eligible: Record<string, boolean>;
}

/**
 * Which Tier 0 checks had their preconditions met.
 *
 * A score of zero is only informative if you can say whether the checks were wrong or
 * merely inapplicable. Most of Tier 0 depends on facts a writer declares — a death
 * event, a birth date, the intended POV — and bootstrap produces none of them. Without
 * this breakdown the result reads as "the engine failed", when what actually happened
 * is that four of eight checks were structurally unable to run.
 */
function eligibility(graph: ContinuityGraph): Record<string, boolean> {
  const entities = graph.entities;
  const positionedEvent = (id: string | undefined): boolean =>
    id !== undefined && graph.event(id)?.position !== undefined;

  return {
    'deceased-active': entities.some((e) => positionedEvent(e.deceasedAfter)),
    'unintroduced-mention': entities.some((e) => positionedEvent(e.introducedAt)),
    'age-arithmetic': graph.meta.storyDate !== undefined && entities.some((e) => e.born),
    'pov-drift': (graph.meta.pov ?? '').startsWith('third'),
    'tense-drift': graph.meta.tense === 'past' || graph.meta.tense === 'present',
    'attribute-contradiction': graph.facts.some(
      (f) => f.tier === 'canon' && (f.predicate === 'eyes' || f.predicate === 'hair'),
    ),
    'name-variant': entities.length > 0,
    'alias-collision': entities.length > 1,
  };
}

async function evaluate(row: FlawedFictionsRow, extractor: SceneExtractor): Promise<Outcome> {
  const started = performance.now();
  const doc = segmentDocument(`${row.example_id}.md`, row.story);

  const proposal = await bootstrap({ extractor, documents: [doc], minScenes: 1 });
  const graph = graphFrom(proposal.characters, doc);

  const findings: Diagnostic[] = runChecks({
    doc,
    graph,
    segments: doc.segments,
    documents: [doc],
  });

  return {
    id: row.example_id,
    label: row.cont_error,
    predicted: findings.length > 0 ? 1 : 0,
    findings: findings.map((f) => f.check),
    characters: proposal.characters.length,
    seconds: (performance.now() - started) / 1000,
    eligible: eligibility(graph),
  };
}

function report(outcomes: readonly Outcome[], options: Options, model: string): string {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const outcome of outcomes) {
    if (outcome.label === 1 && outcome.predicted === 1) tp++;
    else if (outcome.label === 0 && outcome.predicted === 1) fp++;
    else if (outcome.label === 0 && outcome.predicted === 0) tn++;
    else fn++;
  }

  const n = outcomes.length || 1;
  const accuracy = (tp + tn) / n;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const byCheck = new Map<string, { onFlawed: number; onClean: number }>();
  for (const outcome of outcomes) {
    for (const check of new Set(outcome.findings)) {
      const entry = byCheck.get(check) ?? { onFlawed: 0, onClean: 0 };
      if (outcome.label === 1) entry.onFlawed++;
      else entry.onClean++;
      byCheck.set(check, entry);
    }
  }

  const totalSeconds = outcomes.reduce((sum, o) => sum + o.seconds, 0);
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

  const out: string[] = [];
  out.push('Prosebind on FlawedFictions (arXiv 2504.11900)');
  out.push('');
  out.push(`split       ${options.split}`);
  out.push(`sample      ${outcomes.length} stories, balanced, seed ${options.seed}`);
  out.push(`pipeline    Tier 1 bootstrap (${model}) -> Tier 0 checks -> any finding = "flawed"`);
  out.push(`time        ${(totalSeconds / 60).toFixed(1)} min (${(totalSeconds / n).toFixed(1)}s per story)`);
  out.push('');
  out.push('                 predicted flawed   predicted clean');
  out.push(`  actually flawed       ${String(tp).padStart(4)}              ${String(fn).padStart(4)}`);
  out.push(`  actually clean        ${String(fp).padStart(4)}              ${String(tn).padStart(4)}`);
  out.push('');
  out.push(`  accuracy    ${pct(accuracy)}   (chance is 50.0% on a balanced sample)`);
  out.push(`  precision   ${pct(precision)}`);
  out.push(`  recall      ${pct(recall)}`);
  out.push(`  F1          ${f1.toFixed(3)}`);

  if (byCheck.size > 0) {
    out.push('');
    out.push('  which checks fired');
    for (const [check, counts] of [...byCheck].sort((a, b) => b[1].onFlawed - a[1].onFlawed)) {
      out.push(
        `    ${check.padEnd(26)} on flawed ${String(counts.onFlawed).padStart(3)}   on clean ${String(counts.onClean).padStart(3)}`,
      );
    }
  } else {
    out.push('');
    out.push('  No check fired on any story.');
  }

  // Why a zero is a zero.
  const checkNames = Object.keys(outcomes[0]?.eligible ?? {});
  if (checkNames.length > 0) {
    out.push('');
    out.push('  could each check even run?');
    for (const check of checkNames) {
      const eligible = outcomes.filter((o) => o.eligible[check]).length;
      const fired = byCheck.get(check);
      const firedTotal = (fired?.onFlawed ?? 0) + (fired?.onClean ?? 0);
      const note =
        eligible === 0
          ? 'never — needs a fact bootstrap does not produce'
          : `eligible on ${eligible}/${outcomes.length}, fired ${firedTotal}`;
      out.push(`    ${check.padEnd(26)} ${note}`);
    }
  }

  const avgCharacters = outcomes.reduce((s, o) => s + o.characters, 0) / n;
  out.push('');
  out.push(`  bootstrap found ${avgCharacters.toFixed(1)} characters per story on average`);

  return out.join('\n');
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));

  const available = await listOllamaModels();
  if (available.length === 0) {
    process.stderr.write(
      'No local model. This benchmark needs Tier 1 to bootstrap a bible:\n  ollama pull gemma3:4b\n',
    );
    return 1;
  }
  const tag = options.model ?? (available.includes('gemma3:4b') ? 'gemma3:4b' : available[0]!);

  process.stderr.write('Loading FlawedFictions…\n');
  const rows = await loadFlawedFictions(options.split, (fetched, total) => {
    process.stderr.write(`  ${fetched}/${total}\r`);
  });
  if (!rows) {
    process.stderr.write('Could not load the dataset (offline?).\n');
    return 1;
  }
  process.stderr.write(`  ${rows.length} stories loaded.\n`);

  const sample = balancedSample(rows, options.limit, options.seed);
  const model = new OllamaModel({ model: tag, timeoutMs: 180_000 });
  const outcomes: Outcome[] = [];

  for (const [index, row] of sample.entries()) {
    // A fresh extractor per story: caching across unrelated stories would be wrong,
    // and each story is its own project.
    const extractor = new SceneExtractor({ model, retries: 0 });
    const outcome = await evaluate(row, extractor);
    outcomes.push(outcome);
    process.stderr.write(
      `  [${index + 1}/${sample.length}] ${row.example_id} label=${row.cont_error} ` +
        `predicted=${outcome.predicted} (${outcome.seconds.toFixed(1)}s)\n`,
    );
  }

  const text = report(outcomes, options, tag);
  process.stdout.write(`${text}\n`);

  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, JSON.stringify({ options, model: tag, outcomes }, null, 2), 'utf8');
    process.stderr.write(`\nPer-story results written to ${options.out}\n`);
  }

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

