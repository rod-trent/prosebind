# Prosebind

**A continuity engine for long-form writing.** It keeps a live model of your manuscript and
tells you the moment the story stops adding up — in your editor, on your machine, in a format
you own.

> **Status: pre-implementation.** The design is settled; the code is not written yet.
> Read [DESIGN.md](DESIGN.md) first — it is the argument this repository exists to execute.

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
  spec/      Apache the graph format and protocol specification
  lsp/       Apache language server — diagnostics, hover, code actions
  mcp/       Apache MCP server over the same graph
clients/
  vscode/           thin LSP client
  obsidian/         plugin wrapping the same server
benchmarks/         harnesses for FlawedFictions and ConStory-Bench
```

## Licensing

Deliberately split:

- **Engine and daemon — AGPL-3.0-or-later.** Prevents a closed SaaS strip-mine of the core.
- **Spec, protocol, and clients — Apache-2.0.** The format is meant to be adopted, re-implemented
  and embedded freely, including commercially. An adopted format is the durable asset.

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
