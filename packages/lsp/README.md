# @prosebind/lsp

**License: AGPL-3.0-or-later.**

> Not Apache-2.0, despite what DESIGN.md § 13 originally said. This package imports
> `@prosebind/core`, so the combined work carries the engine's licence and a permissive
> manifest here would misrepresent it. The permissive half of the split is
> `@prosebind/spec` and the editor clients — the parts that speak the protocol without
> linking the engine.

A language server for narrative continuity. Zero runtime dependencies: the JSON-RPC
framing is [200 lines](src/jsonrpc.ts), because Prosebind has to ship as one binary to
people who do not have a toolchain.

## The mapping

DESIGN.md § 5 promised this table. It is now real:

| LSP | Narrative meaning |
| --- | --- |
| `publishDiagnostics` | Continuity violations, with severity and confidence |
| `hover` | Entity card — canon vs inferred facts, mention count, birth/death events |
| `definition` | Jump to where this character first appears |
| `references` | Every mention across the project, not just this file |
| `documentSymbol` | Chapters and scenes, with word counts |
| `workspace/symbol` | The bible, browsable — characters and timeline events |
| `codeAction` | Mark as intentional · Silence this check |

## Two rules it enforces

**Nothing is ever an `Error`.** Prose is not a failing build and a manuscript is not
broken code. Contradictions map to `Warning`, questions to `Information`, notes to
`Hint`. There is a test asserting no diagnostic can ever reach `Error`.

**Nothing is published while you type.** Every change resets a debounce timer
(default 900ms). Saving flushes it immediately, because a save is a pause and § 10 says
a pause is when the tool may speak.

## Editor setup

The server is started by your editor over stdio. It needs a project containing a
`.prosebind` directory — run `prosebind init` first.

### Neovim

```lua
vim.lsp.config.prosebind = {
  cmd = { 'prosebind-lsp' },
  filetypes = { 'markdown', 'text' },
  root_markers = { '.prosebind' },
  init_options = { debounceMs = 900, severityFloor = 'note' },
}
vim.lsp.enable('prosebind')
```

### Helix

```toml
# languages.toml
[language-server.prosebind]
command = "prosebind-lsp"

[[language]]
name = "markdown"
language-servers = ["prosebind"]
```

### Zed

```json
// settings.json
{
  "lsp": {
    "prosebind": {
      "binary": { "path": "prosebind-lsp" },
      "initialization_options": { "debounceMs": 900 }
    }
  }
}
```

### VS Code

Needs a thin extension to launch it; `clients/vscode` is not written yet. Until then
any generic LSP-client extension pointed at `prosebind-lsp` works.

## Settings

Passed as `initializationOptions`, or later via `workspace/didChangeConfiguration`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `debounceMs` | `900` | Quiet period after the last keystroke before analysing |
| `severityFloor` | `note` | Lowest severity shown inline: `contradiction`, `question`, or `note` |

Set `severityFloor` to `contradiction` if you only want hard errors while drafting.

## Testing it by hand

```bash
npm run build && node packages/lsp/dist/cli.js --help
```

The integration suite drives the real server over a real framed connection — see
[`server.test.ts`](src/server.test.ts). The framing layer is tested separately at
[every possible chunk boundary](src/jsonrpc.test.ts), because a bug there presents as
an editor mysteriously disconnecting, which nobody enjoys debugging through a client.

## Not done

- `prosebind.promoteToCanon` is stubbed. Writing to a writer's bible on their behalf
  needs a confirmation flow, and a half-built one that silently edits their canon is
  worse than an honest gap.
- Incremental text sync. We advertise `Full`, which removes a class of desync bug; the
  incrementality that matters is in the analysis, not the transport.
