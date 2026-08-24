# Benchmarks

```bash
npm run bench
```

Two experiments, and one honest disclaimer about both.

## What runs

**Detection.** Inject errors of known type and location into a clean corpus, then check
whether Tier 0 finds them and whether it invents anything on the way. The principle is
[FlawedFictionsMaker's](https://arxiv.org/abs/2504.11900) — synthesise errors into prose
so ground truth is known without hand-labelling — narrowed to the error classes a
deterministic rule engine claims to detect.

**False positives.** Run against prose with no known errors, where every finding is by
definition a mistake. DESIGN.md §12 says this is the number that matters: *"False
positives are the product risk. Ten wrong flags and the tool is uninstalled."*

Current results, on `fixtures/quarry-clean`:

```
DETECTION       594 injected · 594 caught · 0 missed · 0 invented
                precision 100.0%   recall 100.0%   F1 1.000

FALSE POSITIVES 577 words · 0 findings · 0.000 per 10k
                95% bound < 52.0 per 10k
```

## Why a perfect score is weak evidence

The errors were injected by the same project that wrote the checks, in exactly the
classes those checks target, into a corpus of a few hundred words. **This is a
regression harness — it tells you when a check breaks — not a measure of how good the
engine is.**

The false-positive figure is worse than it looks, too. Zero findings in 577 words does
not establish a zero rate; the rule of three puts the 95% bound at **52 per 10,000
words**, which is close to useless. Narrowing that needs more clean prose, not better
checks. Growing the control corpus is the single highest-value contribution to this
directory.

None of these numbers are comparable to FlawedFictions or ConStory-Bench, and must
never be quoted as though they were.

## FlawedFictions

It is run now — see [FLAWEDFICTIONS.md](FLAWEDFICTIONS.md). Prosebind scores exactly
chance (F1 0.000), for architectural reasons documented there. What follows was written
before that run and explains why it was expected.

### The original reasoning

DESIGN.md §12 says to win the benchmarks that exist rather than build one. Before Tier 1
existed, running FlawedFictions was not possible at all:

FlawedFictions and ConStory-Bench supply human-written stories with synthetic errors and
**no continuity bible**. Tier 0 is deterministic: it checks prose against entities the
writer declared. With no declared entities, no mentions are detected and no check fires.
Scoring near zero there would be a category error, not a finding — it would measure the
absence of a bible, not the quality of the engine.

Those benchmarks become meaningful the moment Tier 1 extraction can build a bible from
prose (DESIGN.md §7). That is the real v1 gate, and this harness is the scaffolding it
will run on: the `score` module is agnostic about where findings come from.

## Corpora

`fixtures/quarry-clean` is a control: 577 words of past-tense, third-limited prose with a
matching bible, containing no continuity error. A test asserts it produces zero findings,
because every precision figure the harness reports depends on that staying true.

Downloaded datasets are never committed — see the repository `.gitignore`.

## Options

```bash
node benchmarks/dist/run.js --project <dir> --trials 40 --errors 6 --seed 99 --json
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--project` | `fixtures/quarry-clean` | Corpus to inject into. **Must start with zero findings** — the runner refuses otherwise. |
| `--clean` | `fixtures/quarry-clean` | Corpus for the false-positive experiment. |
| `--trials` | 20 | Independent runs, each with its own seed. |
| `--errors` | 3 | Errors injected per document per trial. |
| `--seed` | 1 | Reproduces a run exactly. |
| `--json` | off | Machine-readable output. |

The run exits non-zero if anything was invented, so CI notices a precision regression.

## Two bugs this harness found in its own first run

Worth recording, because both produced plausible-looking numbers rather than crashes.

**Insertions landed mid-paragraph.** The label pointed at one line and the finding
appeared at another, so `deceased-active` reported *0 caught, 10 invented* — a check
that looked broken and was working perfectly.

**Baseline subtraction silently discarded real detections.** Several checks emit a
message with no location in it, so a newly injected `pov-drift` was indistinguishable
from a pre-existing one and got filtered out as "already there". The fix was
methodological rather than a better identity key: run detection only on a corpus that
starts clean, and have the runner refuse anything else.
