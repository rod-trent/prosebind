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

**Tier 0 scores exactly chance. It detects nothing.** Tier 2 scores F1 0.824 on the
same benchmark — see below. The rest of this section explains why Tier 0 cannot, because
that reason is architectural and worth understanding before reading the Tier 2 numbers.

## Tier 2 changes the answer

Once Tier 2 existed, the same benchmark became winnable. The passage-contradiction lens
reads each chapter cold, with no bible and no oracle, and every finding still has to
quote the passage and survive re-anchoring.

20 stories, balanced, seed 11, grok-4.6:

```
                 predicted flawed   predicted clean
  actually flawed          7                 3
  actually clean           0                10

  accuracy 85.0%   precision 100.0%   recall 70.0%   F1 0.824
```

**Zero false positives** — the number § 12 says matters — across both 20-story runs.
Recall of 70% means it misses three flawed stories in ten.

### Scope turned out to matter more than anything else

The same 20 stories, the same model, the same seed. Only the passage size changed:

| scope | accuracy | precision | recall | F1 |
| --- | --- | --- | --- | --- |
| scene | 70.0% | 100% | 40% | 0.571 |
| **chapter** | **85.0%** | **100%** | **70%** | **0.824** |

Recall nearly doubled. A contradiction whose halves sit in different scenes is invisible
to a lens that only ever sees one of them — so the passage has to be large enough to
contain both ends of the thing it is looking for. Chapter is now the default. This is
still well inside § 7: chapter-scoped, never whole-manuscript.

The finding surfaced by accident. An earlier run analysed scenes *and* chapters, which
duplicated every finding; fixing the duplication narrowed the window and dropped recall
from 100% to 40%, which is what prompted the controlled comparison.

### What it actually caught

Four of five true positives in the first sample matched the planted error exactly — the
ornamented drinking-horn later called a plain wooden cup, shelves described as
worm-eaten and then well-maintained. One was right for a *different* reason: it found a
genuine contradiction about who escaped a fire rather than the planted sword-for-spear
swap. Correct label, different error.

### Caveats that matter

- **n = 20.** At that size 85% carries roughly ±16 points at 95% confidence. It is a
  signal, not a measurement.
- **53 seconds and one API call per chapter.** This is background work, not interactive.
- **The anchor gate never fired.** Zero findings were dropped across every run — grok-4.6
  quoted faithfully every time. The gate is untested against a model that does not.

---

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
It is **not reachable by Tier 0 plus Tier 1 bootstrap, at any level of polish** — for the
architectural reason above. It *is* reachable by Tier 2, which is the honest shape of the
answer: this benchmark asks for inference from cold text, and only the tier built for
judgment can supply it.

That leaves §4's argument intact rather than undermined. §4 says long context degrades on
this task, and the fix is to keep the passage small enough to reason over. The scope
experiment is direct evidence for exactly that: chapter-scoped analysis beat scene-scoped
because the passage must *contain* both halves of the contradiction, and neither run
passed the whole book to the model. A batch tool handing 90,000 words to one call is
doing something different from a chapter-at-a-time lens, and the difference is the point.

What the tiers are actually for, stated plainly:

| | Tier 0 | Tier 2 |
| --- | --- | --- |
| Needs | A bible the writer wrote | Nothing |
| Proves | Contradiction against declared canon | Nothing — it asks |
| FlawedFictions | F1 0.000 | F1 0.824 |
| Cost | Free, milliseconds | ~53s and an API call per chapter |
| Runs | Every pause | Session boundaries, opt-in |

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
