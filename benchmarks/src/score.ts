import type { Diagnostic } from '@prosebind/core';
import type { Mutation } from './mutate.js';

/**
 * Scoring an injected-error run.
 *
 * The corpus a detector is measured on may already contain findings — our own worked
 * example contains seven on purpose. So a mutated run is scored against a baseline
 * run, and only findings that are *new* count toward either column. Without that
 * subtraction, pre-existing findings would inflate precision and the number would be
 * flattering and meaningless.
 */

/** How far a finding may sit from its injected error and still count as catching it. */
export const MATCH_WINDOW_LINES = 4;

export interface Score {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface MatchDetail {
  mutation: Mutation;
  found: boolean;
  foundAtLine?: number;
}

export interface RunScore extends Score {
  /** Per-check breakdown, so a weak check cannot hide behind a strong one. */
  byCheck: Map<string, Score>;
  details: MatchDetail[];
  /** New findings explained by no injected error. */
  unexplained: Diagnostic[];
}

/** Stable identity for a finding, so baseline and mutated runs can be compared. */
export function findingKey(diagnostic: Diagnostic): string {
  return `${diagnostic.check}|${diagnostic.message}`;
}

function emptyScore(): Score {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0, precision: 0, recall: 0, f1: 0 };
}

function finalise(score: Score): Score {
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = score;
  score.precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  score.recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  score.f1 =
    score.precision + score.recall === 0
      ? 0
      : (2 * score.precision * score.recall) / (score.precision + score.recall);
  return score;
}

export interface ScoreInput {
  baseline: readonly Diagnostic[];
  mutated: readonly Diagnostic[];
  mutations: readonly Mutation[];
  /** Maps a diagnostic to its 0-based line. */
  lineOf: (diagnostic: Diagnostic) => number;
}

export function score(input: ScoreInput): RunScore {
  const baselineKeys = new Set(input.baseline.map(findingKey));

  // Only findings the mutation caused are in play. Everything the corpus already had
  // is neither a success nor a failure of this experiment.
  const fresh = input.mutated.filter((d) => !baselineKeys.has(findingKey(d)));

  const unclaimed = new Set(fresh);
  const details: MatchDetail[] = [];
  const byCheck = new Map<string, Score>();
  const bucket = (check: string): Score => {
    const existing = byCheck.get(check);
    if (existing) return existing;
    const made = emptyScore();
    byCheck.set(check, made);
    return made;
  };

  const total = emptyScore();

  for (const mutation of input.mutations) {
    const match = [...unclaimed].find((diagnostic) => {
      if (diagnostic.check !== mutation.expectedCheck) return false;
      if (!diagnostic.file.endsWith(mutation.file.split(/[\\/]/).pop() ?? '')) return false;
      return Math.abs(input.lineOf(diagnostic) - mutation.line) <= MATCH_WINDOW_LINES;
    });

    if (match) {
      unclaimed.delete(match);
      total.truePositives++;
      bucket(mutation.expectedCheck).truePositives++;
      details.push({ mutation, found: true, foundAtLine: input.lineOf(match) });
    } else {
      total.falseNegatives++;
      bucket(mutation.expectedCheck).falseNegatives++;
      details.push({ mutation, found: false });
    }
  }

  for (const orphan of unclaimed) {
    total.falsePositives++;
    bucket(orphan.check).falsePositives++;
  }

  for (const value of byCheck.values()) finalise(value);
  finalise(total);

  return { ...total, byCheck, details, unexplained: [...unclaimed] };
}

export interface CleanRunScore {
  words: number;
  findings: number;
  /**
   * Findings per 10,000 words on prose believed to be clean.
   *
   * Directly comparable to the error-density figure ConStory-Bench reports, and it is
   * the number DESIGN.md § 12 says matters most: on clean text every finding is a
   * false positive, and false positives are the product risk.
   */
  per10k: number;
  /**
   * 95% upper bound on the true rate, per 10,000 words.
   *
   * Zero observed findings does not mean a zero rate — it means the corpus was not big
   * enough to produce one. The rule of three puts the 95% bound at 3/n, and on a small
   * fixture that bound is embarrassingly wide. Reporting the point estimate alone would
   * be exactly the unfalsifiable marketing claim DESIGN.md § 12 objects to.
   */
  upperBound95: number;
  byCheck: Map<string, number>;
}

export function scoreClean(findings: readonly Diagnostic[], words: number): CleanRunScore {
  const byCheck = new Map<string, number>();
  for (const finding of findings) {
    byCheck.set(finding.check, (byCheck.get(finding.check) ?? 0) + 1);
  }
  const observed = findings.length;
  return {
    words,
    findings: observed,
    per10k: words === 0 ? 0 : (observed / words) * 10_000,
    upperBound95:
      words === 0
        ? Number.POSITIVE_INFINITY
        : observed === 0
          ? (3 / words) * 10_000
          : // Normal approximation is adequate once anything has been observed.
            ((observed + 1.96 * Math.sqrt(observed)) / words) * 10_000,
    byCheck,
  };
}
