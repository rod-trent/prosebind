# @prosebind/daemon

**License: AGPL-3.0-or-later**

Watches files, decides what is dirty, and drives the tiers.

- **Tier 0** — delegated to `@prosebind/core`. Deterministic, no model.
- **Tier 1** — small local model, per dirty scene. Claim extraction, entity linking, coreference.
- **Tier 2** — frontier model, debounced, scene- or chapter-scoped. Never whole-manuscript.

The model layer is provider-agnostic from the first commit, and the local path must remain
fully functional with no cloud provider configured. Any call that crosses the network is
surfaced to the writer explicitly.
