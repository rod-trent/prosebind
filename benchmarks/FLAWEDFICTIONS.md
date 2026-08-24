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

**The full benchmark**, 413 of 414 stories (one timed out repeatedly), grok-4.6 at
chapter scope, 6.7 hours of compute:

```
                 predicted flawed   predicted clean
  actually flawed        135                71
  actually clean          12               195

  accuracy 79.9%   precision 91.8%   recall 65.5%   F1 0.765
```

Accuracy carries ±3.9 points at 95% confidence. This is a measurement, not a signal.

### The small samples were optimistic

Worth recording, because it is the more useful lesson:

| | accuracy | precision | recall | F1 |
| --- | --- | --- | --- | --- |
| n = 20 | 85.0% | 100.0% | 70.0% | 0.824 |
| **n = 413** | **79.9%** | **91.8%** | **65.5%** | **0.765** |

Every figure moved the wrong way, and precision moved most: 100% at n=20 became 91.8%
at full scale. Twelve false positives existed the whole time; twenty stories simply
could not see them. The ±16-point caveat on the small run was not boilerplate.

### The false positives are not all false

Twelve of 207 clean stories drew a finding. Several look like genuine inconsistencies in
the unmodified source — these are 19th-century Gutenberg texts, many of them
translations:

> *"The name here is Ha Yun; the passage has already named him Ha Yon."*

> *"The same Mecca visits are first described as daily and then as only every Friday."*

FlawedFictions labels a story clean when no error was **injected**, not when none
exists. So true precision is probably somewhat above 91.8% — but that is a claim we have
not verified story by story, and the reported number stays as measured.

Others are genre misreadings. One flagged a tree described as a pine after the passage
had it turn into a two-headed serpent, which is a folk-tale transformation rather than a
contradiction.

### Recall is the real weakness, and one attempt to fix it failed

It misses roughly a third of injected errors.

Reading the 71 misses suggested a cause: they were longer stories, and the errors needed
inference rather than flat factual restatement — a coal-black horse later described
otherwise, a merchant's established urgency contradicted by later ease. The model looked
like it was searching for the wrong *shape*. So a second lens (`continuityLensV2`) named
the kinds of contradiction worth checking, using ConStory-Bench's taxonomy rather than
the misses themselves.

A controlled 60-story comparison — same stories, same model, only the prompt differing —
reported **recall +16.7 points**, precision −4.7, F1 +0.078. It looked like a clear win.

It was not. Paired across all 407 stories both versions covered:

| | accuracy | precision | recall | F1 |
| --- | --- | --- | --- | --- |
| **v1** | **80.3%** | **91.7%** | 66.2% | **0.769** |
| v2 | 77.9% | 85.4% | 66.7% | 0.749 |

On the 201 flawed stories, v2 caught 10 that v1 missed and missed 9 that v1 caught.
**Net +1 out of 201** — noise — for 6.3 points of precision. McNemar on overall
correctness gives p = 0.123: v2 is not significantly different, and is directionally
worse.

v1 is the default. v2 stays exported so the negative result is reproducible.

**The lesson is about the n=60 test, not the prompt.** The design was right — paired
stories remove selection confounding — but paired design does not remove *sampling*
noise, and 30 positives cannot resolve a 5-story difference. The +16.7 came from 25/30
against 20/30. No significance test was run, and the result was reported as a win.

That is the second time in this project a small sample pointed the wrong way. The first
cost nothing because the full run followed. This one produced a claim that had to be
retracted.

### What would actually move recall

Untested, in rough order of expected value:

- **Two-pass self-consistency.** Run the lens twice and union the findings. Roughly
  doubles cost; recall gains from union are usually real but precision falls.
- **A different or larger model.** Only one was tested. FlawedFictions' own finding is
  that SOTA models struggle here regardless of reasoning effort, so the ceiling may be
  low for all of them.
- **Accepting the ceiling.** A third of injected errors may simply be beyond a single
  cold read, which is what the paper reports and what this run is consistent with.

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

- **58 seconds and one API call per chapter.** The full run took 6.7 hours of compute.
  This is background work at a session boundary, not something that runs as you type.
- **The anchor gate fired three times** across 413 stories — findings whose quote could
  not be located in the passage, discarded rather than reported. A 0.7% hallucinated-
  citation rate, and three findings that would otherwise have sent a writer hunting for
  a line that does not exist.
- **One story is missing.** `flawed_fictions_320` timed out on every attempt. It is
  excluded rather than counted as a miss.
- **This is one model and one lens.** Nothing here says how a different frontier model
  would score, and the numbers should not be quoted as though it did.

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
