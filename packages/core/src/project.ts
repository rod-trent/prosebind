import { runChecks } from './checks/registry.js';
import type { Diagnostic } from './checks/types.js';
import { loadBible } from './graph/bible.js';
import { bindEvents } from './graph/bind.js';
import { ContinuityGraph, detectMentions } from './graph/graph.js';
import { diffSegments, dirtySegments } from './segment/diff.js';
import { segmentDocument } from './segment/segment.js';
import type { Document, Segment, SegmentDelta } from './segment/types.js';
import { loadSuppressions, Suppressions } from './suppress.js';
import type { BibleIssue } from './graph/bible.js';

export interface UpdateResult {
  readonly path: string;
  readonly delta: SegmentDelta;
  /** Segments that will be re-analysed on the next `analyze()`. */
  readonly dirty: readonly Segment[];
}

export interface AnalysisStats {
  readonly documents: number;
  readonly segments: number;
  readonly segmentsAnalysed: number;
  readonly words: number;
  readonly durationMs: number;
}

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly stats: AnalysisStats;
}

/**
 * A manuscript, its bible, and the derived continuity state.
 *
 * The incremental contract lives here: `setDocument` records what changed, and
 * `analyze` re-checks only that. A writer fixing a typo in chapter 14 must not pay for
 * chapters 1 through 13 (DESIGN.md § 8).
 */
export class Project {
  private readonly documents = new Map<string, Document>();
  /** Diagnostics keyed by the segment that produced them, so they can be replaced piecemeal. */
  private readonly diagnosticsBySegment = new Map<string, Diagnostic[]>();
  private readonly dirty = new Map<string, Set<string>>();

  private constructor(
    readonly root: string,
    readonly graph: ContinuityGraph,
    readonly suppressions: Suppressions,
    readonly bibleIssues: readonly BibleIssue[],
  ) {}

  static async open(root: string): Promise<Project> {
    const [{ graph, issues }, suppressions] = await Promise.all([
      loadBible(root),
      loadSuppressions(root),
    ]);
    return new Project(root, graph, suppressions, issues);
  }

  get files(): string[] {
    return [...this.documents.keys()].sort();
  }

  document(path: string): Document | undefined {
    return this.documents.get(path);
  }

  /**
   * Record a new version of a file.
   *
   * Mentions are recomputed only for segments that actually changed; everything else
   * keeps the mentions it already had. Nothing is checked until `analyze` runs, so a
   * burst of saves across several files costs one analysis, not one per file.
   */
  setDocument(path: string, text: string): UpdateResult {
    const previous = this.documents.get(path);
    const next = segmentDocument(path, text);
    const delta = diffSegments(previous?.segments ?? [], next.segments);

    for (const removed of delta.removed) {
      this.graph.dropSegment(removed.id);
      this.diagnosticsBySegment.delete(removed.id);
    }
    for (const change of delta.changed) {
      this.graph.dropSegment(change.before.id);
      this.diagnosticsBySegment.delete(change.before.id);
    }
    // A moved segment keeps its content but changes id, so carry its findings across
    // rather than re-deriving them.
    for (const move of delta.moved) {
      const carried = this.diagnosticsBySegment.get(move.before.id);
      this.graph.dropSegment(move.before.id);
      this.diagnosticsBySegment.delete(move.before.id);
      const mentions = detectMentions(this.graph, move.after);
      this.graph.setMentions(move.after.id, mentions);
      if (carried) this.diagnosticsBySegment.set(move.after.id, carried);
    }

    for (const segment of [...delta.added, ...delta.changed.map((c) => c.after)]) {
      this.graph.setMentions(segment.id, detectMentions(this.graph, segment));
    }

    this.documents.set(path, next);

    const dirty = dirtySegments(delta, next.segments);
    this.dirty.set(path, new Set(dirty.map((s) => s.id)));
    return { path, delta, dirty };
  }

  removeDocument(path: string): void {
    const doc = this.documents.get(path);
    if (!doc) return;
    for (const segment of doc.segments) {
      this.graph.dropSegment(segment.id);
      this.diagnosticsBySegment.delete(segment.id);
    }
    this.documents.delete(path);
    this.dirty.delete(path);
  }

  /** Force every segment to be re-analysed — used after the bible changes. */
  invalidateAll(): void {
    this.diagnosticsBySegment.clear();
    for (const [path, doc] of this.documents) {
      this.dirty.set(path, new Set(doc.segments.map((s) => s.id)));
      for (const segment of doc.segments) {
        this.graph.setMentions(segment.id, detectMentions(this.graph, segment));
      }
    }
  }

  /**
   * Re-check the dirty segments and return the project's full diagnostic set.
   *
   * Events are bound before any check runs, so "before" and "after" are meaningful
   * across chapter files and not just within one.
   */
  analyze(): AnalysisResult {
    const started = performance.now();
    const documents = [...this.documents.values()];
    bindEvents(this.graph, documents);

    let analysed = 0;

    for (const doc of documents) {
      const dirtyIds = this.dirty.get(doc.path);
      if (!dirtyIds || dirtyIds.size === 0) continue;

      const segments = doc.segments.filter((s) => dirtyIds.has(s.id));
      analysed += segments.length;

      for (const segment of segments) this.diagnosticsBySegment.delete(segment.id);

      const produced = runChecks({ doc, graph: this.graph, segments, documents }, this.suppressions);
      for (const diagnostic of produced) {
        const bucket = this.diagnosticsBySegment.get(diagnostic.segmentId);
        if (bucket) bucket.push(diagnostic);
        else this.diagnosticsBySegment.set(diagnostic.segmentId, [diagnostic]);
      }

      this.dirty.set(doc.path, new Set());
    }

    const diagnostics = [...this.diagnosticsBySegment.values()].flat();
    const rank = { contradiction: 0, question: 1, note: 2 } as const;
    diagnostics.sort((a, b) => {
      const bySeverity = rank[a.severity] - rank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.file.localeCompare(b.file) || a.span.start - b.span.start;
    });

    return {
      diagnostics,
      stats: {
        documents: documents.length,
        segments: documents.reduce((n, d) => n + d.segments.length, 0),
        segmentsAnalysed: analysed,
        words: documents.reduce(
          (n, d) => n + d.segments.filter((s) => s.kind === 'paragraph').reduce((w, s) => w + s.wordCount, 0),
          0,
        ),
        durationMs: performance.now() - started,
      },
    };
  }
}
