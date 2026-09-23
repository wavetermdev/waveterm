# Agent Control Fabric v2 — Implementation Spec

**Date:** 2026-09-02
**Status:** Implemented (connection gate unchanged)
**Parent:** [[wsh-agent-api.md]]
**Out of scope (explicit):** widening the remote→local connection gate; secret-store grants; MCP adapter; web CDP (v1 spec locked: [[web-agent-api-v1.md]]; full vision: [[web-agent-api.md]]).

Connection gate (`agent:allowremotelocalcontrol`) stays as designed. This spec lands the rest of the design-review items.

## Goals

An agent that finds itself in a RemoteTerm session can: orient in one RPC round-trip, run commands without stealing focus or littering the layout, wait on other blocks without streaming, spawn/list/stop owned subagents, prompt the user with a safe default, and manage tabs. Output is capped. Discovery uses `WAVETERM=1` (already set) plus a SKILL.md.

## Conventions

- Table-driven Go tests, `t.Run`, manual `if` assertions, no testify.
- `panichandler` on goroutines; `WithLock` for struct mutations.
- New RPCs: add to `WshRpcInterface` in `pkg/wshrpc/wshrpctypes.go`, then `./node_modules/.bin/task generate`.
- CLI in `cmd/wsh/cmd/wshcmd-*.go`. JSON tags lowercase. Hyphenated flags.
- Do not change `agent:allowremotelocalcontrol` behavior.
- Do not commit or push.

## Command / behavior changes

### Discovery

- `wsh agent help` must say `WAVETERM=1` (and `WAVETERM_BLOCKID`, `WAVETERM_TABID`, `WAVETERM_CONN`, `WAVETERM_VERSION`), never `WAVE_TERMINAL=1`.
- `wsh agent help --json` prints a versioned capability document (commands, flags, env vars).
- Ship `skills/wsh-agent/SKILL.md` — the document an in-terminal coding agent should read first.

### `wsh agent context --json`

One-shot orientation. Compose existing RPCs (no new backend RPC required):

```json
{
  "waveterm": true,
  "version": "<WAVETERM_VERSION or wavebase.WaveVersion>",
  "workspaceid": "...",
  "tabid": "...",
  "blockid": "...",
  "connection": "...",
  "focused": { "blockid": "...", "view": "term", "title": "...", "cwd": "..." },
  "tabs": [{ "tabid": "...", "name": "...", "index": 0, "active": true }],
  "connections": [{ "name": "...", "status": "...", "connected": true }],
  "blocks": [{ "blockid": "...", "id": "block:...", "tabid": "...", "view": "term", "title": "...", "connection": "...", "cwd": "...", "index": 1, "geometry": {"x":0,"y":0,"w":1,"h":1}, "focused": true, "magnified": false, "agentowned": false, "processstate": "running" }]
}
```

`processstate` is best-effort (skip/omit on error). `cwd` from `cmd:cwd` meta.

### `wsh agent list` / `wsh agent stop`

- Owned blocks are tagged `agent:owned=true` plus `agent:parent`, `agent:cmd`, optional `agent:idempotency-key` (constants in `pkg/waveobj/agentmeta.go`).
- `list --json` filters blocks with `agent:owned`.
- `stop [block_ref]` kills that owned block; with no arg, kills every owned block in the current workspace. Refuse to stop a block that is not agent-owned unless `--force`.

### `wsh agent spawn`

- Default **no focus** (`Focused: false`). `--focus` to steal focus.
- Tag extra meta via `createBlockNew` `extraMeta`.
- `--idempotency-key <key>`: if a running owned block with that key exists, return it instead of creating another.
- `--name` sets `frame:title` so title-substring addressing works.
- Keep `--prompt` (existing controller-ready poll). Do not claim REPL-ready.

### `wsh run --wait`

- Default: **do not focus** the new block; **force-close** on exit (`cmd:closeonexitforce`); timeout **5m** (flag `--timeout <duration>`, e.g. `30s`, `5m`).
- `--focus` to focus; `--keep-block` to leave the block open.
- JSON: keep `stdout`, `exitcode`, `durationms`, `blockid`. Add `"outputmerged": true`. Document that a PTY merges stdout/stderr; `stderr` stays `""`.
- On timeout, return an error that includes the block id (and do not hang past `--timeout`).
- `--json` without `--wait` remains an error.

### `wsh block capture`

- Default `--tail 200` when the user did not pass `--tail`, `--all`, `--start`, or `--end`.
- `--all` returns the full buffer.
- `--max-bytes N` truncates the joined output (not individual lines) and, in JSON, sets `"truncated": true`.
- `--since-line N` maps to `LineStart` (incremental cursor). JSON already has `totallines` / `lastupdated`; also emit `linestart`.
- `--since` (timestamp ms): if `LastUpdated <= since`, return empty lines (still include cursors). Otherwise return as usual (with default tail unless overridden).

### `wsh block wait`

New subcommand (new file `cmd/wsh/cmd/wshcmd-block-wait.go` to keep `wshcmd-block.go` smaller, registered on `blockCmd`).

```
wsh block wait <block_ref> --until-exit
wsh block wait <block_ref> --contains <substr>
wsh block wait <block_ref> --idle <ms>
wsh block wait <block_ref> --timeout <duration>   # default 60s
```

Exactly one of `--until-exit` / `--contains` / `--idle` is required. Poll 200ms. Exit 0 on success, error on timeout. `--json` reports `{ "ok": true, "reason": "exit"|"contains"|"idle", "elapsedms": N }`.

