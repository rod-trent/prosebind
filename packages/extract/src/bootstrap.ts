import type { Document, Segment } from '@prosebind/core';
import type { SceneExtractor } from './extract.js';
import type { SceneExtraction } from './schema.js';

/**
 * Build a proposed bible from prose.
 *
 * This is the capability that unlocks the real benchmarks: FlawedFictions and
 * ConStory-Bench supply stories with no bible, and Tier 0 cannot check prose against
 * entities nobody declared. Bootstrap closes that gap — and it is also the answer to
 * "I already have 90,000 words, where do I start".
 *
 * It never writes to the writer's bible. The output is a *proposal* they read, edit and
 * accept, because § 6 says the extractor will be wrong and the writer must always be
 * able to win the argument. Silently authoring someone's canon from a 4B model's
 * reading would invert that completely.
 */

export interface ProposedCharacter {
  name: string;
  aliases: string[];
  attributes: Record<string, string>;
  /** Scenes the character was found in. Frequency is the main signal of importance. */
  scenes: number;
  /** Scenes where they were physically present rather than merely mentioned. */
  present: number;
  speaks: number;
}

export interface BootstrapResult {
  characters: ProposedCharacter[];
  places: Array<{ name: string; scenes: number }>;
  events: Array<{ summary: string; when?: string | undefined }>;
  scenesExamined: number;
  scenesExtracted: number;
  durationMs: number;
}

export interface BootstrapOptions {
  extractor: SceneExtractor;
  documents: readonly Document[];
  /** Names already declared, so the model links to them instead of duplicating. */
  knownNames?: readonly string[] | undefined;
  /** Surface form to canonical name, from the bible if there is one. */
  canonical?: ReadonlyMap<string, string> | undefined;
  /** Drop characters appearing in fewer scenes than this. */
  minScenes?: number | undefined;
  onProgress?: ((done: number, total: number, scene: string) => void) | undefined;
}

function key(name: string): string {
  return name.trim().toLowerCase();
}

export async function bootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const started = performance.now();
  const scenes: Segment[] = [];
  for (const doc of options.documents) {
    for (const segment of doc.segments) {
      if (segment.kind === 'scene') scenes.push(segment);
    }
  }
  // A manuscript with no scene breaks still has chapters; fall back rather than
  // silently extracting nothing.
  if (scenes.length === 0) {
    for (const doc of options.documents) {
      for (const segment of doc.segments) {
        if (segment.kind === 'chapter') scenes.push(segment);
      }
    }
  }

  const characters = new Map<string, ProposedCharacter>();
  const places = new Map<string, number>();
  const events: Array<{ summary: string; when?: string | undefined }> = [];
  /** Attribute votes: a 4B model contradicts itself, so take the plurality. */
  const votes = new Map<string, Map<string, number>>();

  let extracted = 0;

  for (const [index, scene] of scenes.entries()) {
    options.onProgress?.(index, scenes.length, scene.title ?? `scene ${index + 1}`);
    const record = await options.extractor.extract(
      scene,
      options.knownNames ?? [],
      options.canonical ?? new Map(),
    );
    const result: SceneExtraction = record.extraction;
    if (
      result.characters.length > 0 ||
      result.places.length > 0 ||
      result.events.length > 0
    ) {
      extracted++;
    }

    for (const character of result.characters) {
      const id = key(character.name);
      const entry = characters.get(id) ?? {
        name: character.name,
        aliases: [],
        attributes: {},
        scenes: 0,
        present: 0,
        speaks: 0,
      };
      entry.scenes++;
      if (character.present) entry.present++;
      if (character.speaks) entry.speaks++;
      for (const alias of character.aliases) {
        if (!entry.aliases.includes(alias) && key(alias) !== id) entry.aliases.push(alias);
      }
      characters.set(id, entry);
    }

    for (const place of result.places) {
      places.set(place, (places.get(place) ?? 0) + 1);
    }

    for (const event of result.events) {
      if (!events.some((existing) => existing.summary === event.summary)) events.push(event);
    }

    for (const attribute of result.attributes) {
      const bucket = `${key(attribute.subject)}|${attribute.predicate}`;
      const tally = votes.get(bucket) ?? new Map<string, number>();
      tally.set(attribute.value, (tally.get(attribute.value) ?? 0) + 1);
      votes.set(bucket, tally);
    }
  }

  // Resolve attributes by plurality vote across scenes.
  for (const [bucket, tally] of votes) {
    const [subject, predicate] = bucket.split('|');
    if (!subject || !predicate) continue;
    const entry = characters.get(subject);
    if (!entry) continue;
    const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (winner) entry.attributes[predicate] = winner[0];
  }

  const minScenes = options.minScenes ?? 1;
  const proposed = [...characters.values()]
    .filter((c) => c.scenes >= minScenes)
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));

  return {
    characters: proposed,
    places: [...places.entries()]
      .map(([name, scenes]) => ({ name, scenes }))
      .sort((a, b) => b.scenes - a.scenes),
    events,
    scenesExamined: scenes.length,
    scenesExtracted: extracted,
    durationMs: performance.now() - started,
  };
}

/**
 * Render a proposal as bible YAML.
 *
 * Written to `*.proposed.yaml`, never over the writer's own file. Every entry carries
 * how often it was seen, so the writer can judge what to keep — a character in one
 * scene is probably a walk-on, and possibly a hallucination.
 */
export function renderProposal(result: BootstrapResult, model: string): string {
  const lines: string[] = [
    '# PROPOSED — not canon.',
    '#',
    `# Extracted from your prose by ${model}. Nothing here has been agreed to by you,`,
    '# and Prosebind will not treat any of it as canon while it lives in this file.',
    '#',
    '# Review it, delete what is wrong, then merge what remains into characters.yaml.',
    '# "scenes" is how many scenes the character was found in: a count of 1 is usually',
    '# a walk-on, and occasionally something the model invented.',
    '',
  ];

  if (result.characters.length === 0) {
    lines.push('# No characters were extracted.');
    return `${lines.join('\n')}\n`;
  }

  for (const character of result.characters) {
    lines.push(`- name: ${quote(character.name)}`);
    if (character.aliases.length > 0) {
      lines.push(`  aliases: [${character.aliases.map(quote).join(', ')}]`);
    }
    const attributes = Object.entries(character.attributes);
    if (attributes.length > 0) {
      lines.push('  attributes:');
      for (const [predicate, value] of attributes) {
        lines.push(`    ${predicate}: ${quote(value)}`);
      }
    }
    lines.push(
      `  # scenes: ${character.scenes}, present: ${character.present}, speaks: ${character.speaks}`,
    );
    lines.push('');
  }

  if (result.places.length > 0) {
    lines.push('# Places seen (move to places.yaml if you want them tracked):');
    for (const place of result.places) lines.push(`#   ${place.name} (${place.scenes} scenes)`);
    lines.push('');
  }

  if (result.events.length > 0) {
    lines.push('# Events seen (timeline.yaml needs a date or an "at" quote to use them):');
    for (const event of result.events.slice(0, 30)) {
      lines.push(`#   ${event.summary}${event.when ? ` — ${event.when}` : ''}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function quote(value: string): string {
  return /^[\p{L}\p{N} .'-]+$/u.test(value) && !value.includes(': ') ? value : JSON.stringify(value);
}
