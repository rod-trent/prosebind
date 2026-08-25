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

---

# Amendment: settling the second pass

**Written and committed before this run. No data from it has been seen.**

The first registration left one question open: the second pass added +5.6 recall points
over temperature alone, but at p = 0.22 on 72 positives — underpowered, not disproven.
This resolves it at the largest sample the benchmark permits.

## Hypothesis

Two sampled passes, unioned, detect more flawed stories than one sampled pass, at equal
temperature.

## Sample — and its ceiling

**Every story in FlawedFictions: 207 flawed, 207 clean.** Both arms run on the full set.

That is 2.9× the positives of the first test, and it is the **maximum this benchmark can
supply**. Scaling the observed discordance (5 vs 1 on 72 positives) to 207 predicts
roughly 14 vs 3, giving χ² ≈ 5.9, p ≈ 0.015 — significant *if the effect is real at the
rate observed*.

This matters for how a null is read. If the difference is still not significant at 207
positives, the honest conclusion is **"any effect is smaller than this benchmark can
resolve"** — not "collect more data." There is no more data. That conclusion will be
recorded as the answer, not as a reason to keep testing.

Both arms extend existing runs by resume, so the 148 and 147 stories already completed
are reused rather than repeated.

## Primary

McNemar on the flawed stories both arms cover, paired, two-sided, **α = 0.05**:
1-pass @ T=0.7 against 2-pass @ T=0.7. Same lens, same scope, same model, same
temperature — pass count is the only variable.

## Decision rule

- **Significant in favour of two-pass** → adopt it as the Tier 2 default, and record the
  2× cost as the price of the recall.
- **Not significant** → the second pass is not adopted, permanently, on this evidence.
  Record the effect as below the benchmark's resolution and stop asking.

Precision and F1 are reported but are **not** decision criteria this time; the question
is specifically whether the second pass finds more. No metric will be substituted after
the fact.

## Registered

2026-08-25, before execution.

---

# Amendment result: the second pass is real, and the temperature result was not

Run 2026-08-25 over all 414 stories. Analysed with `benchmarks/src/mcnemar.ts`, which
implements exactly the test named above and nothing else.

## Primary — significant

Paired on 408 stories common to both arms; 204 flawed.

| arm | calls | accuracy | precision | recall | F1 |
| --- | --- | --- | --- | --- | --- |
| 1-pass T=0.7 | 1x | 78.9% | 91.5% | 63.7% | 0.751 |
| **2-pass T=0.7** | 2x | 80.4% | 87.8% | **70.6%** | 0.783 |

Two-pass caught **17** flawed stories the single pass missed and lost **3**.
chi2 = 8.45, **p = 0.0037**; exact binomial p = 0.0026.

By the registered rule: **adopt.** The 2x cost is the price of the recall, recorded here
and in `AnalyzerOptions.passes`.

## The unregistered thing the same run exposed

The full set also re-measured 1-pass at T=0.7 against the T=0 baseline — the contrast
that motivated adopting temperature 0.7 in the first place. **It did not replicate.**

| contrast | caught | lost | p | verdict |
| --- | --- | --- | --- | --- |
| T=0.7 vs T=0, one pass | 8 | 13 | 0.383 | not significant, point estimate negative |
| 2-pass vs 1-pass, both T=0.7 | 17 | 3 | **0.0037** | significant |
| 2-pass T=0.7 vs the shipped 1-pass T=0 | 17 | 8 | 0.110 | not significant |

The "+5.6 recall points, free" claim from commit `cc3a7e7` is **retracted**. It came from
146 stories with no significance test applied to that particular contrast — the same
error as the retracted v2 claim, committed inside the very document written to prevent
it. Pre-registering the primary did not protect the secondary comparison reported
alongside it.

Temperature stays at 0.7 for a different and smaller reason: two passes at temperature 0
are the same pass twice, so sampling diversity is a **precondition** of the thing that
did replicate, not a win of its own. The Analyzer now collapses to a single call at
temperature 0 rather than billing for a duplicate.

## What this actually buys, stated plainly

Against the configuration that shipped before this experiment — one pass at temperature 0
— the adopted default gains **+4.4 recall points at p = 0.11**, loses 4.0 points of
precision, and costs twice as much.

The registered primary is real: a second sample finds things the first missed. The
end-to-end upgrade is not proven. Both are true, and the registration deliberately fixed
the primary in advance so that this ambiguity could not be settled by picking whichever
framing looked better after the fact. Adoption follows the rule as written.

This is the benchmark's ceiling. 204 positives is all FlawedFictions has, and the
registration already committed to reading that as **"the effect is below this
benchmark's resolution"** rather than as a reason to keep testing. Recorded, closed.

## Exploratory, not adopted

Both single-pass arms were already recorded per story, so the union of T=0 and T=0.7 —
cost-identical to two passes — was free to evaluate:

| arm | calls | precision | recall | F1 |
| --- | --- | --- | --- | --- |
| 2-pass T=0.7 | 2x | 87.8% | 70.6% | 0.783 |
| union(T=0, T=0.7) | 2x | 90.5% | 70.1% | 0.790 |

The two are statistically indistinguishable — 9 caught against 10, p = 1.00. The
precision and F1 edge is noise. Recorded so nobody re-runs it, and **not** adopted.

## What the process was worth, again

The first registration caught a bad claim in its primary. This one caught a bad claim in
its own prior result. The number that survives is smaller than the one before it, and
that has now happened three times running on this benchmark.

## Reproducing

```
node --env-file=.env.local benchmarks/dist/run-ff-t2.js --all --lens v1 --passes 1 \
  --temperature 0.7 --concurrency 6 --out benchmarks/results/ff-onepass-t07-150.json
node --env-file=.env.local benchmarks/dist/run-ff-t2.js --all --lens v1 --passes 2 \
  --temperature 0.7 --concurrency 6 --out benchmarks/results/ff-twopass-150.json
node benchmarks/dist/mcnemar.js \
  "1-pass T=0 (baseline)"  benchmarks/results/ff-tier2-full.json \
  "2-pass T=0.7"           benchmarks/results/ff-twopass-150.json \
  "1-pass T=0.7"           benchmarks/results/ff-onepass-t07-150.json
```

`mcnemar.js` pairs on the intersection of every arm, so an arm that resumed further than
another cannot be judged on stories the others never saw.
