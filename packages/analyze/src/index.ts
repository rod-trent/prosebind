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
export { motivationLens } from './lenses/motivation.js';
export { AnthropicModel } from './providers/anthropic.js';
export type { AnthropicOptions } from './providers/anthropic.js';

import { continuityLens } from './lenses/continuity.js';
import { motivationLens } from './lenses/motivation.js';
import type { Lens } from './lens.js';

/** Every Tier 2 lens. All produce questions, never verdicts. */
export const TIER2_LENSES: readonly Lens[] = [continuityLens, motivationLens];
