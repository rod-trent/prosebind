import type { Segment } from '../segment/types.js';
import type { Entity, Fact, Mention, StoryEvent, StoryMeta } from './types.js';

/**
 * The continuity graph.
 *
 * Deliberately an in-memory structure with an explicit incremental update path.
 * Persistence is a rebuildable index (DESIGN.md § 6) — the bible files on disk are
 * the source of truth, so losing this costs a re-parse and nothing else.
 */
export class ContinuityGraph {
  private readonly entitiesById = new Map<string, Entity>();
  private readonly factsById = new Map<string, Fact>();
  private readonly eventsById = new Map<string, StoryEvent>();
  /** Mentions bucketed by segment so a dirty segment's mentions can be replaced wholesale. */
  private readonly mentionsBySegment = new Map<string, Mention[]>();
  private surfaceIndex: Array<{ surface: string; entityId: string }> = [];

  meta: StoryMeta = {};

  addEntity(entity: Entity): void {
    this.entitiesById.set(entity.id, entity);
    this.reindexSurfaces();
  }

  addFact(fact: Fact): void {
    this.factsById.set(fact.id, fact);
  }

  addEvent(event: StoryEvent): void {
    this.eventsById.set(event.id, event);
  }

  get entities(): Entity[] {
    return [...this.entitiesById.values()];
  }

  get facts(): Fact[] {
    return [...this.factsById.values()];
  }

  /** Events in story order: dated ones by date, undated ones by declaration order. */
  get events(): StoryEvent[] {
    return [...this.eventsById.values()].sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.ordinal - b.ordinal;
    });
  }

  entity(id: string): Entity | undefined {
    return this.entitiesById.get(id);
  }

  event(id: string): StoryEvent | undefined {
    return this.eventsById.get(id);
  }

  factsFor(entityId: string): Fact[] {
    return this.facts.filter((f) => f.entityId === entityId);
  }

  /** Canon beats inferred, always. Ties within a tier go to higher confidence. */
  resolveFact(entityId: string, predicate: string): Fact | undefined {
    const candidates = this.facts.filter((f) => f.entityId === entityId && f.predicate === predicate);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === 'canon' ? -1 : 1;
      return b.confidence - a.confidence;
    })[0];
  }

  /** Replaces every mention in a segment. This is the incremental update path. */
  setMentions(segmentId: string, mentions: readonly Mention[]): void {
    if (mentions.length === 0) this.mentionsBySegment.delete(segmentId);
    else this.mentionsBySegment.set(segmentId, [...mentions]);
  }

  dropSegment(segmentId: string): void {
    this.mentionsBySegment.delete(segmentId);
  }

  mentionsIn(segmentId: string): readonly Mention[] {
    return this.mentionsBySegment.get(segmentId) ?? [];
  }

  get allMentions(): Mention[] {
    return [...this.mentionsBySegment.values()].flat();
  }

  mentionsOf(entityId: string): Mention[] {
    return this.allMentions.filter((m) => m.entityId === entityId);
  }

  /**
   * Surface forms longest-first, so "Elena Vasquez" wins over "Elena" and we never
   * report two overlapping mentions for one reference.
   */
  private reindexSurfaces(): void {
    const index: Array<{ surface: string; entityId: string }> = [];
    for (const e of this.entitiesById.values()) {
      index.push({ surface: e.name, entityId: e.id });
      for (const alias of e.aliases) index.push({ surface: alias, entityId: e.id });
    }
    index.sort((a, b) => b.surface.length - a.surface.length);
    this.surfaceIndex = index;
  }

  get surfaces(): ReadonlyArray<{ surface: string; entityId: string }> {
    return this.surfaceIndex;
  }
}

/** Dialogue attribution patterns, deliberately conservative. */
const SAID_VERBS =
  'said|asked|replied|answered|whispered|shouted|muttered|murmured|called|cried|added|continued|breathed|snapped|offered|admitted|insisted|repeated';

/**
 * Find every reference to a known entity in a segment.
 *
 * Deterministic and model-free by design — this is Tier 0. It matches declared names
 * and aliases on word boundaries and marks a mention as `speaking` when it sits in a
 * recognisable dialogue attribution. It does not resolve pronouns, and it does not
 * guess at unknown names: an entity the writer has not declared does not exist here.
 */
export function detectMentions(graph: ContinuityGraph, segment: Segment): Mention[] {
  const mentions: Mention[] = [];
  const claimed: Array<[number, number]> = [];
  const text = segment.text;

  const overlaps = (start: number, end: number): boolean =>
    claimed.some(([s, e]) => start < e && end > s);

  for (const { surface, entityId } of graph.surfaces) {
    if (surface.length < 2) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}'’-])${escapeRegExp(surface)}(?![\\p{L}\\p{N}'’-])`, 'gu');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);
      mentions.push({
        entityId,
        segmentId: segment.id,
        span: { start: segment.span.start + start, end: segment.span.start + end },
        surface: match[0],
        speaking: isAttribution(text, start, end, surface),
      });
    }
  }

  return mentions.sort((a, b) => a.span.start - b.span.start);
}

/** `"…," Elena said` / `Elena said, "…"` — and nothing looser than that. */
function isAttribution(text: string, start: number, end: number, surface: string): boolean {
  const after = text.slice(end, end + 24);
  const before = text.slice(Math.max(0, start - 24), start);
  const verbs = new RegExp(`^[ \\t]*(?:${SAID_VERBS})\\b`, 'i');
  if (verbs.test(after)) return true;
  const inverted = new RegExp(`\\b(?:${SAID_VERBS})[ \\t]+${escapeRegExp(surface)}$`, 'i');
  return inverted.test(before + surface);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
