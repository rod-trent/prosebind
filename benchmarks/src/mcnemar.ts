#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Paired comparison of two Tier 2 runs by McNemar's test.
 *
 * Written to run exactly the analysis in PREREGISTRATION.md and nothing else. The
 * previous recall claim was retracted because a 5-story difference on 30 positives was
 * read as signal with no significance test; this file exists so that cannot recur by
 * accident.
 *
 * The test is paired on story id — only stories both arms recorded are compared, so a
 * resume gap in one arm cannot shift the sample the other arm is judged on.
 */

interface Outcome {
  id: string;
  label: number;
  predicted: number;
}

interface RunFile {
  options?: Record<string, unknown>;
  model?: string;
  outcomes: Outcome[];
}

async function load(path: string): Promise<Map<string, Outcome>> {
  const parsed = JSON.parse(await readFile(resolve(path), 'utf8')) as RunFile;
  return new Map(parsed.outcomes.map((o) => [o.id, o]));
}

interface Metrics {
  n: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

function metrics(outcomes: readonly Outcome[]): Metrics {
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
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return {
    n: outcomes.length,
    accuracy: (tp + tn) / (outcomes.length || 1),
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

/**
 * Two-sided p for McNemar's χ² with one degree of freedom.
 *
 * For df = 1 the survival function has a closed form, `erfc(sqrt(chi2 / 2))`, so no
 * table or gamma function is needed. `erfc` is Abramowitz & Stegun 7.1.26 — accurate to
 * ~1.5e-7, which is four orders of magnitude finer than any decision at α = 0.05.
 */
function chiSquarePValue(chi2: number): number {
  if (chi2 <= 0) return 1;
  return erfc(Math.sqrt(chi2 / 2));
}

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}

/**
 * Exact two-sided binomial p on the discordant pairs.
 *
 * Reported alongside χ² because the continuity-corrected χ² is an approximation that
 * misbehaves when discordant counts are small — and small is exactly where this
 * benchmark has repeatedly landed. When the two disagree, the exact test governs.
 */
function exactBinomialP(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

interface Discordance {
  bOnly: number;
  aOnly: number;
  chi2: number;
  p: number;
  exact: number;
}

/** McNemar over the positives: who caught what the other missed. */
function mcnemar(
  a: readonly Outcome[],
  b: readonly Outcome[],
): Discordance {
  const byId = new Map(a.map((o) => [o.id, o]));
  let aOnly = 0;
  let bOnly = 0;
  for (const right of b) {
    const left = byId.get(right.id);
    if (!left || right.label !== 1) continue;
    if (right.predicted === 1 && left.predicted === 0) bOnly++;
    else if (right.predicted === 0 && left.predicted === 1) aOnly++;
  }
  // Continuity-corrected χ²: the uncorrected form is anti-conservative at these counts.
  const total = aOnly + bOnly;
  const chi2 = total === 0 ? 0 : (Math.abs(aOnly - bOnly) - 1) ** 2 / total;
  return { aOnly, bOnly, chi2, p: chiSquarePValue(chi2), exact: exactBinomialP(aOnly, bOnly) };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length < 4) {
    process.stderr.write(
      'usage: mcnemar <labelA> <fileA> <labelB> <fileB> [<labelC> <fileC> …]\n' +
        '       the LAST pair is the arm under test; every earlier pair is a comparator.\n',
    );
    return 2;
  }

  const arms: { label: string; outcomes: Map<string, Outcome> }[] = [];
  for (let i = 0; i + 1 < argv.length; i += 2) {
    arms.push({ label: argv[i]!, outcomes: await load(argv[i + 1]!) });
  }

  // Pair on the intersection of every arm, so all rows in the table describe the same
  // stories. An arm that resumed further than another must not be judged on extra data.
  let shared: string[] = [...arms[0]!.outcomes.keys()];
  for (const arm of arms.slice(1)) shared = shared.filter((id) => arm.outcomes.has(id));
  shared.sort();

  const aligned = arms.map((arm) => ({
    label: arm.label,
    outcomes: shared.map((id) => arm.outcomes.get(id)!),
  }));

  const positives = aligned[0]!.outcomes.filter((o) => o.label === 1).length;
  const lines: string[] = [
    `paired on ${shared.length} stories common to all ${arms.length} arms; ${positives} flawed`,
    '',
    '| arm | accuracy | precision | recall | F1 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const arm of aligned) {
    const m = metrics(arm.outcomes);
    lines.push(
      `| ${arm.label} | ${pct(m.accuracy)} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.f1.toFixed(3)} |`,
    );
  }

  const test = aligned[aligned.length - 1]!;
  lines.push('', 'McNemar on the flawed stories, paired, two-sided:', '');
  for (const comparator of aligned.slice(0, -1)) {
    const r = mcnemar(comparator.outcomes, test.outcomes);
    lines.push(
      `  ${test.label} vs ${comparator.label}: ` +
        `caught ${r.bOnly} it missed, lost ${r.aOnly}; ` +
        `chi2 = ${r.chi2.toFixed(2)}, p = ${r.p.toFixed(4)} (exact p = ${r.exact.toFixed(4)})` +
        `  -> ${r.p < 0.05 && r.exact < 0.05 ? 'SIGNIFICANT' : 'not significant'} at alpha = 0.05`,
    );
  }

  process.stdout.write(`${lines.join('\n')}\n`);
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
