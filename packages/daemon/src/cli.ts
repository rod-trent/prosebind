#!/usr/bin/env node
import { resolve } from 'node:path';
import { TIER0_CHECKS, hasBible } from '@prosebind/core';
import { initProject } from './init.js';
import { formatReport, formatWatchLine } from './report.js';
import { Session } from './session.js';
import { ProjectWatcher } from './watcher.js';

const USAGE = `prosebind — a continuity engine for long-form writing

  prosebind init [dir]        create a continuity bible
  prosebind check [dir]       analyse once and print findings
  prosebind watch [dir]       analyse continuously as you write
  prosebind checks            list the checks that run

Options
  --keys                      show the suppression key for each finding
  --json                      emit findings as JSON
  --debounce <ms>             quiet period before analysing (watch, default 900)

check exits 1 when a contradiction is found, so it can gate a commit.
Prosebind never rewrites your prose, and makes no network calls.
`;

interface Flags {
  keys: boolean;
  json: boolean;
  debounce: number;
}

function parse(argv: readonly string[]): { command: string; dir: string; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = { keys: false, json: false, debounce: 900 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--keys') flags.keys = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--debounce') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isNaN(value)) flags.debounce = value;
    } else if (arg === '-h' || arg === '--help') positional.push('help');
    else if (!arg.startsWith('-')) positional.push(arg);
  }

  return {
    command: positional[0] ?? 'help',
    dir: resolve(positional[1] ?? process.cwd()),
    flags,
  };
}

async function warnIfNoBible(root: string): Promise<void> {
  if (await hasBible(root)) return;
  process.stderr.write(
    'No bible found. Prosebind still runs, but most checks need canon to check against.\n' +
      'Run "prosebind init" to create one.\n\n',
  );
}

async function main(): Promise<number> {
  const { command, dir, flags } = parse(process.argv.slice(2));

  if (command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === 'checks') {
    for (const check of TIER0_CHECKS) {
      process.stdout.write(`${check.id.padEnd(26)}${check.category.padEnd(18)}${check.describes}\n`);
    }
    process.stdout.write('\nAll Tier 0: deterministic, no language model, no network.\n');
    return 0;
  }

  if (command === 'init') {
    const { created, skipped } = await initProject(dir);
    for (const path of created) process.stdout.write(`created  ${path}\n`);
    for (const path of skipped) process.stdout.write(`kept     ${path}\n`);
    process.stdout.write('\nEdit .prosebind/bible/characters.yaml, then run "prosebind check".\n');
    return 0;
  }

  if (command === 'check') {
    await warnIfNoBible(dir);
    const session = await Session.open(dir);
    const result = await session.loadAll();

    reportBibleIssues(session);

    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ diagnostics: result.diagnostics, stats: result.stats }, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${formatReport(result, { root: dir, documents: session.documents, showKeys: flags.keys })}\n`,
      );
    }

    return result.diagnostics.some((d) => d.severity === 'contradiction') ? 1 : 0;
  }

  if (command === 'watch') {
    await warnIfNoBible(dir);
    const session = await Session.open(dir);
    const initial = await session.loadAll();
    reportBibleIssues(session);
    process.stdout.write(
      `${formatReport(initial, { root: dir, documents: session.documents, showKeys: flags.keys })}\n\n`,
    );
    process.stdout.write(`Watching ${dir}. Nothing is analysed while you are typing.\n`);

    const watcher = new ProjectWatcher(dir, {
      debounceMs: flags.debounce,
      onError: (error) => process.stderr.write(`${error.message}\n`),
      onBatch: async (events) => {
        const bibleChanged = events.some((e) => e.kind === 'bible');
        const result = bibleChanged
          ? await session.reloadBible()
          : await session.reload(events.map((e) => e.path));

        process.stdout.write(`${formatWatchLine(result)}\n`);
        const fresh = result.diagnostics.filter((d) => d.severity === 'contradiction').slice(0, 5);
        for (const diagnostic of fresh) {
          process.stdout.write(`         ${diagnostic.message}\n`);
        }
      },
    });

    watcher.start();

    await new Promise<void>((resolveWait) => {
      const stop = (): void => {
        watcher.close();
        process.stdout.write('\nStopped.\n');
        resolveWait();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
    return 0;
  }

  process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
  return 2;
}

function reportBibleIssues(session: Session): void {
  if (session.bibleIssues.length === 0) return;
  process.stderr.write('Problems in your bible:\n');
  for (const issue of session.bibleIssues) {
    process.stderr.write(`  ${issue.file}: ${issue.message}\n`);
  }
  process.stderr.write('\n');
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 70;
  });
