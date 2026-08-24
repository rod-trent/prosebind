import type { Anchor } from '../anchor/types.js';
import type { Span } from '../text.js';

export type EntityType = 'character' | 'place' | 'object' | 'organization';

/**
 * Where a fact came from, and therefore how much authority it carries.
 *
 * `canon` is pinned by the writer in the bible and is never overridden by extraction.
 * `inferred` is derived from the manuscript and may be revised or dropped freely.
 * The distinction is load-bearing: the extractor will be wrong, and the writer must
 * always be able to win the argument. See DESIGN.md § 6.
 */
export type Tier = 'canon' | 'inferred';

export interface Provenance {
  readonly source: 'bible' | 'text';
  /** Bible file, or manuscript path. */
  readonly file: string;
  readonly segmentId?: string | undefined;
  readonly anchor?: Anchor | undefined;
}

export interface Fact {
  readonly id: string;
  readonly entityId: string;
  /** `eyes`, `hair`, `height`, `deceased`, `born` … */
  readonly predicate: string;
  readonly value: string;
  readonly tier: Tier;
  readonly confidence: number;
  readonly provenance: Provenance;
}

export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly aliases: readonly string[];
  /** Canon attributes straight from the bible. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Event id after which this entity is dead and may not act. */
  readonly deceasedAfter?: string | undefined;
  /** Event id before which this entity has not yet appeared. */
  readonly introducedAt?: string | undefined;
  /** ISO date or bare year. */
  readonly born?: string | undefined;
}

/** Where in the manuscript an event actually happens. */
export interface EventPosition {
  readonly file: string;
  readonly offset: number;
  /** How the position was determined — a quote is precise, a chapter is approximate. */
  readonly via: 'quote' | 'chapter';
  readonly confidence: number;
}

/** A point on the story's timeline, anchored either to a date or to another event. */
export interface StoryEvent {
  readonly id: string;
  readonly label: string;
  /** ISO 8601 date, if the writer pinned one. */
  readonly date?: string | undefined;
  /** Ordering fallback when no date exists. */
  readonly ordinal: number;
  /** 1-based chapter number, for events pinned coarsely. */
  readonly chapter?: number | undefined;
  /**
   * A verbatim quote marking where this event occurs. Resolved through the anchoring
   * layer, so it survives the writer editing around it — the same machinery that keeps
   * diagnostics pointing at the right sentence.
   */
  readonly at?: string | undefined;
  /** Filled in by `bindEvents` once the manuscript has been read. */
  position?: EventPosition | undefined;
  readonly provenance: Provenance;
}

/** A detected reference to an entity in the manuscript. Deterministic, no model. */
export interface Mention {
  readonly entityId: string;
  readonly segmentId: string;
  readonly span: Span;
  /** The exact surface form matched, which may be an alias. */
  readonly surface: string;
  /** True when the mention is the speaker of attributed dialogue. */
  readonly speaking: boolean;
}

export interface StoryMeta {
  readonly title?: string | undefined;
  /** `first`, `third-limited`, `third-omniscient` */
  readonly pov?: string | undefined;
  /** `past` or `present` */
  readonly tense?: string | undefined;
  /** The in-world date the story opens on. */
  readonly storyDate?: string | undefined;
}
