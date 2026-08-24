import { fileURLToPath, pathToFileURL } from 'node:url';
import { INLINE_CONFIDENCE_FLOOR, LineIndex } from '@prosebind/core';
import type { Diagnostic, Severity, Span } from '@prosebind/core';
import {
  DiagnosticSeverity,
  type DiagnosticData,
  type DiagnosticSeverityValue,
  type LspDiagnostic,
  type Range,
} from './protocol.js';

export function uriToPath(uri: string): string {
  return fileURLToPath(uri);
}

export function pathToUri(path: string): string {
  return pathToFileURL(path).toString();
}

export function spanToRange(index: LineIndex, span: Span): Range {
  return index.rangeOf(span);
}

/**
 * How loudly a finding is allowed to appear in the editor.
 *
 * DESIGN.md § 10 says inline marks are for hard contradictions only; everything else
 * accumulates quietly. LSP has no "quiet" channel, so we use the severity ladder as
 * one: `Warning` draws a visible squiggle, `Information` and `Hint` are rendered
 * subtly or only on demand by every editor worth using.
 *
 * Note what is deliberately absent: nothing ever maps to `Error`. Prose is not broken
 * code, and a manuscript is not a failing build.
 */
export function severityFor(diagnostic: Diagnostic): DiagnosticSeverityValue {
  if (diagnostic.severity === 'contradiction') {
    return diagnostic.confidence >= INLINE_CONFIDENCE_FLOOR
      ? DiagnosticSeverity.Warning
      : DiagnosticSeverity.Information;
  }
  if (diagnostic.severity === 'question') return DiagnosticSeverity.Information;
  return DiagnosticSeverity.Hint;
}

/** Minimum severity a writer is willing to see inline. */
export type SeverityFloor = 'contradiction' | 'question' | 'note';

const FLOOR_RANK: Record<Severity, number> = { contradiction: 0, question: 1, note: 2 };

export function passesFloor(diagnostic: Diagnostic, floor: SeverityFloor): boolean {
  return FLOOR_RANK[diagnostic.severity] <= FLOOR_RANK[floor];
}

export interface ConvertOptions {
  /** Index for the file the diagnostic lives in. */
  index: LineIndex;
  /** Indexes for other files, so related locations resolve to real ranges. */
  indexFor: (path: string) => LineIndex | undefined;
}

export function toLspDiagnostic(diagnostic: Diagnostic, options: ConvertOptions): LspDiagnostic {
  const data: DiagnosticData = {
    check: diagnostic.check,
    suppressionKey: diagnostic.suppressionKey,
    confidence: diagnostic.confidence,
  };

  const related = (diagnostic.related ?? []).flatMap((item) => {
    const index = options.indexFor(item.file);
    if (!index) return [];
    return [
      {
        location: { uri: pathToUri(item.file), range: index.rangeOf(item.span) },
        message: item.label,
      },
    ];
  });

  // Confidence belongs in the message, not hidden in a tooltip. A writer deciding
  // whether to trust a finding needs to see how sure we are.
  const suffix = diagnostic.confidence < 0.85 ? ` (confidence ${diagnostic.confidence.toFixed(2)})` : '';
  const detail = diagnostic.detail ? `\n${diagnostic.detail}` : '';

  return {
    range: options.index.rangeOf(diagnostic.span),
    severity: severityFor(diagnostic),
    code: diagnostic.check,
    source: 'prosebind',
    message: `${diagnostic.message}${suffix}${detail}`,
    relatedInformation: related.length > 0 ? related : undefined,
    data,
  };
}
