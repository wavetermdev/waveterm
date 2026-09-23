# Spec: wsh Agent API — "Agent Control Fabric"

**Date:** 2026-08-16
**Status:** Implemented — v1 (phases 1–6) landed on `feat/agent-control-fabric`; v2 design-review items landed separately (see [[agent-control-fabric-v2.md]])
**Alias:** this feature is also referred to as the "agent control fabric"

## Problem

AI coding agents (pi, Claude Code, Cursor, etc.) running inside Wave Terminal terminals have no awareness of the Wave Terminal application itself. They can execute shell commands and edit files, but cannot:

- See what other blocks/connections exist
- Open new terminals on different connections
- Read terminal output from other blocks
- Understand the spatial layout of blocks ("the terminal on the right")
- Reorganize layout or manage connections
- Ask the user a question and get an answer

This limits agents to operating within a single terminal context. With Wave Terminal as an orchestration surface, agents can coordinate across connections, manage the workspace, spawn subagents, observe them, and escalate to the user when needed.

## Scope Guardrail

**Include:** Anything a human could do via the UI or keyboard.
**Exclude:** Streaming event subscriptions, programmatic UI rendering, anything beyond human capability.

## Design Principles

1. **wsh-first** — All agent capabilities exposed via `wsh` commands. Works locally and remotely (routed through connserver).
2. **JSON output** — `--json` flag on all read commands for machine parsing.
3. **tmux-transferable naming** — Agents are trained on tmux, not on wsh. Use tmux's verb vocabulary (`capture`, `send-keys`, `split`, `select`, `kill`, `rename`, `resize`) so agents pattern-match immediately. Provide top-level tmux aliases for zero-cost transfer.
4. **Idempotent** — Commands are safe to retry (important for agents dealing with flaky networks).
5. **No new auth surface** — Agent runs as the same user; inherits existing permissions. No API keys or tokens.
6. **Human-like addressing** — Blocks are addressed the way a user thinks about them: by number, by title, by view type, by direction — not just by opaque UUID.

## The Two Execution Modes

This is the core mental model. Agents need two distinct ways to run work:

### Mode A — synchronous execution (the 90% case)

`wsh run --wait --json -- <cmd>` runs a command in a background block and returns **stdout + stderr + exit code + duration** when it completes. This is what an agent uses to answer "run `npm test` and tell me if it passed."

Note: `wsh run` already exists but is **fire-and-forget** today — it creates a block and prints the block ref, without waiting or returning output/exit code. Adding `--wait`/`--json` is the single highest-leverage change in this spec.

### Mode B — asynchronous terminal control (the tmux-style 10% case)

For long-running or interactive processes (a subagent REPL, a server, `vim`), the agent uses tmux-style control: create a visible block, `send-keys` into it, `capture` its output, check `status`, `select`, `kill`. This is how an orchestration agent spawns a subagent in its own visible terminal and "watches what is going on."

## Naming & Addressing

### Noun mapping

| tmux | Wave Terminal |
|------|---------------|
| session | workspace |
| window | tab |
| pane | block |

### Verb vocabulary (canonical = grouped noun, aliases = tmux parity)

| tmux | canonical `wsh` | top-level alias |
|------|-----------------|-----------------|
| `capture-pane` | `wsh block capture` | `wsh capture-pane` |
| `send-keys` | `wsh block send-keys` | `wsh send-keys` |
| `split-window` | `wsh block split` | `wsh split-pane` |
| `select-pane` | `wsh block select` | `wsh select-pane` |
| `kill-pane` | `wsh block kill` | `wsh kill-pane` |
| `rename-pane` | `wsh block rename` | `wsh rename-pane` |
| `resize-pane` | `wsh block resize` (later) | `wsh resize-pane` |
| `list-panes` | `wsh block list` | `wsh list-panes` |

Aliases are thin wrappers delegating to the canonical form. Cheap to ship, high transfer value.

### Addressing forms (block reference)

The resolver (`pkg/wshrpc/wshserver/resolvers.go`) already supports most of these:

