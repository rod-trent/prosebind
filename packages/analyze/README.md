# @prosebind/analyze

**License: AGPL-3.0-or-later.** Embeds `@prosebind/core`. See [NOTICE](../../NOTICE).

Tier 2: judgment analysis over **one passage at a time**. Where Tier 0 proves a
contradiction against declared canon and Tier 1 extracts facts, a lens asks something a
rule engine cannot — does this scene contradict itself, does this turn feel earned.

## The lenses

| Lens | Asks |
| --- | --- |
| `passage-contradiction` | Does this passage contradict itself, with both halves present in it? |
| `unearned-turn` | Does a character do something the passage has not paid for? |

`passage-contradiction` exists because of the [FlawedFictions result](../../benchmarks/FLAWEDFICTIONS.md):
cold-read contradiction detection is the task those benchmarks set, and Tier 2 is the
only tier that can attempt it.

Every finding is a **question**, never a verdict, and `maxConfidence` is capped below 0.8
for every lens. A rule engine can prove a contradiction; a lens cannot, and dressing an
opinion as a verdict is how a tool loses a writer's trust.

## Three constraints, enforced structurally

**Never whole-manuscript.** There is no API here that accepts a book — `analyzeSegment`
takes one scene or chapter. Anything wanting the whole thing has to loop, which puts the
cost at the call site. §4's evidence is that long context is exactly where this kind of
reasoning degrades; that is the argument of the whole project.

**Cloud is opt-in and announced.** `assertPermitted` refuses a cloud model unless the
writer allowed it, and calls back with the byte count before any manuscript text leaves
the machine.

**Cached by passage.** Tier 2 is the most expensive tier, so an unchanged scene is
analysed once per lens.

## The anchoring gate — and what it does not catch

Every finding must quote the passage. That quote is resolved back to a span through the
anchoring layer, and **a finding whose quote cannot be located is dropped**. A model that
cannot point at what it means is guessing, and a writer sent hunting for a line that does
not exist stops trusting every other finding too.

Two tests pinned this down, and both found real bugs:

- A quote from a *different scene* fuzzy-matched and passed at the original 0.6 floor:
  `"Beta sentence here"` matched `"Alpha sentence here."` at 0.83 **character** similarity,
  because they share a fourteen-character tail. The gate now compares **by word**, where
  that scores 0.67 and is correctly rejected.
- Word comparison then rejected a *correct* match, because `"promised."` and `"promised"`
  counted as a substitution, and because the fuzzy window stopped mid-word at `"…had prom"`.
  Spans are now snapped to word boundaries and punctuation is stripped per word.

**What the gate cannot do is judge reasoning.** It verifies that a finding points at real
text. It has nothing to say about whether the observation is any good — and on a small
model, most of them are not.

## What a 4B local model actually produces

Run against the worked example with `gemma3:4b`, every finding anchored cleanly — 5 kept,
0 dropped. The gate was never exercised, because the model quoted faithfully. The
*reasoning* was another matter:

> `Elena was 38 years old and had never once been afraid of this place.`
> — *"This contradicts the later statement that her eyes were wet."*

> `Marcus said nothing for a long while.`
> — *"Marcus's coat detail."*

Neither is a contradiction. One is not even a sentence. A small model produces
plausible-shaped Tier 2 findings that are largely worthless, and the anchoring gate
cannot save it, because the quotes are real.

**Tier 2 needs a frontier model to be worth running.** That is what §7 said, and running
it locally confirms it from the other direction.

## The frontier provider is unverified

[`AnthropicModel`](src/providers/anthropic.ts) follows the documented SDK contract —
adaptive thinking, `output_config.effort`, typed error classes, `stop_reason: "refusal"`
handled as a valid response rather than an exception.

**It has never been run.** There were no Anthropic credentials in the environment it was
written in. The first person to run it should expect to fix something, and should not
read the absence of bug reports as the absence of bugs.

## Testing

```bash
node --test "packages/analyze/dist/**/*.test.js"
```

Sixteen tests, all model-free. They cover both directions of the anchoring gate, the
scope constraint, the network boundary, and that no lens can claim more certainty than a
judgment call deserves.
