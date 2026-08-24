# @prosebind/spec

**License: Apache-2.0** — deliberately permissive. The format is meant to be adopted,
re-implemented, and embedded by anyone, including commercially.

Two things are specified here:

- `schema/` — the on-disk continuity bible. Plain YAML and Markdown, human-editable,
  diffable, committed to the writer's own repository.
- `protocol/` — the wire contract shared by the LSP and MCP servers: diagnostics,
  entity cards, canon promotion, intent suppression.

## Stability

Nothing here is stable before `v1`. Once it is, breaking changes require a version bump
and a migration path — writers will have years of accumulated canon in this format.