| Form | Meaning | Status |
|------|---------|--------|
| `this` / `block` | current block | exists |
| `3` | block number (1-indexed leaf order) | exists |
| `term:2` | 2nd terminal block in tab | exists |
| `tab:2` | 2nd tab in workspace | exists |
| `<uuid>` / `<uuid8>` / `block:<uuid>` | by id | exists |
| `"title substring"` | by title match | **new** |
| `--left-of/--right-of/--above/--below <block_ref>` | directional | **new** |

### Flag conventions

- Multi-word flags are hyphenated: `--last-command`, `--relative-to`, `--left-of` (not `--lastcommand`).
- Long forms over short aliases: `--output <file>` (not `-o`).
- Placeholders always say *what they are* — never a bare `<name>`: `<block_ref>`, `<conn_name>`, `<secret_label>`, `<tab_ref>`, `<view_type>`.
- A secret is always passed as `--secret <secret_label>`; the literal value never appears in the command.
- `--json` means machine-readable output on every read command.

## Geometry & Layout Model

The resolver knows block **order** (`LayoutState.LeafOrder`) but not **space**. A user says "the terminal on the right," and the agent has no data to map that to a block. Fix: expose **flat geometry** in `block list --json`.

```json
{
  "index": 3,
  "id": "block:uuid",
  "title": "prod-server: ~/project",
  "view": "term",
  "connection": "prod-server",
  "geometry": { "x": 0.5, "y": 0, "w": 0.5, "h": 1.0 },
  "focused": true,
  "magnified": false
}
```

- `x/y/w/h` are **fractions of the tab** (0..1), resolution-independent.
- An LLM answers "which is on the right" directly from `x >= 0.5`.
- The raw layout tree (`wsh tab layout --json`) is **deferred** — geometry answers the common question; the tree only answers "which block was B split from."
- Directional addressing (`--left-of` etc.) is computed server-side from geometry, more reliable than LLM arithmetic.

## Command Reference

### Read commands

#### `wsh block list`

```bash
wsh block list                          # human-readable table
wsh block list --json                   # JSON array, includes geometry + index
wsh block list --tab <tab_ref>          # filter by tab (tab:2, uuid, or title)
wsh block list --connection <conn_name> # filter by connection name
wsh block list --view <view_type>       # filter by view type: term, web, preview, sysinfo, waveconfig, help, vdom, sourcecontrol, ...
```

Full view-type list lives in `frontend/app/block/blockregistry.ts` (term, preview, web, cpuplot, sysinfo, vdom, tips, help, launcher, tsunami, waveconfig, processviewer, sourcecontrol).

#### `wsh block capture`  (replaces `wsh termscrollback`)

`termscrollback` is a bad name — it reads as "scroll the buffer back" rather than "capture from the buffer." Rename to `capture`, matching tmux `capture-pane`.

```bash
wsh block capture <block_ref>                 # all scrollback as text
wsh block capture <block_ref> --tail 50       # last N lines (≡ tmux capture-pane -p -S -50)
wsh block capture <block_ref> --last-command  # output of last command (shell integration)
wsh block capture <block_ref> --json          # structured: lines + TotalLines + LastUpdated
wsh block capture <block_ref> --output file.txt   # write to file instead of stdout
wsh block capture "claude"              # address by title substring
```

**Note:** the RPC `TermGetScrollbackLinesCommand` already returns `TotalLines` and `LastUpdated` — the current CLI discards both. `--json` must surface them. `--since <line|timestamp>` (incremental reads) is deferred but `LastUpdated` is the natural cursor for it.

#### `wsh block status`

Minimal per-block process state, so the orchestrator can tell if a subagent is alive without polling output.

```bash
wsh block status <block_ref> --json
```

```json
{ "processstate": "running" | "exited", "exitcode": 0, "connection": "prod-server", "connstatus": "connected" }
```

#### `wsh connection list`

```bash
wsh connection list --json              # new; today only `wsh conn status` (no JSON)
```

#### `wsh tab list` / `wsh workspace list`

Already exist with `--json` (tab) and JSON output (workspace). Keep as-is.

#### `wsh config get` / `wsh config list`

```bash
wsh config get "term:fontfamily" --json
wsh config list --json                  # keys + types + descriptions + reload-required
wsh config get --connection <conn_name> --json
```

`config list` matters because settings span `settings.json`/`presets.json`/`widgets.json`/`conns.json`, some are runtime-only, and many changes need a UI reload. The agent needs to know which keys exist and whether a change takes effect immediately.

