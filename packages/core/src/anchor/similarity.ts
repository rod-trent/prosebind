/**
 * Bounded edit distance and similarity, used to verify candidate anchor matches.
 *
 * Bitap tells us *where* a quote probably went. These functions decide whether the
 * text actually found there is still the same sentence or merely something that
 * rhymes with it. Verification is what keeps a shifted anchor from silently landing
 * on the wrong paragraph.
 */

/**
 * Levenshtein distance, abandoning early once the distance exceeds `max`.
 *
 * The bound matters: comparing two 400-character paragraphs is 160k cell updates
 * unbounded, and we do this on every dirty segment. With a bound it exits in a few
 * rows for anything that isn't already close.
 *
 * @returns the distance, or `max + 1` if it provably exceeds `max`.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  // Keep the shorter string on the inner axis to minimise row width.
  if (a.length > b.length) [a, b] = [b, a];

  let prev: number[] = new Array<number>(a.length + 1);
  let curr: number[] = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    let rowMin = curr[0];
    const bc = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bc ? 0 : 1;
      const value = Math.min(
        (curr[i - 1] ?? 0) + 1,
        (prev[i] ?? 0) + 1,
        (prev[i - 1] ?? 0) + cost,
      );
      curr[i] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }

  return prev[a.length] ?? 0;
}

/** 1.0 for identical strings, 0.0 for entirely dissimilar ones. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const bound = Math.ceil(longest * 0.6);
  const distance = levenshtein(a, b, bound);
  if (distance > bound) return 0;
  return 1 - distance / longest;
}

/**
 * How well two context strings agree, anchored at their adjoining edge.
 *
 * Prefixes are compared right-aligned and suffixes left-aligned, because the
 * characters nearest the quote are the ones that carry the disambiguating signal —
 * the far end of a context window is the first thing an unrelated edit disturbs.
 */
export function contextScore(expected: string, actual: string, align: 'left' | 'right'): number {
  if (expected.length === 0) return 1;
  const n = Math.min(expected.length, actual.length);
  if (n === 0) return 0;
  const e = align === 'right' ? expected.slice(-n) : expected.slice(0, n);
  const a = align === 'right' ? actual.slice(-n) : actual.slice(0, n);
  return similarity(e, a);
}
