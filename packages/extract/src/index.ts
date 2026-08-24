/**
 * @prosebind/extract — Tier 1.
 *
 * The first place a language model enters Prosebind. Deliberately a separate package
 * from @prosebind/core so the model-free guarantee on Tier 0 is structural rather than
 * a matter of discipline: core has no dependency on this, and cannot acquire one
 * without someone noticing.
 */
export { SceneExtractor, knownNamesFrom, isEmptyExtraction } from './extract.js';
export type { ExtractorOptions, ExtractionRecord } from './extract.js';
export { mergeExtraction, inferredEntities, inferredFacts } from './merge.js';
export type { MergeReport, MergeOptions } from './merge.js';
export { bootstrap, renderProposal } from './bootstrap.js';
export type { BootstrapResult, BootstrapOptions, ProposedCharacter } from './bootstrap.js';
export {
  assertPermitted,
  extractJson,
  LOCAL_ONLY,
  ModelUnavailableError,
} from './provider.js';
export type {
  GenerateRequest,
  GenerateResponse,
  LanguageModel,
  ModelLocation,
  NetworkPolicy,
} from './provider.js';
export { OllamaModel, listOllamaModels } from './providers/ollama.js';
export type { OllamaOptions } from './providers/ollama.js';
export { StubModel, fixedExtraction, emptyExtraction } from './providers/stub.js';
export {
  EXTRACTION_SCHEMA,
  EMPTY_EXTRACTION,
  PREDICATES,
  normalizeExtraction,
  isEmpty,
} from './schema.js';
export type {
  SceneExtraction,
  ExtractedCharacter,
  ExtractedAttribute,
  ExtractedEvent,
  Predicate,
} from './schema.js';
export { buildExtractionPrompt, clampScene, EXTRACTION_SYSTEM, MAX_SCENE_CHARS } from './prompt.js';
export { canonicalNames, linkExtraction, isNameSubset, isPlausibleAttribute, filterImplausible } from './link.js';
