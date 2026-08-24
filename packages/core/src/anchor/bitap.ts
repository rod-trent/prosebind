/**
 * Bitap approximate string search with a location bias.
 *
 * This is the classic Baeza-Yates–Gonnet algorithm as adapted in Myers' and Google's
 * diff-match-patch: it finds the best fuzzy occurrence of a pattern near an expected
 * location, trading match quality against distance from that location.
 *
 * Why this and not a plain scan: when a writer edits chapter 3, every anchor in
 * chapters 4 onward shifts by the length delta. A location-biased search re-finds them
 * in one hop instead of rescanning the manuscript, and it tolerates the case where the
 * anchored sentence was itself lightly reworded.
 *
 * Constraint: the bit-parallel core is 32 bits wide, so patterns are capped at 32
 * characters. Callers probe with a 32-character window and verify the full quote
 * separately — see `anchor.ts`.
 */

export const MAX_BITS = 32;

export interface BitapOptions {
  /**
   * How far from `expectedLoc` a match may drift before its score is penalised to
   * worthlessness. Roughly "how big an edit do we expect upstream".
   */
  distance: number;
  /** 0 = only perfect matches, 1 = accept anything. Scores above this are rejected. */
  threshold: number;
}

export const DEFAULT_BITAP: BitapOptions = { distance: 1000, threshold: 0.5 };

/** Per-character bitmask of positions within the pattern. */
function alphabet(pattern: string): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    map.set(c, (map.get(c) ?? 0) | (1 << (pattern.length - i - 1)));
  }
  return map;
}

/**
 * Score a candidate: pure edit distance, penalised by how far the candidate sits
 * from where we expected it. Lower is better; 0 is a perfect match at the exact spot.
 */
function bitapScore(errors: number, location: number, expectedLoc: number, patternLength: number, distance: number): number {
  const accuracy = errors / patternLength;
  const proximity = Math.abs(expectedLoc - location);
  if (distance === 0) return proximity === 0 ? accuracy : 1;
  return accuracy + proximity / distance;
}

/**
 * Best fuzzy match of `pattern` in `text` near `expectedLoc`.
 *
 * @returns the start offset of the best match, or -1 if nothing scored under the threshold.
 */
export function matchBitap(
  text: string,
  pattern: string,
  expectedLoc: number,
  options: BitapOptions = DEFAULT_BITAP,
): number {
  if (pattern.length === 0) return -1;
  if (pattern.length > MAX_BITS) {
    throw new RangeError(`bitap pattern capped at ${MAX_BITS} chars; got ${pattern.length}`);
  }
  if (text.length === 0) return -1;

  const loc = Math.max(0, Math.min(expectedLoc, text.length));
  const { distance, threshold } = options;

  // An exact hit at or near the expected location short-circuits everything.
  if (text.startsWith(pattern, loc)) return loc;

  const alpha = alphabet(pattern);
  let scoreThreshold = threshold;

  // Tighten the threshold using any exact match we can find cheaply.
  let best = text.indexOf(pattern, loc);
  if (best !== -1) {
    scoreThreshold = Math.min(bitapScore(0, best, loc, pattern.length, distance), scoreThreshold);
    const tail = text.lastIndexOf(pattern, loc + pattern.length);
    if (tail !== -1) {
      scoreThreshold = Math.min(bitapScore(0, tail, loc, pattern.length, distance), scoreThreshold);
    }
  }

  const matchMask = 1 << (pattern.length - 1);
  best = -1;

  let binMin: number;
  let binMid: number;
  let binMax = pattern.length + text.length;
  let lastRd: number[] = [];

  for (let errorCount = 0; errorCount < pattern.length; errorCount++) {
    // Widest span at this error count that could still beat the threshold.
    binMin = 0;
    binMid = binMax;
    while (binMin < binMid) {
      if (bitapScore(errorCount, loc + binMid, loc, pattern.length, distance) <= scoreThreshold) {
        binMin = binMid;
      } else {
        binMax = binMid;
      }
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;

    let start = Math.max(1, loc - binMid + 1);
    const finish = Math.min(loc + binMid, text.length) + pattern.length;

    const rd: number[] = new Array<number>(finish + 2);
    rd[finish + 1] = (1 << errorCount) - 1;

    for (let j = finish; j >= start; j--) {
      const charMatch = alpha.get(text.charCodeAt(j - 1)) ?? 0;
      if (errorCount === 0) {
        rd[j] = (((rd[j + 1] ?? 0) << 1) | 1) & charMatch;
      } else {
        rd[j] =
          ((((rd[j + 1] ?? 0) << 1) | 1) & charMatch) |
          (((lastRd[j + 1] ?? 0) | (lastRd[j] ?? 0)) << 1) |
          1 |
          (lastRd[j + 1] ?? 0);
      }

      if ((rd[j] ?? 0) & matchMask) {
        const score = bitapScore(errorCount, j - 1, loc, pattern.length, distance);
        if (score <= scoreThreshold) {
          scoreThreshold = score;
          best = j - 1;
          if (best > loc) {
            // Keep walking left; matches before the expected location score better.
            start = Math.max(1, 2 * loc - best);
          } else {
            break;
          }
        }
      }
    }

    // No match is possible at the next error count — stop.
    if (bitapScore(errorCount + 1, loc, loc, pattern.length, distance) > scoreThreshold) break;
    lastRd = rd;
  }

  return best;
}
