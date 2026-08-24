import type { ContinuityGraph, Document, Entity } from '@prosebind/core';

/**
 * Controlled injection of continuity errors into a manuscript.
 *
 * The principle is FlawedFictionsMaker's (arXiv 2504.11900): synthesise errors into
 * human-written prose so ground truth is known without hand-labelling. The scope is
 * narrower on purpose — only error classes Tier 0 claims to detect. Measuring a
 * deterministic rule engine against errors requiring inference would say nothing
 * about the rule engine.
 *
 * Injection is by insertion rather than by rewriting existing sentences. A rewrite can
 * silently destroy an unrelated fact and turn a labelled corpus into a lie about
 * itself; an inserted sentence is exactly as long as its own claim.
 */

export interface Mutation {
  /** The Tier 0 check that should catch this. */
  readonly expectedCheck: string;
  /** 0-based line where the error was introduced. */
  readonly line: number;
  readonly file: string;
  /** What was inserted, for reports. */
  readonly inserted: string;
  readonly note: string;
}

export interface MutationResult {
  readonly text: string;
  readonly mutations: readonly Mutation[];
}

/** Deterministic PRNG, so a seed reproduces a run exactly. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

interface Insertion {
  atLine: number;
  text: string;
  expectedCheck: string;
  note: string;
}

function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** End of the paragraph containing `offset`, so an insertion lands on a blank line. */
function paragraphEnd(text: string, offset: number): number {
  const next = text.indexOf('\n\n', offset);
  return next === -1 ? text.length : next;
}

function subjectPronoun(entity: Entity): string {
  // The corpus fixtures do not record gender, and guessing it from a name would be
  // both unreliable and unpleasant. "They" is always grammatical here.
  return 'They';
}

export interface MutationOptions {
  /** Which checks to target. Defaults to everything supported. */
  checks?: readonly string[];
  /** Number of errors to inject per document. */
  count: number;
  random: () => number;
}

export const SUPPORTED_MUTATIONS = [
  'name-variant',
  'attribute-contradiction',
  'age-arithmetic',
  'deceased-active',
  'pov-drift',
  'tense-drift',
] as const;

/**
 * Inject `count` errors into one document.
 *
 * Returns the mutated text and a label for every error, keyed by the check expected to
 * find it. Nothing here consults Prosebind's own output — the labels are derived from
 * what was inserted, not from what the engine says about it.
 */
