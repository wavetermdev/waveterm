# Spec: wsh Agent API — Terminal Orchestration via wsh

**Date:** 2026-05-20
**Status:** Draft

## Problem

AI coding agents (pi, Claude Code, Cursor, etc.) running inside Wave Terminal terminals have no awareness of the Wave Terminal application itself. They can execute shell commands and edit files, but cannot:
- See what other blocks/connections exist
- Open new terminals on different connections
- Read terminal output from other blocks
- Reorganize layout or manage connections

This limits agents to operating within a single terminal context. With Wave Terminal as an orchestration surface, agents can coordinate across connections, manage the workspace, and spawn other agents.

## Scope Guardrail

**Include:** Anything a human could do via the UI or keyboard.
**Exclude:** Streaming event subscriptions, programmatic UI rendering, anything beyond human capability.

## Design Principles

1. **wsh-first** — All agent capabilities exposed via `wsh` commands. Works locally and remotely (routed through connserver).
2. **JSON output** — `--json` flag on all read commands for machine parsing.
3. **Idempotent** — Commands are safe to retry (important for agents dealing with flaky networks).
4. **No new auth surface** — Agent runs as the same user; inherits existing permissions. No API keys or tokens.

## Proposed Commands

### Read Commands

#### `wsh block list`

List all blocks in the current workspace.

```bash
wsh block list                          # human-readable table
wsh block list --json                   # JSON array
wsh block list --tab <tab-id>           # filter by tab
wsh block list --connection <name>      # filter by connection
wsh block list --view term              # filter by view type
```

**JSON output:**
```json
[
  {
    "id": "block-uuid",
    "view": "term",
    "tab": "tab-uuid",
    "connection": "prod-server",
    "connStatus": "connected",
    "cwd": "/home/user/project",
    "title": "prod-server: ~/project",
    "magnified": false,
    "focused": true
  }
]
```

#### `wsh block get`

Get details for a specific block, including terminal scrollback.

```bash
wsh block get <block-id> --json
wsh block get <block-id> --lines 50     # last N lines of scrollback
wsh block get <block-id> --no-scrollback # block metadata only
```

**JSON output:**
```json
{
  "id": "block-uuid",
  "view": "term",
  "connection": "prod-server",
  "connStatus": "connected",
  "cwd": "/home/user/project",
  "scrollback": [
    {"line": 1, "text": "$ ls -la"},
    {"line": 2, "text": "total 42"},
    {"line": 3, "text": "drwxr-xr-x  5 user user  4096 May 20 10:00 ."}
  ],
  "scrollbackTotal": 1250,
  "scrollbackFrom": 1201,
  "scrollbackTo": 1250
}
```

#### `wsh connection list`

List all connections and their status.

```bash
wsh connection list --json
```

**JSON output:**
```json
[
  {
    "name": "prod-server",
    "type": "ssh",
    "host": "prod.example.com",
    "user": "deploy",
    "status": "connected",
    "durableSessions": 2
  },
  {
    "name": "local",
    "type": "local",
    "status": "connected",
    "durableSessions": 0
  }
]
```

#### `wsh tab list`

List all tabs and their layout.

```bash
wsh tab list --json
```

**JSON output:**
```json
[
  {
    "id": "tab-uuid",
    "title": "Production",
    "blockIds": ["block-uuid-1", "block-uuid-2"],
    "focusedBlockId": "block-uuid-1",
    "layout": "split-horizontal"
  }
]
```

#### `wsh config get`

Read configuration values.

```bash
wsh config get "term:fontfamily" --json
wsh config get --all --json                    # all settings
wsh config get --connection <name> --json      # connection-specific settings
```

### Write Commands

#### `wsh block create`

Create a new block (terminal, file browser, etc.).

```bash
# Create terminal on a connection
wsh block create --view term --connection prod-server

# Create terminal with a command
wsh block create --view term --connection prod-server --cmd "tail -f /var/log/syslog"

# Create file browser at a path
wsh block create --view preview --connection prod-server --file /var/log

# Split relative to focused block
wsh block create --view term --split horizontal --connection staging

# In a specific tab
wsh block create --view term --tab <tab-id> --connection prod-server

# Magnified (fullscreen within tab)
wsh block create --view term --magnified --connection prod-server
```

**Output:** `block-uuid` (the ID of the created block)

#### `wsh block close`

Close a block.

```bash
wsh block close <block-id>
wsh block close <block-id> --force    # close even if has running process
```

#### `wsh block send-keys`

Send keystrokes to a terminal block (as if typed by a human).

```bash
wsh block send-keys <block-id> "ls -la"
wsh block send-keys <block-id> "ls -la" --enter    # append Enter key
wsh block send-keys <block-id> --literal "\u001b[A" # Escape sequence (up arrow)
```

#### `wsh block focus`

Focus a block (give it keyboard focus).

```bash
wsh block focus <block-id>
```

#### `wsh block magnify`

Magnify (fullscreen) or unmagnify a block within its tab.

```bash
wsh block magnify <block-id>
wsh block magnify <block-id> --toggle
wsh block unmagnify <block-id>
```

#### `wsh connection connect`

Connect to a connection (if disconnected).

```bash
wsh connection connect <connection-name>
```

#### `wsh connection disconnect`

Disconnect from a connection.

```bash
wsh connection disconnect <connection-name>
```

