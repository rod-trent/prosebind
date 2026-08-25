/**
 * @prosebind/analyze — Tier 2.
 *
 * Judgment analysis over one passage at a time. Separate from @prosebind/extract
 * because the jobs differ: Tier 1 turns prose into facts, Tier 2 asks a question about
 * prose and gets an opinion back. It reuses extract's model layer rather than growing a
 * second one.
 */
export { Analyzer, anchorFindings, summariseCanon, ANCHOR_FLOOR, DEFAULT_PASSES, DEFAULT_TEMPERATURE } from './analyze.js';
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

import { continuityLens } from './lenses/continuity.js';
import { motivationLens } from './lenses/motivation.js';
import type { Lens } from './lens.js';

/** Every Tier 2 lens. All produce questions, never verdicts. */
/**
 * Every Tier 2 lens. All produce questions, never verdicts.
 *
 * The contradiction lens is v1. `continuityLensV2` — which names a taxonomy of
 * contradiction types rather than leaving the model to decide what counts — looked like
 * a 16.7-point recall win on a controlled 60-story comparison and turned out to be
 * nothing. Paired across all 407 stories both versions covered, it caught 10 flawed
 * stories v1 missed and missed 9 that v1 caught: net +1 out of 201, while costing 6.3
 * points of precision.
 *
 * v2 stays exported so the negative result is reproducible rather than folklore.
 */
export const TIER2_LENSES: readonly Lens[] = [continuityLens, motivationLens];
