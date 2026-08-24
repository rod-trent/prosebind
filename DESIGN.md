# Throughline — Positioning & Design

> **Working name.** *Throughline* is the dramaturgical term for the spine a story must hold from
> first page to last — the thing continuity errors break. Verify package-name availability on npm,
> PyPI and crates.io before committing.

**A continuity engine for long-form writing.** It maintains a live model of your manuscript and
tells you when the story contradicts itself — inside the editor you already use.

Draft 1 · August 2026 · Status: pre-implementation

---

## § 1 — The bet: continuity is a state problem, not a generation problem

Every AI writing tool on the market is a generator with a chat box. Continuity checking is a
different animal: **consistency verification over a mutating knowledge base.**

The value does not live in the prompt. It lives in a persistent, structured model of the
manuscript — who exists, what is true, when it happened, who knows it, what has been promised to
the reader. That model is the product. The language model is one of several ways to populate and
query it.

Three consequences:

- **The graph is the moat, not the model access.** Anyone can call a frontier model. Nobody else
  has an incremental extraction pipeline over a writer's live manuscript.
- **Most high-precision checks need no model at all.** Timeline arithmetic, attribute
  contradictions, presence violations — deterministic, instant, free.
- **Real-time becomes tractable.** You are not re-reading 90,000 words on every keystroke. You
  invalidate a few nodes and re-check an affected subgraph. Incremental compilation, applied to prose.

> **The bet:** symbolic state tracking beats raw long context for narrative consistency, and the
> gap widens as manuscripts get longer. Every shipping competitor is on the wrong side of that
> line. See § 4.

---

## § 2 — Positioning: continuity as infrastructure, not as a report

Competitors sell an *audit* — a one-time artifact you buy, read, and discard. Throughline is a
*substrate*: a persistent, incrementally maintained, writer-owned continuity graph that lives
beside the manuscript and stays current as you type.

> **The sentence:** Throughline keeps a live model of your story and tells you the moment it stops
> adding up — in your editor, on your machine, in a format you own.

The developer-facing version of the same idea: **a language server for narrative.** That framing
does real work with the technical audience who will write the editor adapters.

| What it is | What it is not |
| --- | --- |
| A continuity engine and an open graph format | A prose generator, ever (see § 10) |
| Incremental — always current, never a batch job | A grammar or line-editing tool |
| In your editor, not on someone's website | A manuscript-scoring or market-fit oracle |
| Local by default; cloud strictly opt-in | Another writing app you must migrate into |
| A reader that asks questions | A subscription to a report |

### Three obvious positions are already taken

Each was a candidate. Research killed all three as *headline* positioning; two survive as
supporting claims.

- **"AI that finds plot holes"** — the category filled in. CipherWrite, ProseEngine, FirstReader,
  River, AutoCrit and Sudowrite all ship something here.