### Write commands

#### `wsh run` (Mode A)

```bash
wsh run --wait --json -- npm test
wsh run --wait --json --connection prod -- ./deploy.sh
wsh run --wait --json --cwd /path -- ./build.sh
wsh run --wait --json --secret <secret_label> -- ./deploy.sh   # secret injected as env, never in args
```

`--wait` blocks until the command completes; `--json` returns stdout + stderr + exit code + duration. Without `--wait`, current fire-and-forget behavior is preserved.

#### `wsh block new` / `wsh block split`

Splits are already supported at the RPC layer (`TargetBlockId` + `TargetAction`: `splitright`/`splitdown`/`splitleft`/`splitup`/`replace`) but **not exposed** on the CLI (`wsh createblock` is hidden and only has `--magnified`). Surface them:

```bash
wsh block new --view term --connection prod
wsh block new --view term --connection prod --cmd "tail -f /var/log/syslog"
wsh block split <block_ref> --direction left|right|above|below
wsh block new --view term --split right --relative-to <block_ref>
wsh block new --view term --magnified --connection staging
wsh block new --view term --tab <tab_ref> --connection prod
```

`--direction` uses the same vocabulary as directional addressing (`--left-of/--right-of/--above/--below`): `left|right|above|below`. `wsh block split <block_ref> --direction <dir>` is sugar for `wsh block new --split <dir> --relative-to <block_ref>`.

Output: the created block ref (and its geometry when `--json`).

#### `wsh block send-keys`

```bash
wsh block send-keys <block_ref> "ls -la"
wsh block send-keys <block_ref> "ls -la" --enter      # append Enter
wsh block send-keys <block_ref> --escapes "\u001b[A"  # interpret \uXXXX / \n / \t escape sequences
wsh block send-keys <block_ref> --secret <secret_label> --enter   # type the VALUE of a stored secret
```

#### `wsh block select` / `wsh block kill` / `wsh block rename` / `wsh block magnify`

```bash
wsh block select <block_ref>                          # alias: focus
wsh block select --right-of <block_ref>               # directional
wsh block kill <block_ref>                            # alias: close (was deleteblock)
wsh block kill <block_ref> --force
wsh block rename <block_ref> "fixer-agent"            # so it can be found by name later
wsh block magnify <block_ref> --toggle
```

#### `wsh connection connect` / `wsh connection disconnect`

```bash
wsh connection connect <conn_name>
wsh connection disconnect <conn_name>
```

#### `wsh config set`

```bash
wsh config set "term:fontfamily" "JetBrains Mono"
wsh config set "term:fontsize" 14
```

### Orchestration

#### `wsh agent spawn`

Syntactic sugar over `wsh block new --view term --cmd`.

```bash
wsh agent spawn --connection prod --cmd "claude"
wsh agent spawn --connection prod --cmd "claude" --prompt "Fix the build error"
wsh agent spawn --connection prod --cmd "claude" --split right   # relative to focused block by default
```

#### `wsh prompt`  (modal)

Ask the user a question and block for the answer. Primary surface is a **UI modal** (works even when the orchestrator runs in a hidden/background block). stdin-as-prompt is a later convenience for visible-terminal agents.

```bash
wsh prompt "Deploy to production?" --options "yes,no"
# returns the chosen option on stdout
```

#### `wsh agent help`

Discovery command — lists all agent-capable commands with examples (see `wsh agent help` output in the original spec).

## Secret Injection

Secrets are referenced **by name**, never inlined. `wsh` resolves the name against the encrypted secret store (`wsh secret`, OS-keychain-backed) and injects the value directly into the target — the plaintext never appears in shell history, `ps`, process args, or command strings.

```bash
wsh block send-keys <block_ref> --secret <secret_label> --enter   # type the secret's VALUE
wsh run --wait --json --secret <secret_label> -- ./deploy.sh      # secret injected as env, not in args
wsh web run -- <<'EOF'                                             # web: secret() helper — useful v1: [[web-agent-api-v1.md]]
await fill("@password", secret("<secret_label>"));                 # v1 uses @N refs; getByRole is post-v1
EOF
```