export function mutateDocument(
  doc: Document,
  graph: ContinuityGraph,
  options: MutationOptions,
): MutationResult {
  const wanted = new Set(options.checks ?? SUPPORTED_MUTATIONS);
  const candidates: Insertion[] = [];

  const characters = graph.entities.filter((e) => e.type === 'character');
  const mentions = graph.allMentions.filter((m) =>
    doc.segments.some((s) => s.id === m.segmentId),
  );

  const pick = <T>(items: readonly T[]): T | undefined =>
    items.length === 0 ? undefined : items[Math.floor(options.random() * items.length)];

  // --- name-variant: a character's name, misspelled by one letter -----------
  if (wanted.has('name-variant')) {
    const mention = pick(mentions.filter((m) => m.surface.length >= 5));
    if (mention) {
      const entity = graph.entity(mention.entityId);
      if (entity) {
        const variant = misspell(mention.surface, options.random);
        if (variant !== mention.surface) {
          candidates.push({
            atLine: lineOf(doc.text, paragraphEnd(doc.text, mention.span.start)),
            text: `\n\nLater, ${variant} paused at the window and said nothing for a while.`,
            expectedCheck: 'name-variant',
            note: `"${variant}" for "${mention.surface}"`,
          });
        }
      }
    }
  }

  // --- attribute-contradiction: a canon attribute, contradicted -------------
  if (wanted.has('attribute-contradiction')) {
    const withEyes = characters.filter((e) => e.attributes['eyes']);
    const entity = pick(withEyes);
    const mention = entity
      ? pick(mentions.filter((m) => m.entityId === entity.id))
      : undefined;
    if (entity && mention) {
      const canon = (entity.attributes['eyes'] ?? '').toLowerCase();
      const wrong = canon === 'green' ? 'brown' : 'green';
      candidates.push({
        atLine: lineOf(doc.text, paragraphEnd(doc.text, mention.span.start)),
        text: `\n\n${entity.name} looked up. Their ${wrong} eyes caught the last of the light.`,
        expectedCheck: 'attribute-contradiction',
        note: `eyes ${wrong}, canon ${canon}`,
      });
    }
  }

  // --- age-arithmetic: an age the timeline does not support -----------------
  if (wanted.has('age-arithmetic') && graph.meta.storyDate) {
    const withBirth = characters.filter((e) => e.born);
    const entity = pick(withBirth);
    const mention = entity ? pick(mentions.filter((m) => m.entityId === entity.id)) : undefined;
    if (entity?.born && mention) {
      const storyYear = Number.parseInt(graph.meta.storyDate.slice(0, 4), 10);
      const bornYear = Number.parseInt(entity.born.slice(0, 4), 10);
      const correct = storyYear - bornYear;
      const wrong = correct + 7 + Math.floor(options.random() * 5);
      candidates.push({
        atLine: lineOf(doc.text, paragraphEnd(doc.text, mention.span.start)),
        text: `\n\n${entity.name} was ${wrong} years old that spring, and had never once said so aloud.`,
        expectedCheck: 'age-arithmetic',
        note: `stated ${wrong}, should be ${correct}`,
      });
    }
  }

  // --- deceased-active: a dead character speaks -----------------------------
  if (wanted.has('deceased-active')) {
    const dead = characters.filter((e) => {
      if (!e.deceasedAfter) return false;
      const event = graph.event(e.deceasedAfter);
      return event?.position !== undefined;
    });
    const entity = pick(dead);
    const event = entity?.deceasedAfter ? graph.event(entity.deceasedAfter) : undefined;
    const position = event?.position;
    // Only inject into a document that comes after the death; otherwise the error is
    // not an error and the label would be wrong.
    if (entity && position && position.file <= doc.path && doc.text.length > 0) {
      const after = position.file === doc.path ? position.offset : 0;
      candidates.push({
        atLine: lineOf(doc.text, paragraphEnd(doc.text, after)),
        text: `\n\n"You should not have come back here," ${entity.name} said, and turned away.`,
        expectedCheck: 'deceased-active',
        note: `${entity.name} speaks after "${event?.label}"`,
      });
    }
  }

  // --- pov-drift: first person in a third-person manuscript -----------------
  if (wanted.has('pov-drift') && (graph.meta.pov ?? '').startsWith('third')) {
    const paragraph = pick(doc.segments.filter((s) => s.kind === 'paragraph'));
    if (paragraph) {
      candidates.push({
        atLine: lineOf(doc.text, paragraph.span.end),
        text: `\n\nI never understood why any of it mattered so much to me, or why I kept going back.`,
        expectedCheck: 'pov-drift',
        note: 'first-person narration',
      });
    }
  }

  // --- tense-drift: present tense in a past-tense manuscript ----------------
  if (wanted.has('tense-drift') && graph.meta.tense === 'past') {
    const paragraph = pick(doc.segments.filter((s) => s.kind === 'paragraph'));
    if (paragraph) {
      candidates.push({
        atLine: lineOf(doc.text, paragraph.span.end),
        text:
          `\n\n${subjectPronoun(characters[0] ?? ({} as Entity))} walks to the gate and stands there. ` +
          `The wind comes hard off the water and the gulls turn above the rocks. ` +
          `Nothing moves except the light, and it goes slowly, the way it always does this far north.`,
        expectedCheck: 'tense-drift',
        note: 'present-tense narration',
      });
    }
  }

  // Shuffle, take `count`, then apply from the bottom of the file upward so earlier
  // insertions do not shift the line numbers of later ones.
  const shuffled = [...candidates].sort(() => options.random() - 0.5).slice(0, options.count);
  const ordered = [...shuffled].sort((a, b) => b.atLine - a.atLine);

  const lines = doc.text.split('\n');
  const mutations: Mutation[] = [];

  for (const insertion of ordered) {
    // Insert *after* the target paragraph's last line, with a blank separator, so the
    // injected text becomes its own paragraph. Splicing at the last line instead buries
    // it mid-paragraph and puts the label on the wrong line — which shows up in the
    // results as a check that both missed the error and invented one.
    const at = Math.max(0, Math.min(insertion.atLine + 1, lines.length));
    const block = insertion.text.replace(/^\n\n/, '').split('\n');
    lines.splice(at, 0, '', ...block);

    // Insertions run bottom-up so that a pending insertion's target line stays valid.
    // But every splice pushes down everything already placed below it, so labels
    // recorded earlier are now stale. Correct them, or the harness reports detections
    // as misses and the real findings as inventions — which is exactly how this bug
    // first showed up.
    const addedLines = block.length + 1;
    for (let i = 0; i < mutations.length; i++) {
      const previous = mutations[i]!;
      if (previous.line >= at) {
        mutations[i] = { ...previous, line: previous.line + addedLines };
      }
    }

    mutations.push({
      expectedCheck: insertion.expectedCheck,
      // +1 skips the blank separator line we just inserted.
      line: at + 1,
      file: doc.path,
      inserted: block.join(' ').slice(0, 80),
      note: insertion.note,
    });
  }

  return { text: lines.join('\n'), mutations };
}

/** A one-edit misspelling: swap an interior vowel. */
function misspell(name: string, random: () => number): string {
  const vowels = 'aeiou';
  const positions: number[] = [];
  for (let i = 1; i < name.length - 1; i++) {
    if (vowels.includes(name.charAt(i).toLowerCase())) positions.push(i);
  }
  if (positions.length === 0) return name;
  const at = positions[Math.floor(random() * positions.length)] ?? positions[0]!;
  const current = name.charAt(at).toLowerCase();
  const replacement = vowels.charAt((vowels.indexOf(current) + 1) % vowels.length);
  return name.slice(0, at) + replacement + name.slice(at + 1);
}
