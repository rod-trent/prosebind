# Prosebind for Obsidian

Continuity checking for long-form writing, in your vault. Finds contradictions in your
manuscript — a character who speaks after they died, an eye colour that changed between
chapters, an age the arithmetic does not support — and stays quiet while you write.

**License: Apache-2.0.** The plugin launches `prosebind-lsp` as a separate process
rather than linking the AGPL engine. The only Prosebind code it embeds is
`@prosebind/spec`, which is Apache-2.0 and exists to be embedded.

Desktop only: it starts a language server process, and mobile Obsidian has no
`child_process`.

## Setup

```bash
npm install -g @prosebind/lsp @prosebind/daemon
cd /path/to/your/vault && prosebind init
```

Then install the plugin, and open **Prosebind: Open continuity sidebar**.

If the status bar says *not running*, set an absolute path in the plugin settings.
Obsidian does not always inherit the `PATH` from your shell — that is the usual reason a
globally installed binary works in a terminal but not here.

## What you get

- **A continuity sidebar.** Findings grouped by file, with the evidence and a link to
  the conflicting passage in whichever chapter it lives in. Click a finding to jump to
  the line.
- **A status bar count** (`4× 3?`). Click it to open the sidebar.
- **Mark as intentional** on any finding, recorded permanently in
  `.prosebind/suppress.yaml`.
- **Live updates.** Fix the contradiction and the finding disappears — no restart, no
  rescan of the book.

## Two things it will not do

**It never writes prose.** Not as an option, not behind a flag. Prosebind asks
questions; it never fills the page.

**It never interrupts.** Nothing is analysed while you are typing, and findings only
ever accumulate in the sidebar and status bar. There is exactly one `Notice` in the
whole plugin, and it fires only when the language server fails to start — because a
silently broken tool is indistinguishable from a manuscript with no problems. There is
a test asserting that stays true.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Language server path | `prosebind-lsp` | Absolute path if a bare name fails. A path ending `.js` is run with Node. |
| Quiet period | `900ms` | Time after your last keystroke before anything is analysed. |
| Show | Everything | Lowest severity to report. Narrow it while drafting. |

## Developing

From a checkout of the monorepo:

```bash
npm install && npm run build
```

That produces `main.js` next to `manifest.json`. Symlink or copy this folder into
`<vault>/.obsidian/plugins/prosebind/` — you need `main.js`, `manifest.json` and
`styles.css`.

Point the plugin's server path at `packages/lsp/dist/cli.js` to run against your working
tree, and open `examples/the-quarry` as a vault for a short manuscript with seven
deliberate continuity errors in it.

## Not done

- **No inline highlighting.** Findings live in the sidebar only. Decorating the editor
  needs CodeMirror 6 integration, and § 10 puts inline marks behind hard contradictions
  above a confidence floor — worth doing carefully rather than quickly.
- **No mobile support**, and there will not be: the engine runs as a local process.