- `--secret <secret_label>` resolves `<secret_label>` from the secret store at runtime; the literal value is never typed or echoed.
- Matches the existing `ssh:passwordsecretname` pattern (`pkg/remote/sshclient.go` resolves the name via `secretstore.GetSecret` at connect time).
- **Scoping (open question):** an agent should not automatically read every secret. Consider a namespace allowlist (e.g. `web_*`) or per-command grants.

## Trust & Security Model

- **Local agent:** same user, same permissions — no escalation. A local agent already has a local shell.
- **Remote agent:** `wsh` invoked from a remote connection routes back through the connserver and can control the **local** machine. Normally a remote process would need to SSH *back* to do that; routing through connserver collapses that hop. This is the one new trust boundary.
- **Gate:** new setting `agent:allowremotelocalcontrol`, **default off**. When off, remote-origin `wsh` requests that target the `local` connection are rejected. When on, the user has explicitly opted in.
- **Key insight (unchanged):** the agent runs as the same user with the same permissions; there is no privilege escalation beyond what the user has already granted the session the agent runs in.

## Build Order (phases)

1. **Mode A:** `wsh run --wait --json` — highest leverage, unblocks the most flows.
2. **Mode B:** `wsh block capture` (rename + `--tail` + `--json`), `wsh block send-keys`, `wsh block status` (minimal), split flags surfaced on CLI, `wsh block rename`, top-level tmux aliases.
3. **Layout:** flat geometry (`x/y/w/h`) in `block list --json`, directional addressing, title-substring addressing.
4. **Settings:** `wsh config get/list/set --json`.
5. **Orchestration:** `wsh prompt` (modal), `wsh agent spawn`, `wsh agent help`.
6. **Trust gate:** `agent:allowremotelocalcontrol` before anything ships.

## Files to Modify

| File | Change |
|------|--------|
| `cmd/wsh/cmd/wshcmd-*.go` | New/renamed CLI commands (`block capture`, `block send-keys`, `block status`, `block split`, `block rename`, `run --wait`, `config get/list`, `prompt`, `agent spawn/help`) + top-level aliases |
| `pkg/wshrpc/wshserver/` | Handlers for new RPCs: block geometry, process status, input injection, prompt |
| `pkg/wshrpc/wshrpctypes.go` | New RPC method signatures + return types (geometry, status, prompt) |
| `pkg/wshrpc/wshserver/resolvers.go` | Title-substring + directional resolvers |
| `pkg/wcore/` | Block query helpers: geometry computation from `LayoutState`, process state |
| `frontend/` | Prompt modal, expose layout geometry to RPC |
| `pkg/wconfig/settingsconfig.go` | `agent:allowremotelocalcontrol` + settings metadata for `config list` |

## Out of Scope (for now)

- **Streaming/event subscriptions** — "notify me when block output changes" (needs WebSocket/domain socket)
- **Programmatic UI rendering** — agent creates custom UI (beyond human capability)
- **Cross-workspace operations** — agent controls multiple Wave Terminal windows (single workspace scope)
- **Agent authentication/API keys** — agent inherits user's permissions
- **Rate limiting / audit logging** — can add later
- **Incremental capture (`--since`)** — deferred; `LastUpdated` cursor is the foundation
- **Full layout tree (`wsh tab layout`)** — deferred; flat geometry first
- **`block resize`** — deferred
- **stdin-based prompt** — deferred; modal first
- **`DynamicForward` / `wsh ssh -L/-R`** — separate spec

## Test Cases

Tests are table-driven Go tests (`t.Run`, manual `if` assertions, no testify) for RPC/resolver layers, CLI-level tests for command behavior, and manual UI tests for prompt/geometry.

### Mode A — `wsh run --wait --json`

