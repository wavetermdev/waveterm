# Active Tasks

## Phase 1: Dev Environment ✅

- [x] Install Task (build runner)
- [x] Install Go 1.25+
- [x] Run `task init` to install dependencies
- [x] Run `task dev` — confirm app launches
- [x] Run `task start` — confirm standalone build works
- [x] Set up macOS CI workflow

## Phase 2: Feature Planning

- [ ] Finalize list of features to ADD
- [x] Finalize list of features to REMOVE or DIMINISH
- [ ] Prioritize implementation order

### Features to Remove / Disable

> "Remove" means **disable and hide from the UI** — don't delete code initially. Makes it easy to re-enable if needed and keeps the fork closer to upstream.

- **All Wave AI features** — AI widgets, AI chat, AI presets, context-aware assistant, AI-related UI elements and settings

## Phase 3: Implementation

### High Priority — Bugfix

- [x] **Tmux mouse integration lost on durable session reconnect** — FIXED 2026-05-19
  - Bug: tmux mouse mode (click to switch windows, wheel scrollback, click-drag select) works in new sessions but NOT in reconnected durable sessions after full WaveTerm restart
  - Repro: close WaveTerm completely → restart → durable sessions reconnect → tmux mouse integration disabled
  - Expected: durable sessions should re-enable tmux mouse integration on reconnect, same as new sessions
  - Root cause: xterm.js internal DEC private mode state lost on reconnect; only cached terminal data was replayed, not mode negotiation sequences
  - Fix commits: `af669bcb` (original DEC mode restore), `01f5073d` (multi-param CSI tracking, clear-all reset, stale cache purge, replay whitelist)
  - Tests: `f839f8ab` (14 Vitest unit tests with mocked xterm.js)
  - GitHub comment posted to issue #2 with full analysis
  - README fork notes updated with bug fix reference
- [x] **Crash on tab close after SSH session exit** — Fixed 2026-05-14
  - Root cause found: double `DestroyBlockController` race in `CloseTab` (explicit goroutine + `DeleteTab` → `BlockCloseEvent` handler)
  - Fix: removed redundant goroutine in `CloseTab`; added `sync.Once` to `ShellProc.Close()` as defense-in-depth
  - Added trace logging to `CloseTab`, `DestroyBlockController`, `ShellController.Stop`, `DurableShellController.Stop`, `handleBlockCloseEvent`
  - Tests: fixed 2 panicking tests (channel double-close bug in test code), all 14 tests pass under `-race`
  - Spec: [[.pi/specs/bug-tabclose-crash.md]]
  - [x] **Post-confirm cleanup:** Removed trace logging 2026-05-14

### Features

- [x] Remove telemetry (spec: [[.pi/specs/remove-telemetry.md]])
  - [x] Phase A: Remove call sites
  - [x] Phase B: Remove frontend telemetry
  - [x] Phase C: Delete unused packages
  - [x] Phase D: Clean up docs
- [x] Remove Wave AI features (spec: [[.pi/specs/remove-waveai.md]])
  - [x] Phase A: Disable UI (frontend) — completed 2026-05-16
    - [x] Fix blank screen: invalid nested `<Panel>` in `workspace.tsx` (removed inner PanelGroup but left VTabBar `<Panel>` orphaned inside outer `<Panel>`)
    - [x] Remove sparkle/Claude icon from terminal block header (`getShellIntegrationIconButton` → no-op stub)
    - [x] Minor: update misleading AI text in `builder-previewtab.tsx` EmptyStateView — fixed 2026-05-16
  - [x] Phase B: Remove backend wiring (Go) — 2026-05-15
  - [x] Phase C: Clean up docs & schemas — 2026-05-16
  - [x] Phase D: Delete unused code — completed 2026-05-16
    - [x] Remove builder AI dependencies (A.15: `AIPanel`, `WaveAIModel`, `formatFileSize`, `builder-focusmanager.ts`)
    - [x] Move `formatFileSize` to shared utility (`@/util/util`) — completed in commit bd355fad
    - [x] Delete `pkg/aiusechat/` (entire directory, ~12K lines, dead package)
    - [x] Delete `frontend/app/aipanel/` (17 files, orphaned after builder deps removed)
    - [x] Delete `frontend/app/view/waveai/`, `frontend/app/view/aifilediff/`, `frontend/app/view/waveconfig/waveaivisual.tsx`
    - [x] Delete `frontend/app/onboarding/fakechat.tsx`, preview files
    - [x] Clean Go structs: `SettingsType`, `MetaTSType`, `ObjRTInfo`, `FullConfigType`, `AIModeConfigType`, etc.
    - [x] Delete default configs: `waveai.json`, `presets/ai.json`, clean `settings.json`
    - [x] Regenerate auto-generated TS types (`gotypes.d.ts`, `waveevent.d.ts`, `wshclientapi.ts`) and Go metaconsts
  - [x] Document Claude Code shell integration analysis for future pi agent reuse (`.pi/decisions.md`)
