# Prosebind

**A continuity engine for long-form writing.** It keeps a live model of your manuscript and
tells you the moment the story stops adding up — in your editor, on your machine, in a format
you own.

> **Status: v0 — working, model-free.** The engine runs: anchoring, incremental
> segmentation, a continuity graph, and eight Tier 0 checks. No language model is
> involved and no network call is made. Read [DESIGN.md](DESIGN.md) for the argument
> this repository exists to execute.

## Quickstart

```bash
npm install && npm run build
node packages/daemon/dist/cli.js check examples/the-quarry
```

On your own manuscript:

```bash
prosebind init      # create a continuity bible
prosebind check     # analyse once; exits 1 on a contradiction
prosebind watch     # analyse as you write, never while you type
prosebind checks    # list what runs
```

`check` exits non-zero when it finds a contradiction, so it can gate a commit.

### What it catches today

Running against the worked example in `examples/the-quarry`, an 286-word manuscript
with seven deliberate errors planted in it:

```
ch03.md
  × 9:34   Marcus Vasquez speaks here, but died at "Marcus is buried".
           ↳ Marcus is buried (2019-03-11) — ch02.md:3
  × 7:7    Elena Vasquez is 38 here, but would be 32 in 2019.
  × 11:22  Elena Vasquez's eyes are green here. Your bible says grey.
  ? 3:1    This paragraph reads as present tense. The manuscript is past tense.
  ? 14:1   First-person narration here, but the manuscript is third-limited.
ch02.md
  × 6:51   "Elana" is one letter from "Elena". Did you mean Elena Vasquez?
ch01.md
  ? 12:25  Ruth Ellery is named here, before "Marcus is buried" introduces them.
```

Note the cross-file reasoning: the death is pinned in chapter 2 and the violation is
found in chapter 3.

### Incrementality, measured

```bash
npm run demo
```

```
cold start     17 of 17 segments · 15.0ms
after one edit  3 of 17 segments · 0.2ms
work avoided   82%
findings       7 cold → 7 warm

Incremental result matches a cold start exactly.
```

Three segments, not seventeen: the edited paragraph plus the scene and chapter that
contain it. That ratio is what makes real-time affordable, and the script fails loudly
if the incremental path ever disagrees with a cold start.

---

## The problem

Every AI writing tool on the market is a generator with a chat box. Continuity checking is a
different animal: **consistency verification over a mutating knowledge base.**

Existing continuity tools are all *batch* — upload a finished draft, receive a report, pay per
run. That approach is also the one the research says works worst:

- State-of-the-art models "struggle regardless of the reasoning effort allowed, with performance
  significantly degrading as story length increases" ([FlawedFictions](https://arxiv.org/abs/2504.11900))