| # | Scenario | Type | Execution | Expected |
|---|----------|------|-----------|----------|
| 1 | `run --wait --json -- echo hello` | happy | CLI in a terminal block | exit 0; JSON with `stdout == "hello"`, `exitcode == 0` |
| 2 | `run --wait --json -- false` | happy | CLI | `exitcode == 1`, stderr captured |
| 3 | `run --wait -- false` (no `--json`) | happy | CLI | human-readable summary incl. exit code |
| 4 | `run --wait` with no command after `--` | error | CLI | error "command must be specified after --"; non-zero exit |
| 5 | `run --wait --json -- sleep 2` | edge | CLI, timed | blocks ~2s, returns after completion (not immediately) |
| 6 | `run --wait --json --connection prod -- hostname` | edge | CLI, prod disconnected | error surfaced (can't reach connection), non-zero exit |

### Mode B — capture / send-keys / status / split

| # | Scenario | Type | Execution | Expected |
|---|----------|------|-----------|----------|
| 7 | `block capture <block_ref> --tail 10` | happy | create block, run `seq 1 50`, capture | exactly last 10 lines |
| 8 | `block capture <block_ref> --json` | happy | CLI | JSON has `lines`, `TotalLines`, `LastUpdated` (not dropped) |
| 9 | `block capture <preview-block>` (non-term) | error | CLI | error "not a terminal block" |
| 10 | `block capture nonexistent` | error | CLI | resolver error "id not found" |
| 11 | `block send-keys <block_ref> "echo hi" --enter` | happy | CLI | "echo hi\n" sent; command executes; capture shows output |
| 12 | `block status <block_ref>` after exited command | happy | CLI | `state == "exited"`, correct `exitcode` |
| 13 | `block status <block_ref>` while running | happy | CLI | `state == "running"` |
| 14 | `block split <block_ref> --direction right` | happy | CLI + `block list --json` | new block's geometry `x >= 0.5`; old block `x < 0.5`; widths sum to ~1 |

### Geometry & addressing

| # | Scenario | Type | Execution | Expected |
|---|----------|------|-----------|----------|
| 15 | `block list --json` geometry | happy | split tab into 2 | each `geometry` x/y/w/h within [0,1]; horizontal split widths sum to 1; vertical heights sum to 1 |
| 16 | `block select --right-of <block_ref>` | happy | 2-pane horizontal split | focuses the block with the larger `x` |
| 17 | `block select --left-of <block_ref>` on leftmost | edge | CLI | error "no block left of ..." (boundary) |
| 18 | `block capture "title-substr"` | happy | renamed block | resolves by title; works after `rename` |
| 19 | `term:2` addressing with 1 term block | error | CLI | error "could not find block 2 of type term" |

### Settings

| # | Scenario | Type | Execution | Expected |
|---|----------|------|-----------|----------|
| 20 | `config get "term:fontfamily"` | happy | CLI | returns current value as JSON |
| 21 | `config set "term:fontsize" 14` then `get` | happy | CLI | value persisted; `get` reflects 14 |
| 22 | `config get "nonexistent:key"` | error | CLI | error "unknown config key" |
| 23 | `config list --json` | happy | CLI | array with key/type/description/reload-required per entry |

### Prompt (manual/UI)

| # | Scenario | Type | Execution | Expected |
|---|----------|------|-----------|----------|
| 24 | `prompt "Deploy?" --options "yes,no"` | happy | CLI in hidden block | modal appears in UI; selecting "yes" returns `yes` on stdout |
| 25 | `prompt` with no options | edge | CLI | free-text input modal; returns typed answer |

### Trust gate

| # | Scenario | Type | Execution | Expected |
|---|----------|------|-----------|----------|
| 26 | remote `wsh` targets `local` connection, setting off | security | remote session | rejected with permission error |
| 27 | same, setting on | security | remote session | allowed (user opted in) |
| 28 | local `wsh` targets `local` connection, setting off | edge | local session | allowed (setting only gates remote origin) |

## Discovery

1. **Environment variable** — `WAVETERM=1` is set in every session (along with `WAVETERM_BLOCKID`, `WAVETERM_TABID`, `WAVETERM_CONN`, `WAVETERM_VERSION`). There is no `WAVE_TERMINAL` variable.
2. **`wsh agent help`** / **`wsh agent help --json`** — command card and versioned capability document.
3. **`wsh agent context --json`** — one-shot workspace snapshot; this is the first command an agent should run.
4. **`skills/wsh-agent/SKILL.md`** — the document in-terminal coding agents should load.
5. **tmux aliases** — an agent that tries `wsh capture-pane` / `wsh send-keys` / `wsh split-pane` lands on working commands.
6. **Documentation** — this spec, [[agent-control-fabric-v2.md]], and `docs/docs/wsh-reference.mdx`.
