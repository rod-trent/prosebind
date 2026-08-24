import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ContinuityGraph } from './graph.js';
import type { Entity, EntityType, Fact, Provenance, StoryEvent, StoryMeta } from './types.js';

/** The bible lives beside the manuscript and belongs to the writer. */
export const BIBLE_DIR = '.prosebind/bible';

export interface BibleIssue {
  readonly file: string;
  readonly message: string;
}

export interface LoadedBible {
  readonly graph: ContinuityGraph;
  /** Problems with the bible itself. Surfaced to the writer, never thrown away. */
  readonly issues: readonly BibleIssue[];
}

const ENTITY_FILES: ReadonlyArray<{ file: string; type: EntityType }> = [
  { file: 'characters.yaml', type: 'character' },
  { file: 'places.yaml', type: 'place' },
  { file: 'objects.yaml', type: 'object' },
  { file: 'organizations.yaml', type: 'organization' },
];

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // yaml parses unquoted dates into Date; normalise back to ISO day precision.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Load the continuity bible from disk.
 *
 * Every fact produced here is `canon`: the writer wrote it down deliberately, so it
 * outranks anything the engine infers from the prose. Malformed entries become
 * issues rather than exceptions — a typo in one character must not blind the tool
 * to the other forty.
 */
export async function loadBible(root: string): Promise<LoadedBible> {
  const dir = join(root, BIBLE_DIR);
  const graph = new ContinuityGraph();
  const issues: BibleIssue[] = [];

  const meta = await readIfPresent(join(dir, 'meta.yaml'));
  if (meta !== undefined) {
    try {
      const parsed = asRecord(parseYaml(meta)) ?? {};
      graph.meta = {
        title: asString(parsed['title']),
        pov: asString(parsed['pov']),
        tense: asString(parsed['tense']),
        storyDate: asString(parsed['storyDate']),
      } satisfies StoryMeta;
    } catch (error) {
      issues.push({ file: 'meta.yaml', message: `could not parse: ${(error as Error).message}` });
    }
  }

  for (const { file, type } of ENTITY_FILES) {
    const raw = await readIfPresent(join(dir, file));
    if (raw === undefined) continue;

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (error) {
      issues.push({ file, message: `could not parse: ${(error as Error).message}` });
      continue;
    }
    if (!Array.isArray(parsed)) {
      issues.push({ file, message: 'expected a top-level list of entries, each starting with "- name:"' });
      continue;
    }

    parsed.forEach((item, index) => {
      const record = asRecord(item);
      if (!record) {
        issues.push({ file, message: `entry ${index + 1} is not a mapping` });
        return;
      }
      const name = asString(record['name']);
      if (!name) {
        issues.push({ file, message: `entry ${index + 1} has no "name"` });
        return;
      }
      const id = asString(record['id']) ?? slugify(name);
      const aliasesRaw = record['aliases'];
      const aliases = Array.isArray(aliasesRaw)
        ? aliasesRaw.map(asString).filter((a): a is string => a !== undefined)
        : [];

      const attributesRecord = asRecord(record['attributes']) ?? {};
      const attributes: Record<string, string> = {};
      for (const [key, value] of Object.entries(attributesRecord)) {
        const str = asString(value);
        if (str !== undefined) attributes[key] = str;
      }

      const entity: Entity = {
        id,
        name,
        type,
        tier: 'canon',
        aliases,
        attributes,
        deceasedAfter: asString(record['deceasedAfter']),
        introducedAt: asString(record['introducedAt']),
        born: asString(record['born']),
      };
      graph.addEntity(entity);

      const provenance: Provenance = { source: 'bible', file };
      for (const [predicate, value] of Object.entries(attributes)) {
        const fact: Fact = {
          id: `${id}:${predicate}`,
          entityId: id,
          predicate,
          value,
          tier: 'canon',
          confidence: 1,
          provenance,
        };
        graph.addFact(fact);
      }
      if (entity.born) {
        graph.addFact({
          id: `${id}:born`,
          entityId: id,
          predicate: 'born',
          value: entity.born,
          tier: 'canon',
          confidence: 1,
          provenance,
        });
      }
    });
  }

  const timeline = await readIfPresent(join(dir, 'timeline.yaml'));
  if (timeline !== undefined) {
    try {
      const parsed = parseYaml(timeline);
      if (!Array.isArray(parsed)) {
        issues.push({ file: 'timeline.yaml', message: 'expected a top-level list of events' });
      } else {
        parsed.forEach((item, index) => {
          const record = asRecord(item);
          if (!record) {
            issues.push({ file: 'timeline.yaml', message: `event ${index + 1} is not a mapping` });
            return;
          }
          const label = asString(record['label']) ?? asString(record['id']);
          if (!label) {
            issues.push({ file: 'timeline.yaml', message: `event ${index + 1} has no "label"` });
            return;
          }
          const chapterRaw = record['chapter'];
          const chapter =
            typeof chapterRaw === 'number'
              ? chapterRaw
              : typeof chapterRaw === 'string'
                ? Number.parseInt(chapterRaw, 10)
                : undefined;

          const event: StoryEvent = {
            id: asString(record['id']) ?? slugify(label),
            label,
            date: asString(record['date']),
            ordinal: index,
            chapter: chapter !== undefined && !Number.isNaN(chapter) ? chapter : undefined,
            at: asString(record['at']),
            provenance: { source: 'bible', file: 'timeline.yaml' },
          };
          graph.addEvent(event);

          // An event nobody can place cannot support before/after reasoning, and a
          // silently unplaceable event makes checks quietly stop working.
          if (!event.at && event.chapter === undefined) {
            issues.push({
              file: 'timeline.yaml',
              message: `event "${event.id}" has no "at" quote or "chapter" — checks that ask whether something happened before it will skip it`,
            });
          }
        });
      }
    } catch (error) {
      issues.push({ file: 'timeline.yaml', message: `could not parse: ${(error as Error).message}` });
    }
  }

  // A referenced-but-undefined event is a silent way for checks to go quiet.
  for (const entity of graph.entities) {
    for (const ref of [entity.deceasedAfter, entity.introducedAt]) {
      if (ref && !graph.event(ref)) {
        issues.push({
          file: 'timeline.yaml',
          message: `"${entity.name}" references event "${ref}", which is not defined`,
        });
      }
    }
  }

  return { graph, issues };
}

/** Whether a project has been initialised. */
export async function hasBible(root: string): Promise<boolean> {
  try {
    const entries = await readdir(join(root, BIBLE_DIR));
    return entries.length > 0;
  } catch {
    return false;
  }
}
