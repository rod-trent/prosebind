/**
 * @prosebind/core — the continuity engine.
 *
 * Nothing in this package touches the network or a language model. That is not an
 * accident of the current version; it is the Tier 0 contract (DESIGN.md § 7).
 */

export { createAnchor, resolveAnchor, hashQuote, CONTEXT_LENGTH } from './anchor/anchor.js';
export { matchBitap, MAX_BITS, DEFAULT_BITAP } from './anchor/bitap.js';
export { levenshtein, similarity, contextScore } from './anchor/similarity.js';
export type { Anchor, Resolution, ResolutionStatus } from './anchor/types.js';
export { INLINE_CONFIDENCE_FLOOR } from './anchor/types.js';

export { segmentDocument, segmentsOfKind, sceneAt, chapterAt, hashText } from './segment/segment.js';
export { diffSegments, dirtySegments } from './segment/diff.js';
export type { Document, Segment, SegmentKind, SegmentDelta, SegmentChange } from './segment/types.js';
export { isDirty } from './segment/types.js';

export { ContinuityGraph, detectMentions } from './graph/graph.js';
export { loadBible, hasBible, BIBLE_DIR } from './graph/bible.js';
export type { BibleIssue, LoadedBible } from './graph/bible.js';
export { bindEvents, projectOffset } from './graph/bind.js';
export type {
  Entity,
  EntityType,
  Fact,
  Mention,
  Provenance,
  StoryEvent,
  StoryMeta,
  Tier,
  EventPosition,
} from './graph/types.js';

export { TIER0_CHECKS, runChecks, NO_SUPPRESSIONS } from './checks/registry.js';
export type { SuppressionSet } from './checks/registry.js';
export type {
  Category,
  Check,
  CheckContext,
  Diagnostic,
  RelatedSpan,
  Severity,
} from './checks/types.js';

export { Suppressions, loadSuppressions, saveSuppressions, SUPPRESS_FILE } from './suppress.js';
export { Project } from './project.js';
export type { AnalysisResult, AnalysisStats, UpdateResult } from './project.js';

export { LineIndex, normalize, countWords, snapToWordBoundaries } from './text.js';
export type { Span, Position, Range } from './text.js';
