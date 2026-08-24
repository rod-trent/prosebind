export * from './jsonrpc.js';

/**
 * @prosebind/spec — the on-disk continuity format and the wire protocol.
 *
 * Apache-2.0 on purpose. This package is meant to be re-implemented, embedded and
 * shipped by other people, including commercially. An adopted format outlives any
 * one implementation of it, and is the durable asset here (DESIGN.md § 13).
 *
 * Nothing in this package is stable before 1.0. After that, a breaking change needs a
 * version bump and a migration path — writers will have years of accumulated canon in
 * this format, and it is their data, not ours.
 */

/** Version of the on-disk bible format. */
export const BIBLE_FORMAT_VERSION = '0.1.0' as const;

/** Version of the diagnostic wire format shared by the LSP and MCP servers. */
export const PROTOCOL_VERSION = '0.1.0' as const;

/** Files that make up a bible, relative to the project root. */
export const BIBLE_LAYOUT = {
  root: '.prosebind',
  bible: '.prosebind/bible',
  meta: '.prosebind/bible/meta.yaml',
  characters: '.prosebind/bible/characters.yaml',
  places: '.prosebind/bible/places.yaml',
  objects: '.prosebind/bible/objects.yaml',
  organizations: '.prosebind/bible/organizations.yaml',
  timeline: '.prosebind/bible/timeline.yaml',
  suppress: '.prosebind/suppress.yaml',
  /** Derived and rebuildable. Never the source of truth, never committed. */
  index: '.prosebind/index',
} as const;

/**
 * Ways a writer may pin a timeline event to a place in the prose.
 *
 * `quote` resolves through the anchoring layer and survives editing around it.
 * `chapter` is coarse but needs no quoting. An event with neither is still ordered by
 * date, but cannot support before/after reasoning against the manuscript.
 */
export type EventPinning = 'quote' | 'chapter' | 'unpinned';

/** Diagnostic categories, taken verbatim from ConStory-Bench (ACL Findings 2026). */
export const CATEGORIES = [
  'timeline',
  'characterization',
  'worldbuilding',
  'factual',
  'narrative',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * How loudly a finding may speak. Only `contradiction` may draw an inline mark;
 * everything else accumulates quietly. Nothing interrupts (DESIGN.md § 10).
 */
export const SEVERITIES = ['contradiction', 'question', 'note'] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Below this confidence, a finding must never be rendered inline. */
export const INLINE_CONFIDENCE_FLOOR = 0.75;
