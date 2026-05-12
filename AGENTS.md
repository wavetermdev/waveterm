# AGENTS.md — waveterm-remote Fork

This fork of Wave Terminal is optimized for remote development workflows. The local machine is a thin client; remote SSH environments are primary workspaces.

## Git Remotes

- `origin` → `https://github.com/whoisjeremylam/waveterm-remote` (this fork)
- `upstream` → `https://github.com/wavetermdev/waveterm` (original)
- Do not run `git push` — the user handles pushes interactively with 2FA

## Dev Environment Status

| Tool | Status |
|------|--------|
| NodeJS v24.14.0 | Available |
| npm 11.9.0 | Available |
| git 2.43.0 | Available |
| Go 1.25+ | **Missing** — must install before building |
| Task (build runner) | **Missing** — must install before building |

Install Task and Go before attempting builds. Then run `task init` and `task dev`.

## Planning Documents

All fork planning lives in `.pi/`:
- `.pi/index.md` — entry point
- `.pi/context.md` — fork purpose and problem statement
- `.pi/todos.md` — active tasks and backlog
- `.pi/decisions.md` — architecture decisions
- `.pi/specs/` — feature specifications

Current active spec: `.pi/specs/portforwarding.md`

## Architecture

- **Frontend**: React/TypeScript in `frontend/`
- **Backend**: Go in `pkg/` and `cmd/`
- **Electron main**: `emain/` (Node.js bridge between frontend and Go)
- **Go backend runs as separate process** — Electron main process bridges to it via IPC

## Priorities

1. Install missing build tools (Task, Go)
2. Verify `task dev` and `task start` work
3. Implement SSH port forwarding (`LocalForward`/`RemoteForward`) — spec ready
4. Later: remove/disable AI features, MOSH support, vertical tabs, UX improvements

## Conventions

- Follow existing code patterns: `panichandler` on goroutines, `WithLock` for struct mutations, table-driven tests with `t.Run`, manual `if` assertions (no testify)
- `docs/docs/` is public-facing documentation (Docusaurus) — do not mix fork planning with user docs
- `README.md` stays close to upstream; fork differences go in `.pi/` or `README-FORK.md` if needed
- All new SSH config keywords follow the parsing pattern in `pkg/remote/sshclient.go`
- ConnKeywords fields use `json:"ssh:..."` tags for SSH config and `json:"conn:..."` for internal config

## Key Files for SSH Work

| File | Purpose |
|------|---------|
| `pkg/wconfig/settingsconfig.go` | `ConnKeywords` struct — add new SSH fields here |
| `pkg/remote/sshclient.go` | Config parsing (`findSshConfigKeywords`), merging (`mergeKeywords`), `ConnectToClient` |
| `pkg/remote/conncontroller/conncontroller.go` | Connection lifecycle — start forwarding after connect, cleanup on disconnect |
| `pkg/genconn/ssh-impl.go` | SSH session implementation |
| `cmd/wsh/cmd/wshcmd-ssh.go` | `wsh ssh` CLI command |
| `docs/docs/connections.mdx` | Public docs for connections and SSH config |

## Testing

- No existing tests for `sshclient.go` or `conncontroller.go` — new tests would be first coverage
- Use `t.TempDir()` for filesystem fixtures, not external fixture files
- Use hand-written inline mocks, not gomock
- `t.Parallel()` on independent tests only

## Out of Scope (Current)

- DynamicForward (needs SOCKS5 handler)
- `wsh ssh -L`/`-R` CLI flags
- UI status indicators for port forwarding
