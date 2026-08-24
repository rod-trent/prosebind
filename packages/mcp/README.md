# @prosebind/mcp

**License: AGPL-3.0-or-later.** This package embeds `@prosebind/core`, so the combined
work carries the engine's licence. See [NOTICE](../../NOTICE).

The continuity graph, exposed over the Model Context Protocol — DESIGN.md § 5's second
front door. The same engine the language server drives, addressed conversationally
instead of through an editor.

Zero runtime dependencies beyond the workspace: MCP is JSON-RPC over stdio, so the
transport in `@prosebind/spec` carries it unchanged.

## Setup

```bash
claude mcp add prosebind -- prosebind-mcp /path/to/your/manuscript
```

Point it at a directory containing a `.prosebind` bible. Any MCP client works; the
server speaks stdio and nothing else.

## Tools

| Tool | Answers |
| --- | --- |
| `list_findings` | Open contradictions, questions and notes, with evidence and confidence |
| `list_entities` | Everyone and everything in the bible |
| `describe_entity` | One character's canon facts, inferred facts, appearances, birth and death |
| `find_mentions` | Every place someone appears, with file, line and scene |
| `timeline` | Declared events, in order, and how each is pinned to the prose |
| `outline` | Chapters and scenes with word counts |
| `established_before` | What has happened, and who the reader has met, by a given point |
| `recheck` | Re-read from disk and re-run every check |

## Two guarantees

**Every tool is read-only.** An agent may read a writer's canon. It may not edit their
manuscript, and it may not suppress a finding on their behalf — deciding that an
inconsistency is deliberate is a judgement about the writer's own intent, and stays
theirs. There is a test asserting no tool name implies mutation.

**Facts carry their tier.** `canon` was pinned by the writer and is authoritative;
`inferred` was extracted from the prose and may be wrong. Every fact is labelled, and
the server's `instructions` tell the model to say which it is relying on. A model that
presents an inference as established is the failure mode this design exists to prevent.

The `instructions` block sent on connect also states that Prosebind never writes prose —
it is the only place that promise can be made before a model starts working.

## What it deliberately will not claim

DESIGN.md § 5 uses "what does Marcus know as of chapter 12?" as the motivating example.
That needs epistemic state tracking, which is v1.5 and **not implemented**.

`established_before` answers the part that is real today — which events have happened
and which characters the reader has met by a given point — and says plainly in its own
output that per-character knowledge is not tracked. An honest gap beats a confident
answer to a question the engine cannot yet answer.

## Testing

```bash
npm run build && node --test "packages/mcp/dist/**/*.test.js"
```

The suite drives the real server over a real framed connection, including protocol
version negotiation and that resource reads cannot escape the bible directory — a
traversal there would hand an agent arbitrary files from the writer's machine.
