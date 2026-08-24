/**
 * What Tier 1 asks a scene for, and what it will accept back.
 *
 * Kept deliberately small. This runs on a 3–4B model on the writer's own machine, and
 * every field added is another thing that model can get subtly wrong. The scope is
 * exactly what feeds Tier 0's checks and the bible bootstrap: who is here, what is
 * asserted about them, and where.
 *
 * Nothing produced here is canon. § 6 is absolute on that: extraction is `inferred`,
 * the writer's bible always outranks it, and the writer must be able to see and correct
 * anything we guessed.
 */

/** Attribute predicates Tier 0 can actually check against. */
export const PREDICATES = ['eyes', 'hair', 'age', 'height', 'build', 'occupation'] as const;
export type Predicate = (typeof PREDICATES)[number];

export interface ExtractedCharacter {
  name: string;
  /** Other surface forms used for the same person in this scene. */
  aliases: string[];
  /** Physically in the scene, as opposed to only mentioned. */
  present: boolean;
  speaks: boolean;
}

export interface ExtractedAttribute {
  subject: string;
  predicate: Predicate;
  value: string;
}

export interface ExtractedEvent {
  summary: string;
  /** Whatever the prose said about timing, verbatim. Never normalised by the model. */
  when?: string | undefined;
}

export interface SceneExtraction {
  characters: ExtractedCharacter[];
  attributes: ExtractedAttribute[];
  places: string[];
  events: ExtractedEvent[];
}

export const EMPTY_EXTRACTION: SceneExtraction = {
  characters: [],
  attributes: [],
  places: [],
  events: [],
};

/** JSON Schema handed to providers that can constrain decoding. */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          present: { type: 'boolean' },
          speaks: { type: 'boolean' },
        },
        required: ['name', 'present', 'speaks'],
      },
    },
    attributes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          predicate: { type: 'string', enum: [...PREDICATES] },
          value: { type: 'string' },
        },
        required: ['subject', 'predicate', 'value'],
      },
    },
    places: { type: 'array', items: { type: 'string' } },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: { summary: { type: 'string' }, when: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
  required: ['characters', 'attributes', 'places', 'events'],
};

const MAX_ITEMS = 40;
const MAX_LEN = 120;

function cleanString(value: unknown, limit = MAX_LEN): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > limit) return undefined;
  return trimmed;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS) : [];
}

/**
 * Normalise whatever the model returned into something the graph can hold.
 *
 * Every field is treated as untrusted. A small model will occasionally return a
 * predicate outside the enum, a name that is really a sentence, or `present` as the
 * string "yes" — and a bad fact silently entering the graph is worse than no fact,
 * because Tier 0 will then confidently contradict the writer's own prose with it.
 */
export function normalizeExtraction(raw: unknown): SceneExtraction {
  if (raw === null || typeof raw !== 'object') return { ...EMPTY_EXTRACTION };
  const record = raw as Record<string, unknown>;

  const truthy = (value: unknown): boolean =>
    value === true || value === 'true' || value === 'yes' || value === 1;

  const characters: ExtractedCharacter[] = [];
  for (const item of asArray(record['characters'])) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const name = cleanString(entry['name'], 60);
    // A "name" with a verb in it is a sentence the model produced instead of a name.
    if (!name || name.split(' ').length > 4) continue;
    characters.push({
      name,
      aliases: asArray(entry['aliases'])
        .map((a) => cleanString(a, 60))
        .filter((a): a is string => a !== undefined && a !== name),
      present: truthy(entry['present']),
      speaks: truthy(entry['speaks']),
    });
  }

  const attributes: ExtractedAttribute[] = [];
  for (const item of asArray(record['attributes'])) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const subject = cleanString(entry['subject'], 60);
    const predicateRaw = cleanString(entry['predicate'], 20)?.toLowerCase();
    const value = cleanString(entry['value'], 60);
    if (!subject || !value || !predicateRaw) continue;
    if (!(PREDICATES as readonly string[]).includes(predicateRaw)) continue;
    attributes.push({ subject, predicate: predicateRaw as Predicate, value: value.toLowerCase() });
  }

  const places = asArray(record['places'])
    .map((p) => cleanString(p, 60))
    .filter((p): p is string => p !== undefined);

  const events: ExtractedEvent[] = [];
  for (const item of asArray(record['events'])) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const summary = cleanString(entry['summary'], MAX_LEN);
    if (!summary) continue;
    const when = cleanString(entry['when'], 60);
    events.push(when ? { summary, when } : { summary });
  }

  return { characters, attributes, places, events };
}

/** Did the model actually find anything? Used to decide whether a retry is worth it. */
export function isEmpty(extraction: SceneExtraction): boolean {
  return (
    extraction.characters.length === 0 &&
    extraction.attributes.length === 0 &&
    extraction.places.length === 0 &&
    extraction.events.length === 0
  );
}
