import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const META = `# Facts about the manuscript as a whole.
# Everything here is optional — checks that need a value stay silent without it,
# rather than guessing at a timeline you never committed to.

title: Untitled
pov: third-limited     # first | third-limited | third-omniscient
tense: past            # past | present
storyDate: 2019-03-08  # the in-world date the story opens on
`;

const CHARACTERS = `# Characters. Everything here is canon: it outranks anything Prosebind
# infers from your prose. If a finding is wrong because this file is wrong,
# fix this file and the finding disappears.

- name: Elena Vasquez
  aliases: [Elena, Ms. Vasquez]
  born: 1987-04-02
  attributes:
    eyes: grey
    hair: black

- name: Marcus Vasquez
  aliases: [Marcus]
  born: 1984-11-19
  attributes:
    eyes: brown
    hair: brown
  # Once this event has happened, Marcus may not act or speak again.
  # deceasedAfter: the-funeral

# - name: Aunt Ruth
#   introducedAt: the-funeral   # naming her before this raises a question
`;

const TIMELINE = `# Points on the story's timeline.
#
# Pin an event to the manuscript in one of two ways:
#
#   at: "a verbatim line from your prose"   precise, and survives you editing around it
#   chapter: 9                              approximate, but no quoting required
#
# Events with neither are still ordered by date, but cannot support checks that
# ask whether something happened before a given point in the prose.

- id: the-funeral
  label: The funeral
  date: 2019-03-11
  # at: "The coffin went down badly."

- id: the-flood
  label: The quarry floods
  date: 2019-03-11
  # chapter: 12
`;

const SUPPRESS = `# Findings Prosebind should stop raising.
#
# Add a key to silence one finding, or "check-id/*" to silence a whole check.
# Deliberate inconsistency is normal fiction — an unreliable narrator, a character
# who lies, a fact withheld from the reader. This file is how you say so.

# - "pov-drift/3f2a1b9c"
# - "unintroduced-mention/aunt-ruth"
`;

const README = `# Your continuity bible

These files are yours. They are plain text, they belong in your repository, and
Prosebind treats them as canon — they outrank anything it infers from your prose.

  meta.yaml       the manuscript's POV, tense, and opening date
  characters.yaml who exists, and what is true about them
  timeline.yaml   when things happen, and where in the prose
  suppress.yaml   findings you have told Prosebind to stop raising

Nothing here is required. Prosebind works with an empty bible — it just has less
to check against. Add detail where you want the tool paying attention.
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface InitResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Scaffold a bible. Never overwrites: a writer running `init` twice must not lose
 * the canon they have accumulated.
 */
export async function initProject(root: string): Promise<InitResult> {
  const dir = join(root, '.prosebind');
  const bible = join(dir, 'bible');
  await mkdir(bible, { recursive: true });

  const files: Array<[string, string]> = [
    [join(bible, 'meta.yaml'), META],
    [join(bible, 'characters.yaml'), CHARACTERS],
    [join(bible, 'timeline.yaml'), TIMELINE],
    [join(dir, 'suppress.yaml'), SUPPRESS],
    [join(dir, 'README.md'), README],
  ];

  const created: string[] = [];
  const skipped: string[] = [];

  for (const [path, body] of files) {
    if (await exists(path)) {
      skipped.push(path);
      continue;
    }
    await writeFile(path, body, 'utf8');
    created.push(path);
  }

  return { created, skipped };
}
