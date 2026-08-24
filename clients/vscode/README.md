# Prosebind for VS Code

Continuity checking for long-form writing, in the editor. Finds contradictions in your
manuscript — a character who speaks after they died, an eye colour that changed between
chapters, an age the arithmetic does not support — and stays quiet while you write.

**License: Apache-2.0.** This extension only speaks the wire protocol; it launches
`prosebind-lsp` as a separate process rather than linking the AGPL engine.

## Requirements

The language server, and a project with a continuity bible:

```bash
npm install -g @prosebind/lsp @prosebind/daemon
prosebind init
```

The extension activates when it sees a `.prosebind` directory. If `prosebind-lsp` is not
on your `PATH`, point at it with `prosebind.serverPath`.

## What you get

- **Problems panel** — every continuity finding, with the evidence and a link to the
  conflicting passage in whichever chapter it lives in.
- **Status bar** — a quiet count (`4× 3?`). Click it to open the Problems panel.
- **Hover** — an entity card: canon vs inferred facts, mention counts, birth and death.
- **Go to definition** — jump to where a character first appears to the reader.
- **Find references** — every mention across the project, not just this file.
- **Outline** — chapters and scenes with word counts.
- **Go to symbol in workspace** — your bible, browsable.
- **Quick fix** — *Mark as intentional*, or silence a whole check. Recorded permanently
  in `.prosebind/suppress.yaml`.

## Two things it will not do

**It never writes prose.** Not as an option, not behind a flag. Prosebind asks
questions; it never fills the page.

**It never interrupts.** Nothing is analysed or published while you are typing — every
keystroke resets a quiet period (default 900ms), and saving flushes it. Findings
accumulate in the Problems panel and the status bar; there are no popups. The one
exception is a hard failure to start the server, because a tool that is silently broken
is indistinguishable from a manuscript with no problems.

Nothing is ever reported as an **Error**, either. Prose is not a failing build.
Contradictions are warnings, questions are information, notes are hints.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `prosebind.serverPath` | `""` | Path to `prosebind-lsp`. Empty searches workspace `node_modules`, then `PATH`. |
| `prosebind.debounceMs` | `900` | Quiet period after your last keystroke before analysing. |
| `prosebind.severityFloor` | `note` | Lowest severity shown inline. Set to `contradiction` while drafting. |

## Commands

All under **Prosebind:** in the command palette — *Recheck continuity*, *Create
continuity bible*, *Open continuity bible*, *Restart language server*, *Show log*.

## Developing

From a checkout of the monorepo:

```bash
npm install && npm run build
```

Then press <kbd>F5</kbd> in VS Code. Opening `examples/the-quarry` gives you a short
manuscript with seven deliberate continuity errors to check against.
