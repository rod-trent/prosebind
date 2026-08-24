/**
 * Text primitives shared by every layer.
 *
 * One rule governs this file: offsets are always UTF-16 code unit indices into the
 * *raw* document string, exactly as an editor reports them. We never anchor into a
 * normalised copy, because the writer's editor cannot address that copy.
 */

/** A half-open range `[start, end)` in raw document offsets. */
export interface Span {
  start: number;
  end: number;
}

/** Zero-based line and column, for editors and diagnostics. */
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/**
 * Normalise text for *comparison only* — never for anchoring.
 *
 * Collapses whitespace runs, unifies the quote and dash characters word processors
 * silently substitute, and lowercases. Two passages that differ only by Word turning
 * `"` into `"` must compare equal, or every anchor breaks the first time a manuscript
 * makes a round trip through a word processor.
 */
export function normalize(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normalisation that preserves length, so offsets survive it. */
export function normalizePreservingLength(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .toLowerCase();
}

/**
 * Maps raw offsets to line/column. Built once per document version and reused;
 * constructing one is O(n), querying it is O(log n).
 */
export class LineIndex {
  private readonly lineStarts: number[];

  constructor(private readonly text: string) {
    const starts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
    }
    this.lineStarts = starts;
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((this.lineStarts[mid] ?? 0) <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: clamped - (this.lineStarts[lo] ?? 0) };
  }

  rangeOf(span: Span): Range {
    return { start: this.positionAt(span.start), end: this.positionAt(span.end) };
  }

  /**
   * The inverse of `positionAt`. Editors speak in line/character, the engine speaks in
   * offsets, and every hover or go-to-definition request has to cross that boundary.
   *
   * Out-of-range positions clamp rather than throw: a client whose document version is
   * one keystroke ahead of ours must get a sensible answer, not an error.
   */
  offsetAt(position: Position): number {
    const line = Math.max(0, Math.min(position.line, this.lineStarts.length - 1));
    const lineStart = this.lineStarts[line] ?? 0;
    const nextLineStart = this.lineStarts[line + 1] ?? this.text.length + 1;
    // Stop before the newline that terminates the line.
    const lineEnd = Math.max(lineStart, Math.min(nextLineStart - 1, this.text.length));
    return Math.max(lineStart, Math.min(lineStart + position.character, lineEnd));
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }
}

/** Word count using a definition writers recognise, not a whitespace split. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/** Expands a span outward to whole-word boundaries, so quotes never start mid-word. */
export function snapToWordBoundaries(text: string, span: Span): Span {
  const isWord = (i: number): boolean => {
    if (i < 0 || i >= text.length) return false;
    return /[\p{L}\p{N}'’]/u.test(text.charAt(i));
  };
  let { start, end } = span;
  while (start > 0 && isWord(start - 1) && isWord(start)) start--;
  while (end < text.length && isWord(end) && isWord(end - 1)) end++;
  return { start, end };
}
