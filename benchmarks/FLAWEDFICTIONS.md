# Prosebind on FlawedFictions

```bash
ollama pull gemma3:4b
node benchmarks/dist/run-ff.js --limit 30 --seed 3
```

[FlawedFictions](https://arxiv.org/abs/2504.11900) is 414 Project Gutenberg short stories
— 207 with a continuity error synthesised in, 207 originals — and one binary question:
does this story contain a continuity error? MIT licensed, on HuggingFace as
[`kahuja/flawed-fictions`](https://huggingface.co/datasets/kahuja/flawed-fictions).

DESIGN.md §12 said to win the benchmarks that exist rather than build one, and §11 made
"published benchmark scores beat the batch tools" the v1 gate. So we ran it.

## Result

30 stories, balanced, seed 3. Tier 1 bootstraps a bible from each story with a local
model, then Tier 0 checks the story against it; any finding predicts "flawed".

```
                 predicted flawed   predicted clean
  actually flawed          0                15
  actually clean           0                15

  accuracy    50.0%   (chance is 50.0% on a balanced sample)
  precision    0.0%
  recall       0.0%
  F1           0.000

  No check fired on any story.
```

**Prosebind scores exactly chance. It detects nothing.**

## Why — and why this is not a tuning problem

The harness reports which checks could even run:

```
  deceased-active            never — needs a fact bootstrap does not produce
  unintroduced-mention       never — needs a fact bootstrap does not produce
  age-arithmetic             never — needs a fact bootstrap does not produce
  pov-drift                  never — needs a fact bootstrap does not produce
  tense-drift                never — needs a fact bootstrap does not produce
  attribute-contradiction    eligible on 1/30, fired 0
  name-variant               eligible on 21/30, fired 0
  alias-collision            eligible on 14/30, fired 0
```

Five of eight checks are **structurally incapable** of firing here. They need a death
event pinned to a position, an introduction event, a birth date and a story date, a
declared POV, a declared tense. Those are facts a writer *declares*. They cannot be
extracted from prose, because the prose is what they exist to be checked against.

The remaining three were eligible and still found nothing, for a deeper reason:

> **A bible bootstrapped from a story cannot contradict that story.** It is derived from
> it. Contradiction detection requires an *independent* oracle, and Tier 1 extraction is
> not independent — it reads the same text the checks are checking.

That is not a defect in the extractor or the checks. It is what the architecture is.
Prosebind checks prose against declared canon. FlawedFictions supplies no canon and asks
for inference from cold text. **They are different tasks.**

## What this means for the v1 gate

DESIGN.md §11 set the v1 gate as *"Published benchmark scores beat the batch tools."*
That gate is **not reachable by Tier 0 plus Tier 1 bootstrap, at any level of polish.**

Beating FlawedFictions requires reasoning over the story itself — Tier 2, a frontier
model reading the whole text. Which is precisely what the batch competitors already do,
and precisely what §4's own evidence says works poorly: state-of-the-art models
"struggle regardless of the reasoning effort allowed."

So the gate as written asks us to win at the game we argued is the wrong game. It needs
rewriting, not passing. See the correction in §11.

## What the run was actually worth

Running it found two real bugs that the internal harness could not have.

**`name-variant` treated case as a misspelling.** A bible entry of `father` made every
sentence-initial `"Father"` look like a one-letter typo. This fired on a *clean* story —
a false positive, the one number §12 says matters. Fixed: any candidate differing from a
known name only by capitalisation is the same name.

**Bootstrap accepted role nouns as character names.** Given a story whose characters are
never named, the model returned `father` and `daughter`. A bible containing those is
worse than an empty one, because Tier 0 then matches them against ordinary prose. Fixed:
character names must be capitalised.

Both have regression tests. Before the fixes the run scored 46.7% — *below* chance,
because of that false positive. After, it scores exactly chance, and bootstrap proposes
2.0 characters per story instead of 3.9, because it stopped inventing two.

That is the value here. An external benchmark on unfamiliar text found failures that
594 self-injected errors on our own fixture did not.

## Reproducing

```bash
node benchmarks/dist/run-ff.js --limit 30 --seed 3 --out benchmarks/results/ff.json
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--limit` | 40 | Stories to evaluate. Each costs a Tier 1 bootstrap (~20s). |
| `--seed` | 1 | Reproduces a sample exactly. |
| `--long` | off | Use the 1,200–4,000 word split instead. |
| `--model` | `gemma3:4b` | Local model for bootstrap. |
| `--out` | — | Write per-story results as JSON. |

The full 414 stories take roughly 2.5 hours. Samples are balanced across labels, because
accuracy on an unbalanced sample is meaningless: a system that always answers "clean"
scores 70% on a 70/30 split having learned nothing.

The corpus is cached to `benchmarks/corpus/` and never committed. It is not ours to
redistribute, and vendoring a benchmark into the repository it measures is how a
benchmark quietly stops measuring anything.

## One caveat on method

The bootstrapped bible is treated as **canon** for the run. In the product it is a
proposal the writer reviews (§6). Treating it as canon simulates a writer who accepted
every line unread — the worst case, and the right one to measure, because it is where
false positives come from.
