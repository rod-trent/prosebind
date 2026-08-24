import type { ContinuityGraph } from '@prosebind/core';
import type { SceneExtraction } from './schema.js';

/**
 * Entity linking.
 *
 * A small model told that "Elena Vasquez" and "Elena" are both known will happily
 * return them as two separate characters, and then a bootstrap proposes a bible with
 * one person in it twice. Prompting helps and does not fix it, so the collapse happens
 * here where it can be tested and cannot regress silently.
 *
 * Two modes, because both cases are real:
 *   - with a bible, map every surface form onto the writer's canonical name
 *   - without one, merge names that are word-subsets of each other, keeping the longest
 */

/** Surface form (lowercased) to the canonical name the writer uses. */
export function canonicalNames(graph: ContinuityGraph): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of graph.entities) {
    map.set(entity.name.toLowerCase(), entity.name);
    for (const alias of entity.aliases) map.set(alias.toLowerCase(), entity.name);
  }
  return map;
}

function words(name: string): string[] {
  return name.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Is `shorter` plausibly the same person as `longer`?
 *
 * True only when every word of the shorter name appears in the longer one — "Elena" in
 * "Elena Vasquez", but not "Ruth" in "Elena Vasquez". Deliberately conservative:
 * merging two different people is a far worse error than leaving a duplicate for the
 * writer to spot, because it silently fuses their facts.
 */
export function isNameSubset(shorter: string, longer: string): boolean {
  const a = words(shorter);
  const b = words(longer);
  if (a.length === 0 || a.length >= b.length) return false;
  return a.every((word) => b.includes(word));
}

/** Collapse duplicate surface forms in one extraction onto a single canonical name. */
export function linkExtraction(
  extraction: SceneExtraction,
  canonical: ReadonlyMap<string, string>,
): SceneExtraction {
  const resolve = (name: string): string => canonical.get(name.trim().toLowerCase()) ?? name.trim();

  // Pass 1: map onto known canonical names.
  const renamed = extraction.characters.map((character) => ({
    ...character,
    name: resolve(character.name),
  }));

  // Pass 2: for anything still unknown, fold short forms into a longer name that
  // contains them — the no-bible case that bootstrap depends on.
  const names = [...new Set(renamed.map((c) => c.name))];
  const fold = new Map<string, string>();
  for (const short of names) {
    if (canonical.has(short.toLowerCase())) continue;
    const longer = names.find((other) => other !== short && isNameSubset(short, other));
    if (longer) fold.set(short, longer);
  }

  const merged = new Map<string, SceneExtraction['characters'][number]>();
  for (const character of renamed) {
    const name = fold.get(character.name) ?? character.name;
    const existing = merged.get(name.toLowerCase());
    if (!existing) {
      merged.set(name.toLowerCase(), { ...character, name });
      continue;
    }
    // A person is present if any surface form of them was present, and speaks if any
    // spoke. Taking the last entry instead would lose whichever mention was richer.
    existing.present = existing.present || character.present;
    existing.speaks = existing.speaks || character.speaks;
    for (const alias of character.aliases) {
      if (!existing.aliases.includes(alias) && alias !== existing.name) existing.aliases.push(alias);
    }
  }

  const attributes = extraction.attributes.map((attribute) => {
    const subject = resolve(attribute.subject);
    return { ...attribute, subject: fold.get(subject) ?? subject };
  });

  return {
    characters: [...merged.values()],
    attributes: dedupeAttributes(attributes),
    places: [...new Set(extraction.places)],
    events: extraction.events,
  };
}

function dedupeAttributes(
  attributes: SceneExtraction['attributes'],
): SceneExtraction['attributes'] {
  const seen = new Set<string>();
  const kept: SceneExtraction['attributes'] = [];
  for (const attribute of attributes) {
    const key = `${attribute.subject.toLowerCase()}|${attribute.predicate}|${attribute.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(attribute);
  }
  return kept;
}

/**
 * Reject attribute values that are obviously not what the predicate asks for.
 *
 * The live model produced `age: "eleven years"` from "she had done it every March for
 * eleven years", and `occupation: "driver"` from "he had driven up from the coast".
 * Both read as plausible JSON and are simply wrong. A prompt cannot be relied on to
 * prevent this; a type check can catch the worst of it.
 */
export function isPlausibleAttribute(predicate: string, value: string): boolean {
  const text = value.trim().toLowerCase();
  if (text.length === 0) return false;

  if (predicate === 'age') {
    // An age is a number, optionally "N years old". A bare duration is not an age.
    if (/\b(years?|months?|weeks?|days?)\s+(ago|of|for)\b/.test(text)) return false;
    if (/^\d{1,3}$/.test(text)) return true;
    if (/^\d{1,3}\s*(years?\s*old|yo)$/.test(text)) return true;
    return /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(-\w+)?$/.test(
      text,
    );
  }

  // Everything else: reject sentence fragments, which is what a misread looks like.
  return text.split(/\s+/).length <= 3;
}

export function filterImplausible(extraction: SceneExtraction): SceneExtraction {
  return {
    ...extraction,
    attributes: extraction.attributes.filter((a) => isPlausibleAttribute(a.predicate, a.value)),
  };
}
