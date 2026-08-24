# Contributing to Prosebind

Prosebind is pre-implementation. The most valuable contribution right now is argument:
read [DESIGN.md](DESIGN.md) and tell us where it is wrong.

## Non-negotiables

These are settled and PRs against them will be declined:

1. **No prose generation.** Not as an option, not behind a flag. See DESIGN.md § 10.
2. **No model calls in `packages/core/checks/`.** Tier 0 is deterministic by definition.
3. **The bible stays plain text.** No binary or proprietary storage for writer-owned canon.
4. **Precision over recall.** A PR adding a check must show its false-positive behaviour.

## Adding a Tier 0 check

A check earns its place by being deterministic, explainable, and quiet. Include:

- the rule, stated plainly enough for a novelist to read in a diagnostic message
- a fixture that triggers it
- **a fixture that looks like it should trigger it and must not** — this is the important one
- a note on how a writer legitimately doing the "wrong" thing on purpose can suppress it

Unreliable narrators, characters who lie, and withheld information are normal fiction, not bugs.
Any check that cannot be deliberately overridden is not finished.

## Commit and PR conventions

Keep commits scoped. Reference the DESIGN.md section a change implements (`§ 6`, `§ 7`) so the
document and the code stay in step. If a change contradicts DESIGN.md, update DESIGN.md in the
same PR and say why.

## Licensing of contributions

Contributions to `packages/core` and `packages/daemon` are AGPL-3.0-or-later. Contributions to
`packages/spec`, `packages/lsp`, `packages/mcp` and `clients/` are Apache-2.0. By opening a PR
you agree your contribution ships under the license of the directory it touches.
