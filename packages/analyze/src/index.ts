/**
 * @prosebind/analyze — Tier 2.
 *
 * Judgment analysis over one passage at a time. Separate from @prosebind/extract
 * because the jobs differ: Tier 1 turns prose into facts, Tier 2 asks a question about
 * prose and gets an opinion back. It reuses extract's model layer rather than growing a
 * second one.
 */
export { Analyzer, anchorFindings, summariseCanon, ANCHOR_FLOOR } from './analyze.js';
export type { AnalyzerOptions, AnalysisRecord } from './analyze.js';
export { normalizeLensResult, LENS_SCHEMA, TIER2_SYSTEM } from './lens.js';
export type { Lens, LensContext, LensFinding, LensResult } from './lens.js';
export { continuityLens } from './lenses/continuity.js';
export { continuityLensV2 } from './lenses/continuity2.js';
export { motivationLens } from './lenses/motivation.js';
export { AnthropicModel } from './providers/anthropic.js';
export { GrokModel } from './providers/grok.js';
export type { AnthropicOptions } from './providers/anthropic.js';
export type { GrokOptions } from './providers/grok.js';

import { continuityLensV2 } from './lenses/continuity2.js';
import { motivationLens } from './lenses/motivation.js';
import type { Lens } from './lens.js';

/** Every Tier 2 lens. All produce questions, never verdicts. */
/**
 * Every Tier 2 lens. All produce questions, never verdicts.
 *
 * The contradiction lens defaults to v2, which trades 4.7 points of precision for 16.7
 * points of recall on a controlled 60-story comparison. That trade is right *here* and
 * would be wrong in Tier 0: a Tier 2 finding is a `question` that accumulates quietly in
 * a sidebar, never an inline mark, so the precision bar is set by how loudly the finding
 * speaks. `continuityLens` (v1) remains exported for anyone who wants the quieter one.
 */
export const TIER2_LENSES: readonly Lens[] = [continuityLensV2, motivationLens];