- **"Analytical, not generative"** — owned outright by [Marlowe](https://authors.ai/marlowe/) since
  2020: 40,000+ authors, rights-cleared corpus, co-built by the author of *The Bestseller Code*.
  Correct as a product stance, unusable as a tagline.
- **"Private, never trains on your work"** — now standard marketing. CipherWrite sells
  zero-knowledge encryption; "creative sovereignty" is a category term.

There is a real crack in the third. **A zero-knowledge cloud tool has to decrypt the manuscript to
audit it.** Actual on-device inference is a claim none of them can honestly make — and it is only
credible with an open codebase. Privacy is not our headline, but it is our footnote that
competitors cannot copy.

---

## § 3 — Market reality: everyone is batch

| Tool | Mode | Stance | Surface |
| --- | --- | --- | --- |
| Marlowe | Batch upload | Analytical only | Web |
| CipherWrite Auditor | Batch, per-audit | Encrypted cloud | Own editor |
| FirstReader | Batch, 24–48 hr | Developmental | Web |
| ProseEngine | Batch scan | Mixed | Web |
| AutoCrit | Batch scan | Mixed | Own editor |
| Sudowrite | Context feed | Generative | Own editor |
| Novelcrafter | Manual bible | Generative, BYOK | Own editor |

**Not one maintains continuity incrementally as you write.** Sudowrite's Chapter Continuity sounds
like the target but isn't: it chains ~20,000 words of prior chapters into the *generation* prompt to
prevent errors, not to detect them in prose you wrote yourself.

### Open source is entirely generators

ABook, StoryCraftr, Novel Engine and novel-novel-generator are autonomous book-writing pipelines.
[AuthorAgent](https://github.com/Ckokoski/AuthorAgent) (MIT, ~99 stars) comes closest — contradiction
detection against an entity database, Chekhov's-gun tracking — but it is an orchestration system
that writes the book, not a companion for a human doing the writing.

Prose language servers exist ([prosemd-lsp](https://github.com/kitten/prosemd-lsp), Vale) but
strictly for grammar and style. **Narrative-level LSP is unclaimed.**

> **The opening:** the gap is not "continuity checking." It is **incremental, in-editor,
> writer-owned** continuity checking. Narrower than it first looked, and defensible for structural
> reasons rather than UX ones.

### The cost asymmetry

Batch auditors must re-read the entire book on every run — hence FirstReader's platform fee plus
per-thousand-word rate, and CipherWrite metering audits behind a subscription. Incremental analysis
makes the marginal cost of an edit approximately zero: a typical edit costs 1–3k tokens instead of
130k. That is not an optimization, it is a different business.

---

## § 4 — Evidence: the research says long context is the wrong tool

The strongest argument here is not ours — it is the published literature's.

| Finding | Source |
| --- | --- |
| **42%** — consistency survival rate of the strongest tested model after 20 narrative turns | NCP-Bench, 2026 |
| **40–68%** — share of all failures that are fact conflicts with established world-state | NCP-Bench, 2026 |
| **F1 ≈ 0.302** — catastrophic collapse at 50% of maximum context | Long-context degradation, 2026 |
| **40–60%** — position through the text where contradictions cluster | ConStory-Bench, 2026 |

Read the last two together: **continuity errors hide precisely where long-context attention is
weakest.** That is the structural reason the naive approach underperforms.

Supporting findings:

- [FlawedFictions](https://arxiv.org/abs/2504.11900) finds SOTA models "struggle regardless of the
  reasoning effort allowed, with performance significantly degrading as story length increases."
- Effective usable context is routinely under half the advertised window. Million-token windows move
  the degradation point; they do not remove it.
- [SCORE](https://arxiv.org/html/2503.23512v1) demonstrates the fix: symbolic state tracking +
  hierarchical summarization + hybrid retrieval beats raw context.

> **Why this matters commercially:** "paste the novel into a long-context model" is what the batch
> tools are doing, and it is empirically the weak approach — getting weaker as manuscripts grow. The
> graph-first design is the architecture the research says is correct, and no shipping product uses it.

**Adopt the existing taxonomy.** ConStory-Bench's error categories — timeline/plot logic,
characterization (incl. knowledge drift), world-building, factual detail, narrative/style — become
our diagnostic types verbatim. Free validation, instant legibility to anyone who reads the literature.

---

## § 5 — Architecture: one engine, two protocols, thin clients

Writing one Word add-in gets you Word. Writing five plugins gets you five maintenance burdens and a
fragmented engine. Instead: a local daemon that watches files, maintains the graph, and speaks two
protocols.

### Protocol 1 — LSP, for the ambient in-editor channel

| LSP concept | Narrative meaning |
| --- | --- |
| Diagnostic | A continuity violation, with severity and confidence |
| Hover | Entity card: current state, last seen, known facts, open threads |
| Code action | Mark intentional · Promote to canon · Show the conflicting passage |
| Go to definition | Jump to where this fact was established |
| Find references | Every scene this entity appears in |
| Workspace symbols | The story bible, browsable |

Yields VS Code, Zed, Neovim, Helix and — via a thin plugin — Obsidian, nearly free.

### Protocol 2 — MCP, for the conversational channel

The same graph, exposed so any agent can ask *"what does Marcus know as of chapter 12?"* Roughly 5%
additional work for a second front door and a second audience.

### Adapters for the closed applications

- **Word** — Office.js task pane; Windows, Mac and web. No true document-changed event, so poll the
  body and diff. Content controls give workable anchoring.
- **Google Docs** — the hard one. Apps Script has no edit events and severe execution quotas; Docs
  renders to canvas, so DOM scraping is fragile. **Skip the editor: poll Drive API revisions from the
  daemon.** Lose sub-second latency, keep sanity.
- **Scrivener** — no plugin API, but a `.scriv` is a folder of RTF and XML. Watch the files.

**Sequencing matters.** Do not start with plugins. Prove the engine on plain files with a
file-watching daemon and one thin client. Word second. Docs last, if at all.

### Stack

TypeScript monorepo compiled to a single binary — novelists will not run a package manager. SQLite
as the working index, plain-text files as the source of truth, local embeddings for entity linking,
provider-agnostic model layer from the first commit.

---

## § 6 — The continuity graph

Entities (characters, places, objects, organizations). Facts, each with provenance anchored to a span
of text. Events on a timeline. Relations between all of it. Extracted incrementally, never wholesale.

### Canon versus inference

The extractor **will** be wrong. Not a failure mode to engineer away — a permanent condition to
design around.

Every fact carries a provenance tier. **Inferred** facts come from extraction and can be revised or
dropped. **Canon** facts are pinned by the writer and override extraction permanently. Correcting a
bad extraction is a single keystroke that teaches the system for good.

### The bible is plain text

A `.throughline/` directory beside the manuscript: YAML and Markdown, human-editable, diffable,
committable to git. SQLite is a rebuildable index; the text files are the truth.

> **Non-negotiable:** writers must be able to read, edit, correct and take their continuity data with
> them. An opaque graph is a trust failure no amount of accuracy repairs — and an open, adoptable
> format is harder to kill than a feature.

---

## § 7 — Detection: three tiers, and the cheapest one carries the product

**Tier 0 — deterministic, no model.**
Name-spelling variants. Timeline arithmetic (ages, day counts, seasons). Physical attribute
contradictions. Object location tracking. POV and tense drift. A character speaking in a scene they
were never established as entering. Anyone appearing after they died.
*Instant · free · high precision · runs on every pause.*

**Tier 1 — small local model, per dirty scene.**
Claim extraction, entity linking, coreference resolution. Populates the graph from new prose.
*Sub-second, on device · runs on sustained pause.*

**Tier 2 — frontier model, debounced, background.**
Motivation gaps, unearned turns, thematic drift, pacing, structural analysis. Scene- or
chapter-scoped, never whole-manuscript.
*Opt-in · cloud boundary shown explicitly · runs at scene or session boundaries.*

> Ship Tier 0 alone, first, before any model work. **If Tier 0 does not make writers sit up, the
> premise is wrong** — and you will have learned that for the price of a deterministic rule engine.

---

## § 8 — The three hard problems

### Anchoring

Text moves constantly. A fact bound to "character 14,203" is garbage after one inserted paragraph.
You need content-addressed fuzzy anchors — quote + prefix/suffix context + approximate position,
re-resolved on drift. The same problem annotation systems and document comments solve.

> **Build this first.** Get anchoring wrong and every diagnostic points at the wrong sentence, and
> users leave inside a day. Unglamorous, routinely underestimated, and the load-bearing wall. Solve
> it before any AI work begins.

### Incremental recompute

Segment into scenes and paragraphs. Content-hash each. Re-extract only dirty segments, propagate
deltas into the graph, re-run only the checks touching affected nodes. Model it on a compiler's
query system. This is what makes token cost survivable.

### Deliberate inconsistency

Unreliable narrators. Characters who lie. Mysteries that withhold. A naive checker screams at all of
these and becomes unusable in exactly the literary fiction most worth serving. The weak fix is a mute
button. The strong fix is § 9.

---

## § 9 — Signature capabilities

### Epistemic state tracking

Track three layers separately at every point in the manuscript:

1. What is **true** in the world
2. What each **character knows**, and when they learned it
3. What the **reader** has been told

Almost every real plot hole is a violation *across* these layers rather than a flat contradiction:

- *"Sarah learns Marcus is her brother in ch. 12. In ch. 14 she is surprised by it."*
- *"Elena references the letter, but she left the room before it was read aloud."*
- *"You are playing this as a reveal in ch. 30. The reader has known since ch. 6."*

This also dissolves the unreliable-narrator problem structurally instead of muting it: a lying
character is simply a divergence between what they *know* and what they *say*. Modelled, not
suppressed.

Research confirms knowledge drift is the hardest error class, and "logic-locking" exists as a
technique — but only inside generation systems. **Nobody has built it as a checker over
human-written prose.**

### The promise / payoff ledger

Track every setup, foreshadow and reader-promise, and whether it pays off. Chekhov's guns still
loaded at the end. Threads dropped in act two. The most common beta-reader complaint, and no software
provides it as a live view.

### Non-fiction mode — same engine, different schema

A claim graph instead of a character graph:

- Claims asserted without support; citations that drifted from what the source says
- Terminology used before definition, or defined inconsistently
- "You promised this chapter in the introduction and never delivered it"
- Reader-dependency ordering — concept B requires concept A, which arrives forty pages later
- Argument gaps: premise to conclusion with a missing step

> **Upgraded priority.** Existing non-fiction tooling is all academic-paper-shaped — citations,
> formatting, submission workflow. **Nothing tracks argument continuity across a 300-page book.**
> That gap is wider than the fiction one and the buyers have budgets. Co-equal track, not phase two.

---

## § 10 — Interaction: never interrupt a writer

An agent that interrupts while you write will be uninstalled. Flow is the entire job. This is
Clippy's grave and the project must not fall into it.

- **Detect typing cadence and stay silent during it.** Surface only on sustained pause, scene
  boundary, session end, or direct request.
- **Accumulate quietly.** A sidebar with a badge count, not a popup. Inline marks only for Tier 0
  hard contradictions above a confidence floor.
- **The end-of-session continuity report may be the primary interaction**, with real-time as the
  power-user mode. Design for that possibility.
- **Dismissal is one keystroke and it teaches permanently.** A flag dismissed twice never returns.

### The prose rule

> **Never generate prose. Ever.** The moment it writes sentences it becomes an "AI wrote my book"
> tool: it loses serious novelists, inherits the entire authenticity fight, and gets barred from
> venues and contests increasingly hostile to generative tools.
>
> Throughline asks questions. It never fills the page. The constraint is not a limitation — it opens
> a market segment that currently refuses to touch AI at all.

Note the tension with § 2: the stance is right, but Marlowe already says it out loud. Hold the
principle in the product; do not lead the marketing with it.

---

## § 11 — Build order

Each phase has an exit gate. If a gate fails, that is information worth more than the next phase.

| Phase | Scope | Gate |
| --- | --- | --- |
| **v0** | File-watching daemon. Anchoring. Incremental scene graph. Tier 0 checks only. Plain-text bible. One client. **No model calls at all.** | Do writers react to Tier 0 alone? |
| **v0.5** | Cold-start import: point it at a finished draft, get a full continuity report. The demo, the growth loop, the shareable moment. | Does the report get shared unprompted? |
| **v1** | Tier 1 and 2 extraction. Promise/payoff ledger. LSP and MCP servers. Obsidian and VS Code clients. Non-fiction schema in parallel. | Published benchmark scores beat the batch tools |
| **v1.5** | Epistemic state tracking. Non-fiction claim graph at parity with fiction. | Catches errors no competitor catches |
| **v2** | Word add-in. Google Docs via Drive revision polling. | Adapters degrade gracefully to pause-time reporting |

---

## § 12 — Evaluation: win the existing benchmarks in public

An earlier draft proposed building a benchmark by injecting continuity errors into public-domain
novels. That already exists: [FlawedFictionsMaker](https://arxiv.org/abs/2504.11900) does exactly
this, alongside ConStory-Bench, NCP-Bench and NarraBench.

**Do not build a benchmark — win the ones that exist, and publish the numbers.**

> **A scoreboard is a weapon.** Every competitor markets unverifiable accuracy claims. No product
> publishes benchmark results. In a market running on vibes, being the only tool with numbers is a
> positioning advantage that compounds — and it doubles as the internal tuning loop.

The metric that matters most is not recall. **False positives are the product risk.** Ten wrong flags
and the tool is uninstalled. Bias hard toward precision, surface confidence values, treat a dismissal
as training data. Move this work earlier than instinct suggests: it is simultaneously the validation
loop and the launch material.

---

## § 13 — Licensing and sustainability

- **AGPL** the daemon and engine. Prevents a closed SaaS strip-mine of the core.
- **Apache 2.0** the protocol specification, the graph format and the client SDKs. Adapters should
  proliferate without friction, and an adopted format is the real durable asset.

If revenue becomes necessary, open core is the natural shape: the engine, local inference and every
single-writer feature stay free permanently; hosted sync, shared bibles for co-authors and editors,
and managed cloud inference are the paid tier. Editorial teams and publishers have the budgets — and
non-fiction publishers more than fiction.

---

## § 14 — Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| **R1** | **False positives.** Ten wrong flags and it is gone. Highest-probability failure; a product risk, not a model risk. | Precision over recall always; visible confidence; one-keystroke permanent dismissal; Tier 0 first because it is the most precise tier. |
| **R2** | **Anchoring proves harder than budgeted.** Universally underestimated; everything downstream depends on it. | Build it first, in isolation, with a dedicated test corpus of heavily-revised manuscripts. |
| **R3** | **A batch incumbent adds a folder watcher.** They can copy the mechanism faster than we can build their brand. This is the clock on the whole plan. | Ship the open protocol and graph spec early and loudly. An ecosystem is harder to copy than a feature. Speed over polish in v0/v0.5. |
| **R4** | **Scope collapse.** Fiction + non-fiction + five editors + real-time is four products. The most likely quiet death. | v0 is deliberately one thing with no model calls. Resist every adapter request until the engine is proven. |
| **R5** | **Closed applications fight back.** Word and Docs will deliver worse latency and fidelity than the design wants. | Design every adapter to degrade to pause-time reporting. Never let an adapter constrain the engine. |

---

## § 15 — References

- [Finding Flawed Fictions: Evaluating Complex Reasoning in Language Models via Plot Hole Detection](https://arxiv.org/abs/2504.11900) — arXiv 2504.11900
- [Can LLM Agents Stick to the Script? NCP-Bench](https://arxiv.org/html/2608.08160) — arXiv 2608.08160
- [Lost in Stories: Consistency Bugs in Long Story Generation](https://aclanthology.org/2026.findings-acl.410.pdf) — ACL Findings 2026
- [SCORE: Story Coherence and Retrieval Enhancement for AI Narratives](https://arxiv.org/html/2503.23512v1) — arXiv 2503.23512
- [Intelligence Degradation in Long-Context LLMs](https://arxiv.org/pdf/2601.15300) — arXiv 2601.15300
- [NarraBench: A Framework for Narrative Benchmarking](https://arxiv.org/pdf/2510.09869) — arXiv 2510.09869
- [Marlowe by Authors A.I.](https://authors.ai/marlowe/) — analytical-only positioning
- [CipherWrite Manuscript Auditor](https://cipherwrite.com/tools/manuscript-auditor)
- [Are AI Writing Tools Stealing Your Work? 2026 Privacy Audit](https://cipherwrite.com/blog/are-ai-writing-tools-stealing-your-work-2026)
- [FirstReader](https://firstreader.app/) — batch developmental feedback
- [Sudowrite Chapter Continuity](https://sudowrite.com/blog/how-to-avoid-plot-holes-sudowrites-chapter-continuity-feature-explained/)
- [Novelcrafter Codex review](https://www.toolworthy.ai/tool/novelcrafter)
- [AuthorAgent](https://github.com/Ckokoski/AuthorAgent) — MIT, closest open-source neighbour
- [prosemd-lsp](https://github.com/kitten/prosemd-lsp) — prose LSP prior art
- [Storyloft on manuscript privacy](https://storyloft.app/what-makes-an-ai-writing-tool-safe-for-authors-privacy-training-and-manuscript-control-explained/)
- [Best AI for Novel Continuity Checking, 2026](https://www.inkfluenceai.com/blog/best-ai-novel-continuity-checking-2026)
