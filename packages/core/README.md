# @prosebind/core

**License: AGPL-3.0-or-later**

The engine. Everything here must work with no network access and no model calls.

| Module | Responsibility |
| --- | --- |
| `segment/` | Split a manuscript into scenes and paragraphs; content-hash each so we can tell what actually changed. |
| `anchor/` | Content-addressed fuzzy anchors: quote + prefix/suffix context + approximate offset, re-resolved on drift. **Build this first — everything downstream depends on it.** |
| `graph/` | Entities, facts, events, relations. Every fact carries provenance and a `canon \| inferred` tier. |
| `checks/` | Tier 0 deterministic rules. No model calls in this directory, ever. |

## The rule for `checks/`

A Tier 0 check is deterministic, explainable, and fast enough to run on every keystroke pause.
If a check needs a language model it does not belong here — it belongs in Tier 1 or Tier 2,
which live in `@prosebind/daemon`.

Precision beats recall. A check that fires wrongly is worse than a check that does not exist.
See `DESIGN.md` § 12: false positives are the product risk.