- [ ] **ACTIVE:** SSH port forwarding (`LocalForward` / `RemoteForward`) (spec: [[.pi/specs/portforwarding.md]])
  - [ ] Modify `pkg/wconfig/settingsconfig.go`
  - [ ] Modify `pkg/remote/sshclient.go` (parse + return merged keywords)
  - [ ] Modify `pkg/remote/conncontroller/conncontroller.go` (runtime forwarding)
  - [ ] Update call sites for new `ConnectToClient` signature
  - [ ] Add tests
  - [ ] Update documentation (`docs/docs/connections.mdx`)
- [ ] **Remote file paste** — image paste + drag-drop for remote sessions
  - Primary use case: pasting screenshots and dragging files when using pi or Claude Code's TUI over SSH
  - Currently pastes local file paths that don't exist on the remote server
  - Need: upload file to remote (SSH exec with stdin, SFTP, or SCP), then paste remote path
  - Sub-tasks:
    - [ ] Detect when terminal block is on a remote SSH connection
    - [ ] Add RPC command to upload file bytes to remote server via existing SSH connection
    - [ ] Wire up image paste (`termwrap.ts` `pasteHandler`) to use remote upload for SSH sessions
    - [ ] Wire up drag-drop (`termwrap.ts` `dropHandler`) to use remote upload for SSH sessions
    - [ ] Add tests

- [ ] Paste screenshots into terminal (local sessions — polish)
  - [ ] Consider implementing paste-as-image in Pi directly for tighter integration (avoid SCP+filename pattern, inject binary data or use OSC52/terminal-native paste)

## Backlog / Ideas

### Features to Add (discuss, spec, scope later)

- **MOSH support** — Research done 2026-05-20. MOSH's main benefits: seamless reconnection (roaming, sleep/wake) and client-side local echo. Not a priority because: (1) no port forwarding (open issue since 2014), (2) no OSC52 clipboard, (3) no scrollback, (4) C++ only, slow development. tsshd (trzsz-ssh) is the more relevant reference — Go-based, full SSH features + UDP roaming, but significant architectural change. Local echo is technically possible with wsh but non-trivial and low-value for typical latency.
- **Vertical tabs** — Tab layout optimized for remote host switching



### Forwarding Enhancements

- DynamicForward (SOCKS proxy) — out of scope for v1, needs SOCKS5 handler
- `wsh ssh -L` / `-R` CLI flags
- UI status indicator for active port forwards

### UX Improvements

- **New block default connection** — Currently clicking '+' defaults to local; for remote-first workflow, should default to SSH/remote or at least not require manual switching
- **SSH config as source of truth** — Connection management currently pushes users to JSON/settings UI instead of naturally leveraging `~/.ssh/config` as the primary management interface

### File Transfer

- **Drag and drop file transfer** — Drag files into the file browser to upload; drag from file browser to download

### General

- Remove checks to `dl.waveterm.dev` (e.g., update checks, download URLs)
- Evaluate which other local-first widgets to remove/diminish
