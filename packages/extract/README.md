# @prosebind/extract

**License: AGPL-3.0-or-later.** Embeds `@prosebind/core`. See [NOTICE](../../NOTICE).

Tier 1: turning prose into structured claims with a small local model. The first place
a language model enters Prosebind.

```bash
ollama pull gemma3:4b
prosebind bootstrap /path/to/manuscript
```

## Why this is a separate package

Tier 0's model-free guarantee is structural rather than a matter of discipline.
`@prosebind/core` has no dependency on this package and cannot acquire one without
someone noticing — there are tests asserting both that and that no file under
`core/src/checks/` reaches for the network.

## What it does

**Per scene**, given the prose and the names already in the writer's bible:

- who this scene names, whether they are physically present, and whether they speak
- lasting characteristics the passage states outright (`eyes`, `hair`, `age`, `height`,
  `build`, `occupation`)
- named places
- events, with whatever the prose said about when

**Bootstrap** runs that across a whole manuscript and proposes a bible. This is the
capability that makes the published benchmarks reachable at all: FlawedFictions and
ConStory-Bench supply stories with *no* bible, and Tier 0 cannot check prose against
entities nobody declared.

## Three guarantees

**Extraction never becomes canon.** Every fact is `inferred`, and `resolveFact` prefers
canon on ties, so a wrong guess cannot displace something the writer wrote down.
Discovered characters enter the graph marked `inferred` so no interface can present them
as the writer's own.

**Bootstrap never writes the writer's bible.** Output goes to
`characters.proposed.yaml`, headed *PROPOSED — not canon*, with scene counts so a
walk-on (or a hallucination) is recognisable. Merging is the writer's decision.

**Cloud models are refused by default.** `assertPermitted` throws unless the writer has
explicitly allowed it, and announces the call when they have. Tier 1 is meant to run on
the writer's own machine; that is the claim in DESIGN.md §2 that competitors cannot
honestly make, and it is only true if the code enforces it.

## What a 4B model actually does

Measured on `gemma3:4b` against the clean fixture. Three failures showed up immediately,
and two are fixed in code rather than by prompting:

| Observed | Response |
| --- | --- |
| `Elena Vasquez` and `Elena` returned as two separate characters | [`link.ts`](src/link.ts) collapses surface forms onto the canonical name, and folds word-subsets when there is no bible |
| `age: "eleven years"` — misread from *"every March for eleven years"* | `isPlausibleAttribute` rejects durations as ages |
| `occupation: "driver"` — from *"he had driven up from the coast"* | Not catchable structurally. Survives as `inferred` at 0.6 confidence, and appears in a proposal for review |

The third is the honest limit. A small model reading one scene will sometimes be
confidently wrong in a way no validator can detect, which is exactly why nothing here
is allowed to become canon on its own.

Even after linking, a model given a list of known names tends to report all of them per
scene. `present` is the more reliable signal than mere appearance in the list.

## Latency

**12–45 seconds per scene**, not the sub-second DESIGN.md §7 originally claimed — see
the correction there. Roughly 35s is cold model load; 12–14s per scene once warm.

Two things make that survivable. Extraction is cached by scene content hash, so the cost
is paid once per *edited* scene rather than per keystroke — the same incremental contract
Tier 0 uses, carried across the tier boundary. And §10 already forbids running anything
while the writer is typing.

But real-time Tier 1 is not available at this model size. Bootstrap is a minutes-long
batch job and interfaces must present it as one.

## Failure is never fatal

A model that is missing, slow, or talking nonsense degrades Tier 1 to "extracted
nothing". Tier 0 keeps running, and the writer keeps their deterministic checks. The
error message says so explicitly, because a writer whose tool went quiet needs to know
which half stopped.

## Testing

```bash
node --test "packages/extract/dist/**/*.test.js"
```

`extract.test.ts` covers the pipeline with a deterministic stub and needs no model.
`live.test.ts` exercises a real local model and **skips** when Ollama is absent — a
suite that fails for want of a 3GB download is one people learn to ignore. Set
`PROSEBIND_LIVE_MODEL` to choose a tag.
