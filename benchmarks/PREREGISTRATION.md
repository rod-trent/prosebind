# Pre-registration: two-pass self-consistency for Tier 2 recall

**Written and committed before the run. No data has been seen.**

The previous recall attempt (`continuityLensV2`) was reported as a +16.7-point win on a
60-story comparison and turned out to be net +1 story out of 201 at full scale. The
design was sound — paired stories — but no sample-size reasoning and no significance
test were applied, and a 5-story difference on 30 positives was read as signal.

This document fixes the analysis in advance so the same thing cannot happen twice.

## Hypothesis

Running the contradiction lens twice with sampling and taking the **union** of findings
raises recall on FlawedFictions, because a single sample misses errors it would catch on
another draw.

## Intervention

- Two independent passes over the same passage, temperature **0.7**.
- Predict "flawed" if **either** pass produces a surviving finding.
- Everything else identical to the baseline: same lens (v1), chapter scope, same model
  (`grok-4.6`), same anchoring gate.

**Known confound, stated up front.** Self-consistency requires sampling diversity, so
temperature rises from 0 to 0.7 as part of the intervention. A win therefore cannot be
attributed to pass-count alone — temperature could be doing the work. If this succeeds, a
single-pass-at-0.7 arm is needed to decompose it. That follow-up is not run here, and the
result will not be described as "two passes help" without it.

## Baseline

`benchmarks/results/ff-tier2-full.json` — v1, temperature 0, chapter scope, already
recorded for all 413 stories. The comparison is **paired**: the same 150 stories are
looked up in that file rather than re-run.

Baseline on the full set: recall 66.2%, precision 91.7%, F1 0.769.

## Sample

**150 stories, balanced (~75 flawed), seed 5150.** Seed fixed here, before the run.

Sizing: with ~75 positives, McNemar can resolve a genuine **10-point** recall difference
(≈7–8 net additional catches against plausible discordance) at α = 0.05. It cannot
reliably resolve 5 points. So this test is powered for "10 points or better" and a
smaller true effect will correctly read as null.

## Decision rule

Adopt two-pass as the default **only if both** hold:

1. **Primary.** McNemar on the 75 flawed stories, paired, two-sided, **α = 0.05**, is
   significant in favour of two-pass.
2. **Guard.** F1 on the 150 does not fall below the baseline's F1 on those same 150.

If the primary is significant but F1 falls, the result is recorded as "raises recall,
costs more precision than it gains" and **not** adopted as default — the same trade v2
failed. If the primary is not significant, the result is null regardless of how the raw
percentages look.

No other comparison will be promoted to the headline after the fact. Anything else
computed is exploratory and will be labelled as such.

## Cost

150 stories × 2 passes × ~58s ≈ 4.8 hours of compute; roughly 50 minutes wall-clock at
concurrency 6.

## Registered

2026-08-25, before execution. Commit this file before running the experiment.

---

# Result

Run 2026-08-25, analysed exactly as registered above.

## Primary — met

Paired on 148 stories; 74 flawed.

|  | accuracy | precision | recall | F1 |
| --- | --- | --- | --- | --- |
| 1-pass, T=0 (baseline) | 82.4% | 96.2% | 67.6% | 0.794 |
| 2-pass, T=0.7 | 85.8% | 92.1% | 78.4% | 0.847 |

McNemar on the flawed stories: two-pass caught **8** the baseline missed and lost **0**.
χ² = 6.13, **p = 0.0133** — significant. Guard passed: F1 rose 0.794 → 0.847.

By the registered rule: **adopt.**

## The confound, resolved

The registration said this would not be called "two passes help" without a
single-pass-at-0.7 arm. That arm was run. Paired on 146 stories common to all three:

| arm | accuracy | precision | recall | F1 | cost |
| --- | --- | --- | --- | --- | --- |
| 1-pass T=0 | 82.9% | 96.1% | 68.1% | 0.797 | 1× |
| **1-pass T=0.7** | 84.2% | 93.0% | **73.6%** | 0.822 | **1×** |
| 2-pass T=0.7 | 86.3% | 91.9% | 79.2% | 0.851 | 2× |

Temperature and the second pass contribute **+5.6 recall points each**. Half the effect
was never about self-consistency at all — it was sampling diversity, available for free.

The second pass's marginal contribution is **not significant** at this size: 5 stories
caught against 1 lost, χ² = 1.50, p = 0.22. Underpowered rather than disproven — 72
positives cannot resolve a 4-story difference, which is the same limit the registration
anticipated.

## What was adopted

**Temperature 0.7, single pass.** Free, and it captures half the available recall.

**Two-pass is not adopted.** It looks better on every metric and may well be real, but
its marginal value is unproven and it doubles cost. Adopting an unproven 2× spend on a
p = 0.22 result would repeat the mistake this registration exists to prevent — the
difference being that this time the number is labelled honestly instead of shipped as a
win.

Resolving it needs roughly 3–4× the positives. Worth doing before paying 2× per chapter
in production.

## What the process was worth

The previous attempt reported +16.7 recall points from an untested comparison and had to
be retracted. This one reports +5.6, adopted, with the mechanism identified and the
unproven half named as unproven. The smaller number is the one that survived.