- The strongest tested model holds narrative consistency **42%** of the time after 20 turns
  ([NCP-Bench](https://arxiv.org/html/2608.08160))
- Contradictions cluster **40–60%** of the way through a text — precisely the "lost in the middle"
  dead zone where long-context attention is weakest ([ConStory-Bench](https://aclanthology.org/2026.findings-acl.410.pdf))

Continuity errors hide exactly where long context is worst at finding them.

## The approach

Maintain a **continuity graph** incrementally instead of re-reading the book:

- Segment the manuscript into scenes and paragraphs, content-hash each one
- Re-extract only what changed, propagate deltas into the graph
- Re-run only the checks touching affected nodes

This is incremental compilation, applied to prose. It makes real-time feasible, it makes the
token cost survivable — a typical edit costs 1–3k tokens instead of 130k — and it follows the
architecture the literature actually validates ([SCORE](https://arxiv.org/html/2503.23512v1)).

## Principles

1. **Never generate prose.** Prosebind asks questions. It never fills the page. This is a
   permanent constraint, not a v1 limitation.
2. **Never interrupt.** Nothing surfaces mid-flow. Pause, scene boundary, session end, or you asked.
3. **Precision over recall.** Ten false positives and the tool gets uninstalled. A check that
   fires wrongly is worse than a check that does not exist.
4. **The writer owns the data.** The bible is plain text next to your manuscript. Readable,
   editable, correctable, portable, and committed to your own repo.
5. **Local by default.** Tier 0 needs no model. Tier 1 runs on-device. Any call that crosses the
   network is opt-in and shown explicitly.

## Repository layout

```
packages/
  core/      AGPL   graph, anchoring, segmentation, Tier 0 checks — no network, no models
  daemon/    AGPL   file watcher, tier orchestration, provider-agnostic model layer
  lsp/       AGPL   language server — diagnostics, hover, code actions, symbols
  mcp/       AGPL   MCP server — the graph, queryable by agents
  spec/      Apache the graph format and protocol specification
clients/
  vscode/    Apache extension — Problems panel, status bar, hover, quick fixes
  obsidian/  Apache plugin — continuity sidebar, status bar, jump-to-finding
benchmarks/         harnesses for FlawedFictions and ConStory-Bench
```

## Editor support

`prosebind-lsp` is a language server for narrative continuity, with zero runtime
dependencies. Neovim, Helix and Zed setup is in [packages/lsp/README.md](packages/lsp/README.md).

| LSP | Narrative meaning |
| --- | --- |
| `publishDiagnostics` | Continuity violations, with severity and confidence |
| `hover` | Entity card — canon vs inferred facts, mentions, birth/death events |
| `definition` | Jump to where this character first appears |
| `references` | Every mention across the project, not just this file |
| `documentSymbol` | Chapters and scenes, with word counts |
| `workspace/symbol` | The bible, browsable |
| `codeAction` | Mark as intentional · Silence this check |

Nothing is published while you type, and **nothing is ever an `Error`** — prose is not a
failing build. Contradictions are `Warning`, questions `Information`, notes `Hint`.

### VS Code

[`clients/vscode`](clients/vscode) wraps the server as an extension: findings in the
Problems panel, a quiet count in the status bar (`4× 3?`), hover cards, and a *Mark as
intentional* quick fix that writes to `.prosebind/suppress.yaml`. No popups — the only
notification it will ever raise is a hard failure to start the server, because a tool
that is silently broken looks exactly like a manuscript with no problems.

```bash
npm run vsix     # build a .vsix you can install
```

From a checkout, press <kbd>F5</kbd> and open `examples/the-quarry`.

The extension is Apache-2.0 because it launches `prosebind-lsp` as a separate process
rather than linking the engine — the arm's-length boundary the AGPL respects.

### Obsidian

[`clients/obsidian`](clients/obsidian) is a desktop plugin. Obsidian has no Problems
panel, so §10's "sidebar with a badge count" is built literally: findings grouped by
file, click to jump to the line, *Mark as intentional* on any of them, and a quiet count
in the status bar.

The whole plugin bundles to **16 KB**, because the only Prosebind code it embeds is the
Apache-2.0 transport from `@prosebind/spec` — it speaks LSP directly rather than
carrying a language-client library.

Many working novelists already write in Obsidian, which makes it the client most likely
to reach the actual audience.

## Agents

[](packages/mcp) exposes the same graph over the Model Context Protocol,
so an agent can ask about a manuscript it has not read:



Eight read-only tools — findings, entities, mentions, timeline, outline, and what the
story has established by a given point. **Every tool is read-only**: an agent may read a
writer's canon, but may not edit the manuscript or decide on their behalf that an
inconsistency was deliberate.

Facts carry their tier ( vs ) in every response, and the instructions
sent on connect tell the model to say which it is relying on — presenting an inference
as established is the failure this design exists to prevent.

## Licensing

Deliberately split, along the line of what links the engine:

- **Engine, daemon, and protocol servers — AGPL-3.0-or-later.** `core`, `daemon`, `lsp`
  and `mcp` all embed the engine, so they all carry its licence. This prevents a closed
  SaaS strip-mine of the core.
- **Spec and clients — Apache-2.0.** `spec` defines the on-disk format and the wire
  protocol; clients speak that protocol without linking the engine. Both are meant to be
  adopted, re-implemented and embedded freely, including commercially. An adopted format
  is the durable asset.

## Roadmap

| Phase | Scope | Exit gate |
| --- | --- | --- |
| **v0** | Daemon, anchoring, incremental graph, Tier 0 only. **No model calls at all.** | Do writers react to Tier 0 alone? |
| **v0.5** | Cold-start import — point it at a finished draft, get a continuity report | Does the report get shared unprompted? |
| **v1** | Tier 1/2 extraction, promise/payoff ledger, LSP + MCP, first clients | Published benchmark scores beat the batch tools |
| **v1.5** | Epistemic state tracking; non-fiction claim graph at parity | Catches errors no competitor catches |
| **v2** | Word add-in; Google Docs via Drive revision polling | Adapters degrade gracefully to pause-time reporting |

Full reasoning, including risks and the competitive picture, is in [DESIGN.md](DESIGN.md).

## On the name

To **bind** a book is to make its separate signatures hold together as one object. Done well it
is invisible; done badly the book falls apart in the reader's hands. That is the job here —
Prosebind watches the seams that hold a long work together and tells you when one is failing.

---

*Not affiliated with any existing writing tool. Prosebind neither writes nor rewrites your prose.*