#### `wsh config set`

Set a configuration value.

```bash
wsh config set "term:fontfamily" "JetBrains Mono"
wsh config set "term:fontsize" 14
```

### Agent Orchestration

#### `wsh agent spawn`

Spawn an agent command in a new terminal block.

```bash
# Spawn Claude Code on a remote connection
wsh agent spawn --connection prod-server --cmd "claude"

# Spawn with a prompt
wsh agent spawn --connection prod-server --cmd "claude" --prompt "Fix the build error"

# Spawn in a split next to focused block
wsh agent spawn --connection prod-server --cmd "claude" --split horizontal
```

This is syntactic sugar for `wsh block create --view term --connection <name> --cmd "<cmd>"`.

## Implementation Approach

### Phase 1: JSON output on existing commands

Many `wsh` commands already exist. Add `--json` flag:

| Command | Current state | Change |
|---------|---------------|--------|
| `wsh block list` | Exists, human-readable | Add `--json`, add filters (`--tab`, `--connection`, `--view`) |
| `wsh block get` | May not exist | New command with `--lines`, `--no-scrollback` |
| `wsh connection list` | Exists | Add `--json` |
| `wsh tab list` | May not exist | New command with `--json` |
| `wsh config get` | May not exist | New command |

### Phase 2: Write commands

| Command | Current state | Change |
|---------|---------------|--------|
| `wsh block create` | Exists via RPC | Expose via `wsh` CLI with more options |
| `wsh block close` | Exists | Already works |
| `wsh block send-keys` | New | Send keystrokes to terminal block |
| `wsh block focus` | New | Focus a block |
| `wsh config set` | New | Set configuration values |

### Phase 3: Agent helpers

| Command | Current state | Change |
|---------|---------------|--------|
| `wsh agent spawn` | New | Syntactic sugar for block create + cmd |
| `wsh agent help` | New | Discovery command — lists all agent-capable commands |

## Files to Modify

| File | Change |
|------|--------|
| `cmd/wsh/cmd/` | New CLI commands (`wshcmd-block-list.go`, `wshcmd-block-get.go`, etc.) |
| `pkg/wshrpc/wshserver/` | Server-side handlers for new RPC commands |
| `pkg/wshrpc/wshrpctypes.go` | New RPC method signatures |
| `pkg/wcore/block.go` | Block query helpers |
| `frontend/app/store/global.ts` | `createBlock` already exists, may need exposure via wsh |

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Agent reads sensitive terminal output (API keys, passwords) | Same as human — if agent has shell access, it can read anything anyway. No additional risk. |
| Agent modifies config | Same as human — `wsh config set` is available to the user. No additional risk. |
| Agent on remote server controls local Wave Terminal | `wsh` commands already route through connserver RPC. Agent inherits user's permissions. |
| Agent spawns processes on other connections | Agent already has SSH access if it's running in a terminal on that connection. No additional risk. |
| **Secrets access** | `wsh secret get` already exists. Agent can use it. Document this as a capability, not hide it. |

**Key insight:** The agent runs as the same user with the same permissions. There is no privilege escalation. The "security model" is identical to a human using the Wave Terminal UI.

## Out of Scope (for now)

- **Streaming/event subscriptions** — "notify me when block output changes" (needs WebSocket/domain socket)
- **Programmatic UI rendering** — Agent creates custom UI elements (beyond human capability)
- **Cross-workspace operations** — Agent controls multiple Wave Terminal windows (single workspace scope)
- **Agent authentication/API keys** — Agent inherits user's permissions, no separate auth
- **Rate limiting** — Agent runs locally, no DoS concern
- **Audit logging** — Can add later if needed

## Test Cases

| Scenario | Expected |
|----------|----------|
| `wsh block list --json` from local terminal | Returns all blocks including remote ones |
| `wsh block list --json` from remote terminal | Same result (routed through connserver) |
| `wsh block create --view term --connection prod` | New terminal block opens, connected to prod |
| `wsh block send-keys <id> "echo hello" --enter` | "echo hello\n" sent to terminal, command executes |
| `wsh block get <id> --lines 10` | Returns last 10 lines of scrollback |
| `wsh agent spawn --connection prod --cmd "claude"` | New block with claude running on prod |
| `wsh config get --all --json` | Returns all settings as JSON |
| Agent parses JSON, creates block, sends keys | Full orchestration flow works end-to-end |

## Discovery

How does an agent know this exists?

1. **Environment variable** — `WAVE_TERMINAL=1` set in all terminal sessions
2. **wsh agent help** — Lists all agent-capable commands with examples
3. **Documentation** — `.pi/specs/wsh-agent-api.md` + public docs in `docs/docs/`

Example `wsh agent help` output:
```
Wave Terminal Agent API
=======================
The following wsh commands support --json output for agent integration:

Read workspace state:
  wsh block list --json              List all blocks
  wsh block get <id> --json          Get block details + scrollback
  wsh connection list --json         List connections
  wsh tab list --json                List tabs

Modify workspace:
  wsh block create --view term --connection <name>
  wsh block close <id>
  wsh block send-keys <id> "command" --enter
  wsh block focus <id>

Configuration:
  wsh config get <key> --json
  wsh config set <key> <value>

Spawn agents:
  wsh agent spawn --connection <name> --cmd "claude"

For full documentation: wsh agent help --full
```
