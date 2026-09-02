# AGENTS.md — RemoteTerm Fork

This fork of Wave Terminal is optimized for remote development workflows. The local machine is a thin client; remote SSH environments are primary workspaces.

## Git Remotes

- `origin` → `https://github.com/whoisjeremylam/remoteterm` (this fork)
- `upstream` → `https://github.com/wavetermdev/waveterm` (original)
- Do not run `git push` — the user handles pushes interactively with 2FA

## Dev Environment

| Tool | Status |
|------|--------|
| NodeJS v24.14.0 | Available |
| npm 11.9.0 | Available |
| git 2.43.0 | Available |
| Go 1.26.2 | Local install in `golang-1.26.2/` |
| Task (build runner) | Local npm dep (`@go-task/cli`) |

Go and Task are installed locally (not globally). The Taskfile uses `{{.GO_DIR}}` and `{{.GO}}` vars to reference the local Go binary.

**When upgrading Go**: download to `golang-<version>/`, update `GO_DIR` in Taskfile.yml vars, and run `echo "module golang" > golang-<version>/go.mod` (prevents `go mod tidy` from scanning the Go install dir as part of the project module).

Run `./node_modules/.bin/task init` then `./node_modules/.bin/task dev`.

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

## Build and Release Workflow

**The user never builds locally.** The workflow is:
1. Edit code locally
2. Commit + push
3. GitHub CI runs: `npm ci` → `postinstall` → `patch-package` → `electron-vite build` → `electron-builder`
4. User downloads the CI-built binary from GitHub artifacts

This means:
- `frontend/` TypeScript files ARE bundled by electron-vite — changes to `termwrap.ts` etc. appear in the CI binary
- `node_modules/` compiled JS files (`.mjs`/`.js`) ARE included if the patch file captures them
- `node_modules/` TypeScript source files (`.ts`) are **NOT compiled** — they are reference only. Editing `.ts` files in node_modules has **zero runtime effect** unless the corresponding `.js`/`.mjs` bundles are also updated in the patch

**patch-package behavior**: `npx patch-package` captures the delta between current `node_modules` files and the original npm package. It does NOT rebuild/compile. If you edit `.ts` source but not `.mjs`/`.js`, only the `.ts` section of the patch updates. The compiled sections remain at their previous state.

**To modify npm dependency behavior**: Edit the compiled `.mjs`/`.js` files in `node_modules/`, then run `npx patch-package` to capture both source and compiled changes in the patch. The `.ts` changes are cosmetic only (helpful for readability but not executed).

**Version bumps are required** when:
- Adding new wsh RPC commands (e.g., `GitStageCommand`) — remote servers only download new wsh binaries if the version changes
- Breaking changes to existing RPC types or protocols
- Adding new wsh CLI subcommands (files in `cmd/wsh/cmd/wshcmd-*.go`)
- Use `node version.cjs patch` for minor fixes, `node version.cjs minor` for new features

## Priorities

1. Verify `task dev` and `task start` work (build tools installed)
2. Implement SSH port forwarding (`LocalForward`/`RemoteForward`) — spec ready
3. Later: remove/disable AI features, UX improvements

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