### `wsh block send-keys`

- `--force` skips the human-input guard.
- Without `--force`, call `GetBlockInputState` routed to `tab:<tabid>`. If `lastuserinputms` is within 2000ms, refuse with a clear error telling the user to pass `--force`.
- If the input-state RPC fails (old frontend), proceed (fail open) unless `--force` was the only path.

### `wsh block screenshot`

CLI wrapper around existing `CaptureBlockScreenshotCommand`. `--output <file>` writes PNG (the RPC returns a data URL or base64 — inspect `tabrpcclient.ts` and match). `--json` prints `{ "blockid", "bytes" }` or the path.

### `wsh block new` / `createBlockNew`

- `blockNewOptions` has `focused bool` and `extraMeta waveobj.MetaMapType`.
- `block new` / `split` default focused=true; `--no-focus` sets false.
- `createBlockNew` must merge `extraMeta` into the block meta.

### `wsh block list --json`

Add `cwd` (from `cmd:cwd`) on `BlockDetails`.

### Tabs

New RPCs (implemented in `wshserver`, wrapping `wcore` + `SendUpdateEvents`, matching `WorkspaceService`):

- `CreateTabCommand(ctx, CommandCreateTabData) (CommandCreateTabRtnData, error)`
- `SetActiveTabCommand(ctx, CommandSetActiveTabData) error`
- `DeleteTabCommand(ctx, CommandDeleteTabData) (CommandDeleteTabRtnData, error)`

`UpdateTabNameCommand` already exists.

CLI:

```
wsh tab new [--name <name>] [--connection <conn>] [--activate] [--json]
wsh tab select <tab_ref>
wsh tab close <tab_ref>
wsh tab rename <tab_ref> <name>
```

`tab_ref`: uuid, `tab:N` (already in resolver), or title substring of tab name. `--activate` defaults true for `new`. `close` of the last tab should error rather than close the window.

### `wsh prompt`

- `--timeout <duration>` (default 60s). CLI RPC timeout must be > prompt timeout.
- `--default <value>`: on timeout, print the default and exit 0 (safe miss). On user cancel, still error.
- `--title` already exists on the RPC (`Title`); expose `--title` on the CLI if missing.

`userinput.GetUserInput`: if `TimeoutMs > 0` use it instead of hardcoded 60s for this request. On timeout, if `DefaultOption != ""`, return that as `Text` with no error.

### Human/agent coexistence (frontend)

- `handleTermData` in `termwrap.ts` records `Date.now()` per block id (module-level map). This is **user** keystrokes; agent `send-keys` goes through the PTY and does not hit `onData`.
- `GetBlockInputStateCommand(blockId)` implemented on the **tab client** (`tabrpcclient.ts`), like `GetFocusedBlockData`. Returns `{ blockid, lastuserinputms }` (0 if never).
- Block frame: if meta `agent:owned` is true, show a compact "agent" label in the header end-icons (no emoji). CSS class `block-frame-agent-owned` on the frame.

### Idempotency

`--idempotency-key` on `agent spawn` (and optionally `block new`). Lookup: list blocks, match meta key, if process still running return existing id. Creating a second block with the same key while the first is running is a no-op.

### Audit (lightweight)

`log.Printf("[agent-audit] ...")` on: agent spawn, agent stop, send-keys (block id, not payload), prompt shown, tab close. No new auth surface. Do not log secret values.

## Files likely touched

| Area | Files |
|------|--------|
| Meta | `pkg/waveobj/wtypemeta.go` (regenerated into `pkg/waveobj/metaconsts.go`) |
| RPC types | `pkg/wshrpc/wshrpctypes.go` then `task generate` |
| Tab RPCs | `pkg/wshrpc/wshserver/wshserver.go` |
| Prompt | `pkg/userinput/userinput.go`, `wshserver.PromptCommand`, `cmd/wsh/cmd/wshcmd-prompt.go`, `frontend/app/modals/userinputprompt.tsx` |
| Block CLI | `cmd/wsh/cmd/wshcmd-block.go`, `wshcmd-block-wait.go`, `wshcmd-blocks.go`, tests |
| Agent CLI | `cmd/wsh/cmd/wshcmd-agent.go`, `wshcmd-run.go`, `wshcmd-run-wait.go`, tests |
| Tab CLI | `cmd/wsh/cmd/wshcmd-tab.go`, tests |
| Frontend | `termwrap.ts`, `tabrpcclient.ts`, `blockframe.tsx` / `blockframe-header.tsx`, `block.scss` |
| Skill | `skills/wsh-agent/SKILL.md` |
| Docs | `docs/docs/wsh-reference.mdx`, `.pi/specs/wsh-agent-api.md` |

## Tests required (minimum)

- capture default tail / `--all` / `--max-bytes` / `--since-line` (pure helpers)
- block wait flag validation (exactly one condition; timeout parse)
- run --wait timeout parse; JSON `outputmerged`
- agent help contains `WAVETERM=1` not `WAVE_TERMINAL`
- agent help --json unmarshals and lists commands
- resolveAgentSplit still passes
- spawn idempotency-key lookup helper
- parseOptionsFlag + new prompt default/timeout helpers
- tab ref resolver
- userinput timeout-with-default (if testable without frontend)
- GetUserInput TimeoutMs honored
- title matcher still errors on ambiguity (already exists)

## Version

After new RPCs land, bump patch with `node version.cjs patch` so remotes pick up the new wsh binary. Do this once at the end, not per workstream.
