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

- [x] **Durable session auto-reconnect unreliable** (draft: [[.pi/draft-issue-autoconnect-bugs.md]]) — P0 bugs fixed 2026-05-23
  - [x] Bug #1 (P0): Route-level cooldown consumed before connection check — moved `lastAutoReconnectAttempt.Set` into `attemptAutoReconnect` after `IsConnected` passes
  - [x] Bug #2 (P0): connStates reconciliation race — replaced `processed bool` with generation counters (`actualGen` / `procGen`); `reconcileConn` now sends follow-up signal if `actualGen != procGen` at finish
  - [x] Bug #3 (P0): singleflight caches transient reconnect failures — split `reconnectGroup` into `reconnectConnGroup` and `reconnectRouteGroup`; route-level `attemptAutoReconnect` now calls `ReconnectJobRoute` instead of sharing the connection-level cache
  - [x] Decision 2026-05-23: Server reboot / `wsh` death → manual reconnect (do NOT auto-restart fresh shell). Auto-restart would change durable-session semantics from "resume existing shell" to "keep shell open at all costs," creating context-loss confusion and `wsh` re-install loops.
  - GitHub issue (problem): https://github.com/whoisjeremylam/waveterm-remote/issues/7
  - GitHub issue (implementation): https://github.com/whoisjeremylam/waveterm-remote/issues/8
  - Branch: `fix/auto-reconnect-detection-gaps`
  - [x] Phase 1 (Gap C): Auto-disconnect on stall — `ConnMonitor` detects stall but doesn't set `Status=Disconnected`
    - Commit `b4c4dbea`: Add configurable `ConnStallDisconnectThreshold` to `ConnKeywords`
    - Trigger `conn.Close()` when stall exceeds threshold (removed `!isUrgent()` guard per spec review)
    - Commit `a157b234`: Add `AttemptReconnect` helper + reconnect scheduler in `onConnectionDown` (fixes GAP-1)
    - This makes sleep/Wi-Fi/VPN interruptions self-healing via existing `onConnectionUp`
  - [x] Phase 2 (Gap A): Implement `NotifySystemResumeCommand` — commit `a157b234` + Phase 2 additions
    - `emain.ts` already hooks `powerMonitor.on('resume')` → calls `NotifySystemResumeCommand`
    - `wshserver.go`: `NotifySystemResumeCommand` now calls `jobcontroller.HandleSystemResume(ctx)` instead of no-op
    - `jobcontroller.go`: `HandleSystemResume` iterates all connections, finds those with durable jobs, forces disconnect on stalled zombies, spawns `AttemptReconnect()` goroutines for immediate reconnect
    - Fast-path: bypasses 30s scheduler tick, attempts reconnect within ~1-2s of system wake
  - [x] Phase 3 (Gap B): Aggressive scheduler enhancement — implemented as Option B
    - `isNetworkUnreachableError()` detects dial tcp i/o timeout, no route, DNS failure
    - On network-unreachable error: switch to 5s interval for 2 minutes
    - When user switches back to good Wi-Fi, next 5s tick reconnects automatically
    - After 2 minutes aggressive: returns to 30s interval for remaining scheduler window
    - If still no network after total 5 min: scheduler gives up (manual reconnect required)
    - No native modules, zero build risk, cross-platform automatically
  - Edge cases (P2): respect manual disconnect, reconnect UI indicator

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

- [ ] **System widgets follow terminal focus** (spec: [[.pi/specs/widget-follow-focus.md]])
  - When opening Process Viewer, File Browser, etc., inherit connection from focused terminal
  - [ ] Add `getFocusedTerminalConnection()` helper in `global.ts`
  - [ ] Add `createWidgetBlock()` wrapper that injects connection meta
  - [ ] Update widgets bar (`widgets.tsx`) to use `createWidgetBlock`
  - [ ] Add `inheritconnection` field to widget config schema
  - [ ] Verify non-terminal widgets (Settings, Help) are unaffected
  - [ ] Add tests

- [ ] Paste screenshots into terminal (local sessions — polish)
  - [ ] Consider implementing paste-as-image in Pi directly for tighter integration (avoid SCP+filename pattern, inject binary data or use OSC52/terminal-native paste)

## Backlog / Ideas

### Features to Add (discuss, spec, scope later)

- **MOSH support** — Research done 2026-05-20. MOSH's main benefits: seamless reconnection (roaming, sleep/wake) and client-side local echo. Not a priority because: (1) no port forwarding (open issue since 2014), (2) no OSC52 clipboard, (3) no scrollback, (4) C++ only, slow development. tsshd (trzsz-ssh) is the more relevant reference — Go-based, full SSH features + UDP roaming, but significant architectural change. Local echo is technically possible with wsh but non-trivial and low-value for typical latency.
- **Vertical tabs** — Tab layout optimized for remote host switching



### Agent Orchestration API

- [ ] **wsh Agent API** — Agent orchestration via wsh commands (spec: [[.pi/specs/wsh-agent-api.md]])
  - Scope guardrail: "anything a human could do via the UI or keyboard"
  - Phase 1: `--json` output on existing read commands (`block list`, `connection list`, `tab list`)
  - Phase 2: New read commands (`block get` with scrollback, `config get`)
  - Phase 3: Write commands (`block create` with options, `block send-keys`, `block focus`, `config set`)
  - Phase 4: Agent helpers (`agent spawn`, `agent help`)
  - Discovery: `WAVE_TERMINAL=1` env var + `wsh agent help`
  - Security: no new auth surface — agent inherits user's permissions

### Forwarding Enhancements

- DynamicForward (SOCKS proxy) — out of scope for v1, needs SOCKS5 handler
- `wsh ssh -L` / `-R` CLI flags
- UI status indicator for active port forwards

### Session Persistence (Tmux + Wsh Overlap)

> Jeremy's note 2026-05-23: "I frequently lose all sessions when the server automatically restarts each week (part of a backup). I have to recreate tmux sessions manually."

- **Tmux session auto-restore on reconnect** — After server reboot + reconnect, automatically recreate tmux sessions (restore layout, windows, sessions). Currently lost because `wsh` / job manager dies and WaveTerm only reconnects the raw shell.
- **Tab name sync with tmux session name** — WaveTerm tab label follows tmux session name for visibility.
- **Bring tmux features into wsh** — Tmux provides persistence, session multiplexing, and screen visibility (for agents). Consider which tmux features overlap with WaveTerm durable sessions and where wsh could natively replicate them (session restore, window splitting, scrollback capture).

### UX Improvements

- **New block default connection** — Currently clicking '+' defaults to local; for remote-first workflow, should default to SSH/remote or at least not require manual switching
- **SSH config as source of truth** — Connection management currently pushes users to JSON/settings UI instead of naturally leveraging `~/.ssh/config` as the primary management interface

### File Transfer

- **Drag and drop file transfer** — Drag files into the file browser to upload; drag from file browser to download

### General

- Remove checks to `dl.waveterm.dev` (e.g., update checks, download URLs)
- Evaluate which other local-first widgets to remove/diminish
