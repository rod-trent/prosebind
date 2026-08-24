import { LineIndex } from '@prosebind/core';
import type { AnalysisResult, Diagnostic, Document, Severity } from '@prosebind/core';
import { relative } from 'node:path';

const useColour =
  process.env['NO_COLOR'] === undefined &&
  process.env['TERM'] !== 'dumb' &&
  process.stdout.isTTY === true;

const paint = (code: string, text: string): string =>
  useColour ? `\u001B[${code}m${text}\u001B[0m` : text;

const dim = (t: string): string => paint('2', t);
const bold = (t: string): string => paint('1', t);
const red = (t: string): string => paint('31', t);
const yellow = (t: string): string => paint('33', t);
const blue = (t: string): string => paint('34', t);
const green = (t: string): string => paint('32', t);

const SEVERITY_LABEL: Record<Severity, (text: string) => string> = {
  contradiction: red,
  question: yellow,
  note: blue,
};

const SEVERITY_MARK: Record<Severity, string> = {
  contradiction: '×',
  question: '?',
  note: '·',
};

export interface ReportOptions {
  root: string;
  documents: ReadonlyMap<string, Document>;
  /** Show the suppression key under each finding. */
  showKeys?: boolean;
}

/**
 * Render findings for a terminal.
 *
 * Grouped by file and ordered by severity, because a writer scanning this from the top
 * should meet the thing most likely to be a genuine error first. Every finding carries
 * its evidence and its suppression key: the writer must be able to judge the claim, and
 * to end the argument permanently if we are wrong.
 */
export function formatReport(result: AnalysisResult, options: ReportOptions): string {
  const { diagnostics, stats } = result;
  const lines: string[] = [];

  if (diagnostics.length === 0) {
    lines.push(green('✓ No continuity findings.'));
    lines.push(dim(summarise(stats)));
    return lines.join('\n');
  }

  const byFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const bucket = byFile.get(diagnostic.file);
    if (bucket) bucket.push(diagnostic);
    else byFile.set(diagnostic.file, [diagnostic]);
  }

  const indexes = new Map<string, LineIndex>();
  const indexFor = (path: string): LineIndex | undefined => {
    const cached = indexes.get(path);
    if (cached) return cached;
    const doc = options.documents.get(path);
    if (!doc) return undefined;
    const made = new LineIndex(doc.text);
    indexes.set(path, made);
    return made;
  };

  for (const [file, found] of byFile) {
    lines.push('');
    lines.push(bold(relative(options.root, file) || file));

    for (const diagnostic of found) {
      const index = indexFor(file);
      const position = index?.positionAt(diagnostic.span.start);
      const where = position ? `${position.line + 1}:${position.character + 1}` : '?';
      const colour = SEVERITY_LABEL[diagnostic.severity];
      const mark = SEVERITY_MARK[diagnostic.severity];

      lines.push(
        `  ${colour(mark)} ${dim(where.padEnd(8))}${diagnostic.message} ${dim(`[${diagnostic.check}]`)}`,
      );
      if (diagnostic.detail) lines.push(`    ${dim(diagnostic.detail)}`);

      for (const related of diagnostic.related ?? []) {
        const relIndex = indexFor(related.file);
        const relPos = relIndex?.positionAt(related.span.start);
        const relWhere = relPos ? `${relative(options.root, related.file)}:${relPos.line + 1}` : related.file;
        lines.push(`    ${dim(`↳ ${related.label} — ${relWhere}`)}`);
      }

      if (options.showKeys) {
        lines.push(`    ${dim(`suppress: ${diagnostic.suppressionKey}`)}`);
      }
    }
  }

  const counts = tally(diagnostics);
  lines.push('');
  lines.push(
    [
      counts.contradiction > 0 ? red(`${counts.contradiction} contradiction${counts.contradiction === 1 ? '' : 's'}`) : '',
      counts.question > 0 ? yellow(`${counts.question} question${counts.question === 1 ? '' : 's'}`) : '',
      counts.note > 0 ? blue(`${counts.note} note${counts.note === 1 ? '' : 's'}`) : '',
    ]
      .filter(Boolean)
      .join(dim(' · ')),
  );
  lines.push(dim(summarise(stats)));

  return lines.join('\n');
}

function tally(diagnostics: readonly Diagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { contradiction: 0, question: 0, note: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return counts;
}

function summarise(stats: AnalysisResult['stats']): string {
  const words = stats.words.toLocaleString('en-US');
  const analysed =
    stats.segmentsAnalysed === stats.segments
      ? `${stats.segments} segments`
      : `${stats.segmentsAnalysed} of ${stats.segments} segments`;
  return `${words} words · ${analysed} analysed · ${stats.durationMs.toFixed(0)}ms`;
}

/** One-line summary for watch mode, where the writer is mid-session. */
export function formatWatchLine(result: AnalysisResult): string {
  const counts = tally(result.diagnostics);
  const time = new Date().toTimeString().slice(0, 8);
  if (result.diagnostics.length === 0) {
    return `${dim(time)} ${green('✓')} clear ${dim(`(${result.stats.segmentsAnalysed} segments, ${result.stats.durationMs.toFixed(0)}ms)`)}`;
  }
  const parts = [
    counts.contradiction > 0 ? red(`${counts.contradiction}×`) : '',
    counts.question > 0 ? yellow(`${counts.question}?`) : '',
    counts.note > 0 ? blue(`${counts.note}·`) : '',
  ].filter(Boolean);
  return `${dim(time)} ${parts.join(' ')} ${dim(`(${result.stats.segmentsAnalysed} segments, ${result.stats.durationMs.toFixed(0)}ms)`)}`;
}
