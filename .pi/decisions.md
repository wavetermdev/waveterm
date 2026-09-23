# Architecture Decisions

## 2026-05-10: Fork Purpose

**Decision:** Fork Wave Terminal to create a remote-development-optimized variant.

**Context:** Most terminals assume local-first workflows. This fork treats remote SSH environments as primary workspaces.

**Consequences:**
- Upstream remains the base; we merge regularly
- Features evaluated against "remote-first" usefulness
- Local-first features may be removed/diminished if they conflict with remote workflow

## 2026-05-10: `.pi/` as Planning Hub

**Decision:** Use `.pi/` directory for all fork planning, specs, and agent context.

**Context:** Keeps planning centralized and agent-accessible without cluttering the root or public docs.

**Files:**
- `.pi/index.md` — entry point
- `.pi/context.md` — project background
- `.pi/todos.md` — active tasks
- `.pi/decisions.md` — this file
- `.pi/specs/` — feature specifications

## 2026-05-10: Port Forwarding — Config-First Approach

**Decision:** Implement `LocalForward`/`RemoteForward` from `~/.ssh/config` and `connections.json`, not CLI flags.

**Context:** SSH config is the standard place developers already define forwarding rules. Making Wave respect them is the least-surprise approach.

**Approach:**
1. Parse `LocalForward`/`RemoteForward` in `findSshConfigKeywords()`
2. Add to `ConnKeywords` struct
3. Return merged keywords from `ConnectToClient()`
4. Start forwarding goroutines in `SSHConn.connectInternal()`
5. Clean up listeners in `closeInternal_withlifecyclelock()`

**Deferred:**
- `DynamicForward` (needs SOCKS5 handler)
- CLI flags on `wsh ssh` (can add later)
- UI status indicator

## 2026-05-14: Tab-Close Crash — Root Cause Found & Fixed

**Decision:** Remove redundant `DestroyBlockController` goroutine from `CloseTab`; add `sync.Once` to `ShellProc.Close()` as defense-in-depth.

**Context:** Investigation confirmed a race where `CloseTab` explicitly launched `DestroyBlockController` in a goroutine while `DeleteTab` → `DeleteBlock` → `BlockCloseEvent` triggered the same destruction again. This caused concurrent double-`Stop` on `ShellController` (with its Lock/Unlock/Relock window) and `DurableShellController` (which has no lock), leading to double `Session.Close()` / double `TerminateAndDetachJob`.

**Fix applied:**
1. `pkg/service/workspaceservice/workspaceservice.go` — removed the explicit `go DestroyBlockController()` loop; `DeleteTab` already triggers cleanup via events.
2. `pkg/shellexec/shellexec.go` — added `closeOnce sync.Once` to `ShellProc` and wrapped `Close()` in `sp.closeOnce.Do`, preventing double `KillGraceful` / double goroutine spawn even if two Stops race.
3. Added trace logging to `CloseTab`, `DestroyBlockController`, `ShellController.Stop`, `DurableShellController.Stop`, `handleBlockCloseEvent` for interactive diagnosis.
4. Fixed 2 test-code panics (manual `close` of channel already closed by mock `KillGraceful`).

**Consequences:**
- `CloseTab` now has a single cleanup path: `DeleteTab` → `DeleteBlock` → event → `DestroyBlockController`
- `ShellProc.Close()` is idempotent; any future code path that calls it twice is safe
- 14 unit tests pass under `-race`

## 2026-05-12: Secret Store — Keep

**Decision:** Keep the secret store infrastructure; it's not AI-specific.

**Context:** The secret store (`pkg/secretstore/`) is an encrypted key-value store backed by the OS keychain. It has three consumers:
1. **AI API tokens** (`ai:apitokensecretname`) — going away with AI removal
2. **SSH password auth** (`ssh:passwordsecretname`) — stays, useful for password-authenticated hosts
3. **Wave App Store** — stays, general-purpose

**Consequences:**
- Remove `ai:apitokensecretname` field from `ConnKeywords` as part of AI cleanup
- Keep `pkg/secretstore/`, `wsh secret` CLI, and `ssh:passwordsecretname` intact
- Lightweight general infrastructure; useful for future features (e.g., file transfer credentials)

## 2026-05-15: Claude Code Shell Integration — Analysis for Future Pi Agent Support

**Finding:** Wave Terminal's Claude Code detection is built on top of a generic **shell integration protocol** (OSC 16162) that could be reused for pi coding agent support.

### How Claude Code Integration Works

| Layer | What it does | Relevant file |
|-------|-------------|---------------|
| **Shell integration protocol** | Custom OSC 16162 sequences injected into shell prompt. Sends command-start (`C`), command-done (`D`), shell-ready (`M`) events via base64-encoded payloads. | `frontend/app/view/term/osc-handlers.ts` |
| **Command detection** | `isClaudeCodeCommand(decodedCmd)` checks if normalized command matches `/^claude\b/`. Also detects `opencode` with similar regex. | `frontend/app/view/term/osc-handlers.ts` |
| **State atoms** | `shellIntegrationStatusAtom` (`"ready" \| "running-command" \| null`) and `claudeCodeActiveAtom` (`boolean`) track terminal state per block. | `frontend/app/view/term/termwrap.ts` |
| **Visual indicator** | `getShellIntegrationIconButton()` in `term-model.ts` reads atoms and renders either generic sparkle icon or `TermClaudeIcon` (Anthropic SVG logo) with status tooltip. | `frontend/app/view/term/term-model.ts` |
| **Telemetry gate** | `checkCommandForTelemetry()` filters out `ssh`, editors (`vim/nano/nvim`), `tail -f`, `claude`, and `opencode` from AI telemetry. | `frontend/app/view/term/osc-handlers.ts` |

### What Was Removed Today

- Sparkle icon + Claude logo from terminal block header (`getShellIntegrationIconButton` now returns `null`)
- All tooltips referencing "Wave AI can run commands"
- The `TermClaudeIcon` import from `term-model.ts`

### What Remains (Dead Code, Phase D Cleanup)

- `claudeCodeActiveAtom` in `termwrap.ts` — still set by OSC handlers, never read
- `shellIntegrationStatusAtom` in `termwrap.ts` — still set by OSC handlers, never read
- `isClaudeCodeCommand()` and `ClaudeCodeRegex` in `osc-handlers.ts` — still execute, results unused
- `TermClaudeIcon` component in `term.tsx` — still exported, never imported
- `checkCommandForTelemetry()` in `osc-handlers.ts` — still runs, telemetry already removed

### Reuse Potential for Pi Coding Agent

**The shell integration protocol itself is valuable** — it gives the terminal real-time awareness of:
- When a command starts / finishes
- What the command line is
- Exit codes
- Shell type and version
- Whether the terminal is in an alternate buffer (e.g., `vim`, `less`)

**For pi integration, we could:**
1. Reuse the same OSC 16162 injection into `.bashrc`/`.zshrc`
2. Add a `piActiveAtom` alongside `claudeCodeActiveAtom` with a `/^pi\b/` regex
3. Show a pi icon in the terminal header when pi is the active command
4. Use command-start/finish events to show "pi is running" status in the UI
5. Use the alternate-buffer detection (`getBlockingCommand`) to suppress pi actions while inside `vim`/`less`/`ssh`

**Key insight:** The protocol is generic AI-agent-agnostic infrastructure. The Claude-specific parts are just a regex (`/^claude\b/`) and an SVG icon. Replacing them with pi equivalents would be trivial if we want this later.

**Decision:** Keep the underlying OSC 16162 shell integration infrastructure intact for now. Only the visual indicator (sparkle/Claude icon) and Wave-AI-specific tooltips were removed. If we want pi agent integration later, we can add `piActiveAtom` and a pi icon with minimal changes.

## 2026-05-20: MOSH Research — Out of Scope

**Decision:** MOSH is not applicable to this fork and is not planned.

**Finding (historical):** MOSH provides seamless reconnection and client-side local echo via UDP, but lacks port forwarding, OSC52 clipboard, scrollback, and file transfer; it is C++-only with slow upstream development. tsshd was noted as a more relevant alternative if roaming ever mattered; durable-session reconnect work supersedes the need for either.

## 2026-05-23: Auto-Reconnect P0 Fixed; Server Reboot → Manual Reconnect

**Decision:** After fixing the three P0 auto-reconnect bugs (cooldown race, reconcile race, singleflight deduplication), we explicitly chose **NOT** to implement auto-restart of fresh shells on server reboot or `wsh` death.

**Why manual reconnect:**
- Auto-restart would change durable-session semantics from *"resume my existing remote shell"* to *"keep a shell open at all costs."*
- Context loss (cwd, env, running processes) is confusing for users who think their old session survived.
- Risk of `wsh` re-install loops after server reboot.
- Cleaner to let the user explicitly click Connect and know it's a fresh session.

**What we did:**
- `ReconnectJob` now correctly detects `JobManagerGone` and marks the job done.
- User sees `[session gone]` in the terminal and clicks Connect to start fresh.

**Future direction (Jeremy's idea):** Tmux auto-restore on reconnect — instead of restarting raw shells, recreate tmux sessions/layouts after server reboot. This preserves tmux's own session persistence while giving WaveTerm visibility into the sessions.

---

## 2026-06-01: CPU Spin Bug — Root Cause & Fix Strategy

**Decision:** Fix the `x/crypto/ssh` drain loop bug locally via `go.mod` replace directive, not by reordering cleanup in waveterm.

**Root cause:** `golang.org/x/crypto@v0.52.0` `ssh/mux.go` and `ssh/channel.go` have drain loops that spin forever when `globalResponses`/`ch.msg` channels are closed. Receiving from a closed channel always succeeds immediately (returns zero value), so `default` case is never reached. Tracked as [golang/go#79658](https://github.com/golang/go/issues/79658).

**Upstream fixes:** Commits 4c4d20b (mux.go) and e3e62d9 (channel.go) on May 27, 2026. Not yet in a tagged release (awaiting v0.53.0).

**Why the reorder workaround (issue #22 commit eb2c659a) was rolled back:**
- Only addressed the cleanup goroutine path, not keepalive monitors or `mux.loop()` exiting independently
- Wake-from-sleep pprof showed 37 spinning goroutines + 37 blocked on Mutex.Lock — reorder can't prevent all
- Original close order (client first) is correct: force-closes transport, unblocking pending `writePacket` calls
- With the mux patch, drain loops exit immediately on closed channels regardless of call order

**Implementation:**
- `local_crypto_patch/contents/` — local copy of `x/crypto v0.52.0` with the 2-line drain loop fix applied
- `go.mod` replace directive: `replace golang.org/x/crypto v0.52.0 => ./local_crypto_patch/contents`
- Rollback plan: when `x/crypto >= v0.53.0` released, remove replace, delete `local_crypto_patch/`, `go mod tidy`

**Consequences:**
- 100% CPU (wifi switch) and 900% CPU (wake from sleep) bugs both resolved
- No additional goroutines or timeouts needed in cleanup path
- Original close order restored (client first, then listener)

---

**Priority order:**
1. Fix auto-reconnect bugs in durable sessions (#4) — DONE 2026-05-23
2. SSH port forwarding (spec ready)
3. Remote file paste (image paste + drag-drop for SSH sessions) — primary use case: pi / Claude Code TUI


---

## 2026-07-08: tmux CWD tracking via `wsh setmeta` (not passthrough, not RPC pull)

**Context:** Inside tmux, shell integration suppresses OSC 7 (cwd tracking) because tmux absorbs escape sequences. `cmd:cwd` goes stale, breaking SCM/file widgets.

**Options considered:**
1. **tmux passthrough** (OSC 7 wrapped in `\ePtmux;...\e\\`) — rejected: requires `allow-passthrough on` in user's tmux config (off by default before tmux 3.3), fragile ESC-doubling, also need to un-gate OSC 16142 markers, version-dependent
2. **Pull RPC** (`TmuxPaneInfoCommand` — frontend queries tmux via wsh) — rejected: needs new wsh RPC (version bump), must probe `$TMUX` in shell env (not wsh env), multi-session disambiguation, only fixes widgets not terminal header
3. **Push via `wsh setmeta`** (shell integration calls `wsh setmeta -b this "cmd:cwd=$PWD"` under tmux) — **CHOSEN**

**Why `wsh setmeta` wins:**
- Uses the existing Unix domain socket RPC — bypasses tmux's pty entirely
- `WAVETERM_BLOCKID` survives into tmux panes (verified live)
- `wsh` is already on PATH in shell integration scripts
- Zero frontend changes, zero new RPC, zero version bump
- Same cadence as OSC 7 (prompt/cd), same consumers (`getFocusedTerminalCwd`, SCM `terminalCwd`, Preview `metaFilePath`)
- Works under screen too (`_waveterm_si_blocked` detects both)

**Decision:** Modify `_waveterm_si_osc7` in all 4 shell scripts (bash, zsh, fish, pwsh) to call `wsh setmeta` when blocked. For bash/pwsh (no chpwd hook), also modify precmd/prompt to call `_waveterm_si_osc7` even when blocked. See [[specs/tmux-cwd-tracking.md]].

## 2026-07-08: Widget keep-alive (hide, not destroy) over serialize-on-toggle

**Context:** Toggling SCM/Preview widgets fully destroys and recreates the block. State is lost (view mode, selected file, diff cache, commit message, in-flight operations).

**Options considered:**
1. **Serialize view-state on dispose, restore on recreate** — rejected: loading flash on every open, in-flight operations (staging/committing) behave incorrectly, diff cache lost
2. **Keep-alive with poll backoff** — **CHOSEN**

**Why keep-alive wins:**
- In-flight operations (staging, committing, pushing) survive — correctness, not just UX
- Diff cache preserved — instant file re-selection
- 30s poll backoff while hidden limits resource cost
- Refresh on show catches up on changes while hidden

**Decision:** Replace `toggleWidgetVisibility`'s `closeNode` (which calls `DeleteBlock`) with `hideNode` (removes from layout, preserves block + ViewModel). Add `onHide()`/`onShow()` to ViewModel interface. See [[specs/widget-keepalive.md]].

## 2026-07-08: tmux CWD tracking — implemented

**Implemented** the `wsh setmeta` approach per [[specs/tmux-cwd-tracking.md]].

**Files modified:**
- `pkg/util/shellutil/shellintegration/bash_bashrc.sh` — `_waveterm_si_osc7` (wsh setmeta when blocked) + `_waveterm_si_precmd` (call osc7 when blocked, skip OSC 16142)
- `pkg/util/shellutil/shellintegration/zsh_zshrc.sh` — `_waveterm_si_osc7` (wsh setmeta when blocked; chpwd hook already calls it directly)
- `pkg/util/shellutil/shellintegration/fish_wavefish.sh` — `_waveterm_si_osc7` (wsh setmeta when blocked; on-variable PWD hook already calls it directly)
- `pkg/util/shellutil/shellintegration/pwsh_wavepwsh.sh` — `_waveterm_si_osc7` (wsh setmeta when blocked) + `_waveterm_si_prompt` (call osc7 when blocked, skip OSC 16142)

**Verification:**
- bash syntax check passes (`bash -n`)
- Go build passes (`go build ./...`) — shell scripts embedded via `//go:embed`
- shellutil tests pass
- zsh/fish/pwsh not installed locally for syntax check, but edits follow existing patterns

**Pending manual testing** (requires running waveterm with the CI-built binary):
- tmux + `cd` → `cmd:cwd` updates via `wsh getmeta -b this`
- screen + `cd` → `cmd:cwd` updates
- non-tmux regression (OSC 7 path unchanged)
- SCM widget shows correct repo under tmux

## 2026-07-08: Widget keep-alive — implemented

**Implemented** the widget keep-alive design per [[specs/widget-keepalive.md]].

**Files modified:**
- `frontend/types/custom.d.ts` — Added `blockId?`, `onHide?()`, `onShow?()` to `ViewModel` interface
- `frontend/app/store/global.ts` — Added `hiddenBlockModels` map + `hiddenBlockIds` set + helper functions (`hideBlockModel`, `getHiddenBlockModel`, `removeHiddenBlockModel`, `isHiddenBlock`, `getHiddenBlockKey`)
- `frontend/layout/lib/layoutModel.ts` — Added `hideNode()` (removes from layout without `DeleteBlock`), `insertExistingNode()` (re-inserts existing block), modified `cleanupOrphanedBlocks` to skip hidden blocks
- `frontend/app/workspace/widgets.tsx` — `toggleWidgetVisibility` now hides (not closes), `handleWidgetSelect` reuses hidden blocks before creating new ones
- `frontend/app/block/block.tsx` — `BlockInner`/`SubBlockInner` cleanup skips `dispose` when `isHiddenBlock(blockId)` is true
- `frontend/app/view/sourcecontrol/sourcecontrol-model.ts` — `onHide()` backs off poll to 30s, `onShow()` restores 3s + immediate `fetchStatus()`
- `frontend/app/view/preview/preview-model.tsx` — `onShow()` bumps `refreshVersion` to trigger re-fetch
- `frontend/app/view/processviewer/processviewer.tsx` — `onHide()` stops polling, `onShow()` restarts polling

**Key design decisions:**
- `hideNode` removes the node from the layout tree but does NOT call `onNodeDelete`/`DeleteBlock` — the block object survives in the backend
- `cleanupOrphanedBlocks` checks `isHiddenBlock(blockId)` to skip hidden blocks (they're in `tab.blockids` but not in the layout tree)
- `BlockInner` cleanup checks `isHiddenBlock(blockId)` — if true, skips `unregisterBlockComponentModel` + `dispose` so the ViewModel survives
- `hiddenBlockModels` keyed by `viewType:connection` — toggling the same widget type for the same connection reuses the hidden block
- `hideBlockModel` is called BEFORE `hideNode` so `isHiddenBlock` returns true when the React cleanup fires
- Tab-close leak: hidden blocks' ViewModels are not disposed if the tab is closed while a widget is hidden (acceptable — 30s poll backoff minimizes resource impact)

## 2026-07-12: wsh startup timeout fix (Layer 1+2) + stream-restart diagnostic logging

### Problem: Durable terminals unresponsive after sleep/wake or network blip

Two failure modes manifest as "terminal stuck, typing doesn't appear, Cmd+Shift+R doesn't help, app restart fixes it":

**Failure mode A — wsh-down zombie (fixed in this change):**
After sleep/wake, the 5s reconnect context (shared across SSH handshake + wsh startup) expires during the wsh retry backoff. `connectInternal` swallowed the wsh failure and marked the conn `Connected` with no route registered. Jobs can't reconnect (`RemoteReconnectToJobManagerCommand` fails — no route), `SendInput` fails, terminal stuck forever (keepalive is pure SSH, reports `Good`). The "always disable wsh" overlay was the tell.

**Failure mode B — Connected-but-no-stream (diagnostic logging added; fix pending):**
wsh/route is up, the job is marked `Connected`, `SendInput` succeeds (typing reaches the remote shell, remote `StreamManager` buffers the echo), but no `runOutputLoop` is pulling the stream — nothing appears locally. Restart re-runs `restartStreaming` → remote replays the buffer → typed text appears.

### Layer 1 fix: Decouple wsh startup timeout from connect context

`connectInternal` now passes a fresh 30s context (`wshStartupTimeout`) to `tryEnableWsh`, independent of the 5s connect context. The 5s context bounds only the SSH handshake (`ConnectToClient`); wsh startup (NewSession, version read, JWT exchange, route registration, retry backoff) gets its own generous timeout.

**File:** `pkg/remote/conncontroller/conncontroller.go` — `connectInternal` (~line 1610)

### Layer 2 fix: Fail the connection on technical wsh failure

`connectInternal` no longer swallows technical wsh failures as "Connected-without-wsh". Only `NoWshCode_Disabled` and `NoWshCode_UserDeclined` (intentional opt-out) continue without wsh. Technical failures (`WshError != nil`) return an error → `Connect` sets `Status_Error` → `closeInternal_withlifecyclelock` cleans up → scheduler retries with a fresh context. This prevents the zombie "Connected-without-route" state.

**File:** `pkg/remote/conncontroller/conncontroller.go` — `connectInternal` wsh result handling (~line 1628)

### Diagnostic logging added (for Layer 3 fix)

Logging was added to confirm which path produces failure mode B (Connected-but-no-stream). All logs use `[job:%s]` or `[conn:%s]` prefixes.

**conncontroller.go:**
- `connectInternal`: logs `ConnectToClient` duration and `tryEnableWsh` duration/result
- `startConnServerWithRetry`: logs ctx remaining time at each attempt (confirms Layer 1 — should show ~30s, not ~5s)

**jobcontroller.go:**
- `jobStreamHealth` map (`streamHealthInfo`): tracks per-job `active`, `startedAt`, `lastReadAt`, `totalBytes`, `streamId`
- `runOutputLoop`: sets `active=true` on start, updates `lastReadAt`/`totalBytes` on each read, sets `active=false` on exit
- `handleRouteEvent`: logs "route up: set Connected via route event (stream active=%v, streamId=%q) — stream NOT restarted here" — confirms Path 2
- `doReconnectJob` skip path: logs "already connected, skipping reconnect (stream active=%v, lastRead=%v, streamId=%q, totalBytes=%d)" — if `active=false` or `lastRead` is stale, that's the smoking gun
- `doReconnectJob` post-restartStreaming: logs success/failure — "restartStreaming failed after successful reconnect: ... (job left Connected without active stream)" confirms Path 1

### Layer 3 hypothesis (pending log confirmation)

Failure mode B has two paths, both leaving the job `Connected` with no active `runOutputLoop`:

**Path 1 — `doReconnectJob` sets `Connected` before `restartStreaming` succeeds:**
`doReconnectJob` calls `SetJobConnStatus(Connected)` then `restartStreaming`. If `restartStreaming` fails (PrepareConnect timeout, StartStream failure, route-not-ready), the job stays `Connected`-no-stream. Every subsequent `doReconnectJob` hits the "already connected, skipping" early return — the stream is never retried.

**Path 2 — `handleRouteUpEvent` sets `Connected` without restarting the stream:**
When the job's route re-registers independently of `doReconnectJob`, `handleRouteEvent` marks the job `Connected` and fires a status event but never calls `restartStreaming`. Later `doReconnectJob` calls skip (already connected).

**Planned Layer 3 fixes (apply after logs confirm which path fires):**
1. Move `SetJobConnStatus(Connected)` to after `restartStreaming` succeeds, or reset to `Disconnected` on failure
2. Make the "already connected, skipping" guard stream-health-aware: if `jobStreamHealth.active == false`, don't skip — restart the stream
3. `handleRouteUpEvent`: either don't mark `Connected` without a stream, or trigger `restartStreaming` when marking `Connected`
4. (Optional) Stream-health watchdog in `runOutputLoop`: if no data for N seconds while `Connected`, trigger `restartStreaming`

### How to read the logs

After a sleep/wake cycle where the terminal is stuck, grep the backend logs for:
```
grep "already connected, skipping reconnect" <log>
grep "route up: set Connected via route event" <log>
grep "restartStreaming failed" <log>
grep "output loop started\|output loop finished" <log>
```
- If "already connected, skipping" shows `active=false` → Path 1 (stream never started or died)
- If "route up: set Connected via route event" fires but no "output loop started" follows → Path 2
- If "restartStreaming failed" appears → Path 1 confirmed (restartStreaming error)
- If "output loop started" appears but no "output loop finished" and no new "started" on reconnect → stream is alive but stalled (watchdog needed)

## 2026-07-15: Widget 'x' button keep-alive hide (SCM/Files widgets)

**Decision:** The header 'x' (close) button now hides keep-alive widget views (`preview`, `sourcecontrol`, `sysinfo`, `processviewer`) instead of deleting them, matching the widget sidebar toggle behavior.

**Context:** Previously the sidebar widget button toggled these views (hide/keep-alive via `hideNode` + hidden block registry), but the header 'x' button called `uxCloseBlock` (true delete). Users had no consistent way to hide-and-revive from the header.

**Implementation:**
- `app/store/global.ts`: added `keepAliveWidgetViews` set, `isKeepAliveWidgetView()`, and `hideBlockKeepAlive(blockId)` (mirrors `toggleWidgetVisibility`: calls `viewModel.onHide`, stashes in hidden registry, `layoutModel.hideNode`).
- `app/block/blockframe-header.tsx`: 'x' button now calls `hideBlockKeepAlive(blockId)`; falls back to `uxCloseBlock` for non-keep-alive views. Tooltip shows "Hide" for keep-alive views, "Close" otherwise.
- `app/workspace/widgets.tsx`: replaced local `TOGGLE_WIDGETS` array with shared `isKeepAliveWidgetView()` so sidebar and header stay in sync.
- The cog-menu "Close Block" still calls `uxCloseBlock` (true delete) so users can still permanently close a widget.

**Consequences:**
- Hiding the last block in a tab leaves an empty tab (same as sidebar toggle; no auto-close). Consistent with existing behavior.
- Re-show via sidebar button restores the hidden block (keep-alive registry keyed by `viewType:connection`).

## 2026-07-15: Widget header dropdown + nav icons + SCM diff cache fix

**Three follow-up changes to the widget header UX:**

### A. Directory dropdown: browse-then-OK UX (`app/element/directorydropdown.tsx` + `.scss`)
Previously clicking a directory in `DirectoryDropdown` immediately called `onSelect(path)`, navigating the main view AND reloading the dropdown — clunky. Refactored so the dropdown keeps a local `browsePath` state:
- Clicking a directory updates `browsePath` locally (reloads entries); the main view does NOT refresh.
- A breadcrumb header at the top shows the current browse path with an up-arrow (parent) button.
- An **OK** button at the bottom commits the selection (`onSelect(browsePath)` + `onClose()`).
- Click-outside still closes without committing (discard).
- The selected entry is highlighted with a blue left accent (`.selected`).
- Layout restructured: breadcrumb (pinned) + scrollable list + OK footer (pinned), so the OK button is always visible.
- `currentPathRef` (unused) removed. API (`DirectoryDropdownProps`) unchanged — callers need no changes.
- Applies to both Files and SCM widgets (shared component).

### B. Home / cwd header icons (`preview-model.tsx`, `sourcecontrol-model.ts`)
With 'x' now hiding (keep-alive) instead of deleting, reopening a widget restores the old directory, so there's no quick "reset" path. Added header end-icon buttons:
- **Files widget** (`preview-model.tsx`): prepended `navIconButtons` (Home → `goHistory("~")`, Terminal → `goHistory(getFocusedTerminalCwd() ?? "~")`) to all three non-null `endIconButtons` branches (directory, markdown, other-file).
- **SCM widget** (`sourcecontrol-model.ts`): added an `endIconButtons` atom returning a single "Go to Terminal Directory" button calling `changeDirectory(null)` (resets the user-cwd override to follow the focused terminal). No Home icon for SCM (Home is rarely a git repo).

### C. SCM diff-view refresh bug (`sourcecontrol-model.ts`, `sourcecontrol.tsx`)
**Bug:** In Review mode, switching directories via the dropdown returned stale diffs because `getDiffCacheKey()` didn't include `cwd`, and `handleDirectorySelect` didn't clear the diff cache or exit review mode.
**Fix:**
- `getDiffCacheKey()` now includes `cwd` (defense-in-depth): `` `${cwd}|${path}|...` ``
- Added `userCwdAtom` as a class field (was a constructor-local closure) so it can be reset.
- Added `changeDirectory(newPath)` model method: sets cwd (or resets `userCwdAtom` to null), closes dropdown, clears `selectedFileAtom`/`diffAtom`/`diffCacheAtom`, exits review mode, re-fetches status.
- `handleDirectorySelect` in `sourcecontrol.tsx` now delegates to `model.changeDirectory(path)`.

**Files changed:** `app/element/directorydropdown.tsx`, `app/element/directorydropdown.scss`, `app/view/preview/preview-model.tsx`, `app/view/sourcecontrol/sourcecontrol-model.ts`, `app/view/sourcecontrol/sourcecontrol.tsx`.

## 2026-07-17: Runtime auth-prompt tracking for auto-reconnect eligibility (`CanReconnectWithoutPrompt`)

**Decision:** Replaced the config-only `needsInteractiveAuth` / `canAutoReconnectLocked` / `NeedsInteractiveAuth` trio with a runtime `authPromptState` flag on `SSHConn`, backed by an `AuthTracker` that observes which auth methods fired during the SSH handshake. A `~/.ssh/config` publickey fallback (`HasPublicKeyAuth`) covers cold starts.

**Root cause of the reconnect bug:** The three eligibility functions inspected only `connections.json` (which for key-based connections contains just `conn:wshenabled`), never checking `~/.ssh/config` (where `IdentityFile`, `PubkeyAuthentication`, etc. are merged at connect time in `ConnectToClient`). They defaulted to "password/kbd-interactive enabled" → returned `true` (interactive auth needed) → `HandleSystemResume` skipped fast-path reconnect and `onConnectionDown` skipped the scheduler. Key-based connections (like `jeremy@dev2.jlam.io`) could never auto-reconnect after sleep/wake.

**Implementation:**

- **`AuthTracker`** (replaces `PasswordUsedTracker`) in `sshclient.go`: tracks `PasswordFromPrompt` (user-typed password, not secret/cache), `PassphrasePrompted` (key passphrase), `KbdInteractiveUsed` (keyboard-interactive). `InteractivePromptUsed()` returns true if any fired. Replayable credentials (secret-store password, cached password, unencrypted key, agent key) do NOT set these — only live user prompts do.
- **`SSHConn.authPromptState`** (`atomic.Int32`): set to `authPromptNone` (no prompt) or `authPromptUsed` (prompt needed) after a successful `ConnectToClient`. Cleared to `authPromptUnknown` on `auth-failed`. Checked by `canReconnectWithoutPromptLocked`.
- **`CanReconnectWithoutPrompt(connName)`** (single source of truth): decision order — cached password → auth-failed (skip) → runtime flag (none/used) → config fallback. Used by `onConnectionDown`, `HandleSystemResume`, `DeriveConnStatus` (UI `CanAutoReconnect`), and `needsInteractiveAuth` (jobcontroller).
- **`HasPublicKeyAuth(host)`** in `sshclient.go`: reads `~/.ssh/config` for PubkeyAuthentication enabled, publickey in PreferredAuthentications, and at least one IdentityFile that exists on disk. The existence check is critical — `ssh_config` returns default identity files even when none are configured.
- **`NeedsInteractiveAuth`** (startup reconnect) is intentionally conservative: only trusts the runtime flag + cached password, NOT the publickey fallback, because a configured key may be passphrase-encrypted. Gives a no-deadline context for the startup connect.
- **`sshConfigMu`** (`sync.Mutex`): serializes `findSshConfigKeywords` calls because the `ssh_config` library's `ReloadConfigs`/`doLoadConfigs` is not thread-safe. Fixes a latent race exposed by the fallback path calling it from `DeriveConnStatus` (hot path).

**Why runtime flag over config inspection:** Config inspection can't distinguish passphrase-encrypted keys from unencrypted ones, revoked keys, or agent-only auth. The runtime flag observes what actually happened during the handshake. The config fallback only covers the never-connected case (cold start, post-auth-failed).

**Why not just the flag:** The flag is in-memory on `SSHConn`, lost on app restart. Before the first successful connect (or after auth-failed clears it), the config fallback ensures key-based connections still get auto-reconnect.

**Files changed:** `pkg/remote/sshclient.go` (AuthTracker, HasPublicKeyAuth, sshConfigMu), `pkg/remote/conncontroller/conncontroller.go` (authPromptState, CanReconnectWithoutPrompt, canReconnectFromKeywordsOrPubkey, connKeywordsAllowReconnect, hasPublicKeyAuthForConn, rewritten canAutoReconnectLocked/NeedsInteractiveAuth), `pkg/jobcontroller/jobcontroller.go` (needsInteractiveAuth delegates to CanReconnectWithoutPrompt), tests in `sshclient_test.go`/`conncontroller_test.go`/`jobcontroller_test.go`.

## 2026-07-18: Job reconnect convergence & bounded retry (Phase 2E)

**Decision:** `onConnectionUp` and `ReconnectJobsForConn` shared a single 5s `context.WithTimeout` across all jobs on a connection. On a slow link (cellular + WireGuard, 21.9s scheduler wait), one job's 5s `RemoteReconnectToJobManagerCommand` RPC consumed the shared ctx, starving jobs 2/3 (`DBMustGet` hit `context deadline exceeded` before they could send their RPC). The conn stayed `Connected` (green icon) while jobs stayed `Disconnected` — `SendInput` rejected with `job is not connected`. Recovery required a manual tab switch.

**Root cause:** local-side contention, not remote latency. The remote wsh responds in <1s once settled (solo tab-switch reconnect confirmed 0.7s); 3 jobs hitting a fresh channel simultaneously contended on teardown.

**Fix (spec: `.pi/specs/reconnection.md` § Phase 2E):**

1. **Per-job ctx** — `onConnectionUp`/`ReconnectJobsForConn` use a 5s ctx for `DBGetAllObjsByType` only; each `ReconnectJob` call gets a fresh `context.WithTimeout(background, 10s)`. Eliminates starvation.
2. **Bounded retry** — if `successCount < len(jobsToReconnect)`, retry failed jobs 3× at 3s/6s/12s backoff. Per attempt: re-check `IsConnected` (abort on conn-down), skip `JobManagerStatus == Done`, stream-health-aware skip. Recovers the train case in ~8s on attempt 2.
3. **Convergence invariant** (new, documented in spec): after a conn reaches `Connected`, every job reaches `Connected` or `Done` — never silently stuck `Disconnected`.
4. **`rpcOpts.Timeout` stays 5000** — raising it would trade snappiness for a rare slow case the retry already handles.

**Files changed:** `pkg/jobcontroller/jobcontroller.go` (`onConnectionUp`, `ReconnectJobsForConn`).

**Detection:** grep `finished reconnecting jobs: 0/N` with no retry = regression. `SendInput` failing with `job is not connected` after a sleep/wake = the bug.

## 2026-07-18: Startup-failed connection retry (Phase 2F)

**Decision:** `StartupReconnectDurableShells` was one-shot — `EnsureConnection` failure at app start left the conn in `Status_Error` forever. The ongoing reconnect scheduler (`scheduleConnectionReconnect`) only starts via `onConnectionDown`, which requires a Connected→Disconnected transition; a conn that was never Connected never produces that transition (`handleConnChangeEvent` doesn't increment `actualGen` when `Connected` stays `false`), so the scheduler never starts.

**Fix (spec: `.pi/specs/reconnection.md` § Phase 2F):** Exported `StartConnectionReconnectScheduler(connName)` in `jobcontroller` — starts `scheduleConnectionReconnect` (5s interval, 5min cap, aggressive mode) for a startup-failed conn. Called from `blockcontroller.StartupReconnectDurableShells` on `EnsureConnection` failure. Non-interactive-auth only (interactive-auth conns have `requestPasswordRePrompt` for retries; the scheduler would race it). Reuses the existing scheduler via shared `startReconnectScheduler` helper (extracted from `onConnectionDown`); dedup via `connectionReconnectSchedulers` ensures no double-spawn if a real disconnect happens later.

**Files changed:** `pkg/jobcontroller/jobcontroller.go` (`startReconnectScheduler`, `StartConnectionReconnectScheduler`, `needsInteractiveAuthTestHook`), `pkg/blockcontroller/blockcontroller.go` (`StartupReconnectDurableShells` calls `StartConnectionReconnectScheduler` on failure), `pkg/jobcontroller/jobcontroller_test.go` (4 tests).

**Detection:** `starting reconnect scheduler after startup failure` in log after `failed to establish connection` at app start.

## 2026-07-21: Resume-from-sleep: terminal "connected but typing invisible" (Phase 2G — diagnosis)

**Symptom:** After laptop sleep/wake, a durable remote terminal block shows "connected" but typing produces no visible output. The keystrokes ARE sent (visible after app restart, which rebuilds the terminal from WaveFS). Devtools shows `[PW-CONN] connected` and `setFocusedChild`.

**Root cause (frontend rendering, NOT backend stream):** The backend reconnection is fully successful — all 4 jobs reconnect, `restartStreaming` runs, new output loops start, data appends to WaveFS. The bug is in the **frontend xterm.js renderer pause state**.

xterm.js `RenderService` (`@xterm/xterm` 6.1.0-beta) gates every render behind `_isPaused`:
- `RenderService.refreshRows()` (src/browser/services/RenderService.ts:156) early-returns when `_isPaused` is true (`_needsFullRefresh = true; return`).
- `_isPaused` is set/cleared only by `_handleIntersectionChange` (the `IntersectionObserver` callback, line 140) — `true` when the terminal element is NOT intersecting the viewport (background tab/split).
- After OS sleep/wake, Chromium's `IntersectionObserver` often does **not** re-fire (the element's intersection didn't change — it was visible before suspend and visible after). So `_isPaused` stays stuck at its pre-sleep value.

The existing fix (commit `9aacb9e7` "fix: restore terminal rendering after system sleep/resume") added `refreshAfterVisibilityChange()` in `frontend/app/view/term/termwrap.ts:787`, triggered by `document.visibilitychange`. But it only calls `renderer.renderRows(0, rows-1)` directly (bypassing the `_isPaused` gate) — a **one-shot** render of the current buffer. It does **NOT** reset `core._renderService._isPaused` to `false`. So:
- The pre-sleep buffer content IS rendered (one-shot) → terminal looks "connected" with old content.
- But subsequent `terminal.write()` calls (from `handleNewFileSubjectData` → `doTerminalWrite`) trigger `RenderService.refreshRows()`, which still early-returns because `_isPaused` is still `true`.
- New output (echoed keystrokes) is written to xterm.js's internal buffer but never rendered to the canvas → typing invisible.
- After app restart, `loadInitialTerminalData` rebuilds the terminal from WaveFS (which has all the data) → everything visible.

**Evidence:**
- Commit `9aacb9e7` message explicitly describes this: "leaving `_isPaused=true` and deferring all `refreshRows()` calls. This corrupts the canvas display while the underlying terminal buffer remains intact."
- xterm.js source confirms `refreshRows` early-returns on `_isPaused` and only `_handleIntersectionChange` clears it.
- Backend log (10:39:26) shows the new output loop (stream `6f007fa3`) started successfully; data path is intact.

**Proposed fix (NOT yet implemented — awaiting approval):** In `refreshAfterVisibilityChange`, reset `_isPaused` before rendering:
```ts
const core = (this.terminal as any)._core;
const renderService = core?._renderService;
if (renderService) {
    renderService._isPaused = false;   // unpause — IntersectionObserver may not fire after sleep
    renderService.refreshRows(0, this.terminal.rows - 1);  // full refresh via the normal path
} else {
    // fallback to the existing direct-render path
    const renderer = core?._renderService?._renderer?.value;
    if (renderer && typeof renderer.renderRows === "function") {
        renderer.renderRows(0, this.terminal.rows - 1);
    }
}
this.fitAddon.fit();
```
This uses the same private-API access pattern already in the file (`core._renderService._renderer.value`). Calling `refreshRows` (not `renderer.renderRows`) ensures the render debouncer and `_needsFullRefresh` are handled correctly, and future `terminal.write()` calls render normally because `_isPaused` is now `false`.

**Secondary finding (backend goroutine leak, separate bug):** `runOutputLoop` goroutines never exit. Across the 10k-line log: **85 "output loop started"**, **0 "output loop finished"**, **0 "superseded"**. `onConnectionDown` does NOT close old stream readers; `restartStreaming` overwrites `jobStreamIds` but leaves the old reader blocked on `reader.Read()` forever (the old streamId never receives data after the new stream starts, so `Read()` never returns, so the supersession check never runs). Each reconnect leaks one goroutine + one broker reader per job. This is a resource leak but does NOT cause the "typing invisible" symptom (the new stream's reader receives data correctly — `processRecvData` keys by streamId). Worth a separate fix (close old reader / cancel old output loop on conn-down or before starting a new stream in `restartStreaming`).

**Files to change (Phase 2G):** `frontend/app/view/term/termwrap.ts` (`refreshAfterVisibilityChange`).
**Files to change (leak fix, separate):** `pkg/jobcontroller/jobcontroller.go` (`onConnectionDown` / `restartStreaming` — close old reader).

## 2026-07-21: Output-loop goroutine leak fix (Phase 2H)

**Decision:** `runOutputLoop` goroutines never exited on reconnect (85 started, 0 finished, 0 superseded in the log). Each `restartStreaming` call created a new `streamclient.Reader` (new streamId) but left the old reader blocked on `Read()` forever — the old streamId never receives data after the new stream starts, so `Read()` never returns, and the supersession check (which runs after `Read()`) never fires.

**Fix:** Added `jobReaders` (`ds.MakeSyncMap[*streamclient.Reader]`) to track the active reader per job. In `restartStreaming`, after creating the new reader and setting `jobStreamIds` to the new streamId, close the previous reader (`prevReader.Close()`). This unblocks the old `runOutputLoop`'s `Read()` (returns `io.ErrClosedPipe`), the supersession check sees the new streamId, and the loop exits cleanly ("stream superseded by [new]"). `Reader.Close()` is idempotent (safe to call on an already-closed reader — the `runOutputLoop` defer also calls it).

**Ordering invariant:** `jobStreamIds.Set(newId)` MUST happen before `prevReader.Close()` so the supersession check sees the new streamId. If closed before the update, the old loop would hit the error path (`tryTerminateJobManager`) instead of the supersession path.

**Files changed:** `pkg/jobcontroller/jobcontroller.go` (`jobReaders` map, `StartJob` stores reader, `restartStreaming` closes prev reader), `pkg/jobcontroller/jobcontroller_test.go` (2 tests: `TestRunOutputLoopExitsOnReaderCloseWithSupersession`, `TestRestartStreamingClosesPrevReader`).

**Detection:** `grep "output loop finished" <log>` should now show entries (was 0 before). `grep "stream superseded"` should show the supersession exits.

## 2026-07-21: New-Tab Connection Dropdown — typeahead + frecency sort

**Context:** The `+ New Tab` connection dropdown (`connectiondropdown.tsx`) was a bare static list with non-deterministic backend ordering (Go map iteration), no keyboard filtering, no Edit Connections, and `Cmd-t` bypassed it entirely. The block-header dropdown (`conntypeahead.tsx`) had a typeahead but sorted only by `display:order` and included a Disconnect item.

**Decisions:**

1. **Sort = frecency** (Raycast/Alfred-style): `score = connectCount × exp(-ageDays/14)`, tie-break `display:order` → name. Half-life 14 days. Both dropdowns use the same ranking via a shared `conn-suggestions.ts` module.
2. **Persist `ConnectCount`** in `connections.json` (`conn:connectcount`) so frecency accumulates across restarts. `LastConnectTime` stays in-memory (avoids stale-timestamp edge case; re-populates on first reconnect).
3. **`Cmd-t` opens the dropdown** via a global `newTabDropdownOpenAtom` (in `global-atoms.ts`), replacing the direct `createTab()` call.
4. **New Connection fallback** when filter matches nothing, but **not highlighted by default** — user must explicitly arrow-down to it before Enter can create. Prevents accidental creates from fast typing.
5. **Edit Connections** added to `+` dropdown (opens `connections.json` in current tab); **removed** from block-header dropdown.
6. **Disconnect** item removed from block-header dropdown. **Reconnect** kept (block-specific, for disconnected durable sessions).
7. **Filter is case-insensitive** in both dropdowns (block-header was case-sensitive; fixed via shared module).
8. **`TypeAheadModal` not reused for new-tab** — it portals into a `blockRef` and positions relative to a block, which doesn't exist in the tab bar. New `NewTabConnTypeahead` portals to `document.body` and anchors to the `+` button ref.

See [[specs/newtab-connect-dropdown.md]] for full spec.

**Focus fix (prerequisite, shipped):** `frontend/app/view/term/term.tsx` — `wasFocused` guard removed the dead `termRef.current != null` check so the post-init `giveFocus()` fires on first terminal mount (commit `1aa02211`).

## 2026-07-23: Disk-backed stream history & backpressure break

**Decision:** When the network drops, the remote `StreamManager` stays in connected/sync mode (64KB `CwndSize`). No ACKs arrive → `senderLoop` blocks → `readLoop` blocks → PTY kernel buffer fills → pi's `write()` blocks → pi freezes. Fixed with a two-part approach: (A) break backpressure via `SendData` error + 5s timeout → `handleSendFailure` → `ClientDisconnected` + `activateDiskBuffering`; (B) disk-backed history with `drainDiskToCirBuf` — PTY output is buffered to a disk file (`<jobid>.stream`) during disconnect and replayed on reconnect.

**Files changed:** `pkg/jobmanager/streammanager.go` (handleSendFailure, activateDiskBuffering, drainDiskToCirBuf, ClientConnected bounds expansion, terminal-packet deferral), `pkg/jobmanager/cirbuf.go` (SetTotalSize), `pkg/jobmanager/mainserverconn.go` (SendData returns error, SendDataTimeout), `pkg/jobmanager/jobmanager.go` (SetupJobManager cleans stale .stream files), `pkg/jobmanager/streammanager_test.go` (full test suite). Spec: [[specs/disk-backed-stream-history.md]]. Commits: `cf039928`, `953a4961`, `b8090029`.

## 2026-07-23: CloseInvoluntary — preserve cached password on involuntary disconnect

**Decision:** `disconnectOnStall` (stall auto-disconnect) and `HandleSystemResume` (sleep/wake) called `Close()`, which unconditionally cleared the cached password. An involuntary network drop wiped the cache, forcing a re-prompt. Refactored `Close()` into `closeInternal(clearPassword bool)`: `Close()` clears the cache (explicit disconnect), `CloseInvoluntary()` preserves it (stall, sleep/wake). `authPromptState` is preserved in both cases (only `auth-failed` resets it).

**Files changed:** `pkg/remote/conncontroller/conncontroller.go` (closeInternal, CloseInvoluntary), `pkg/remote/conncontroller/connmonitor.go` (disconnectOnStall → CloseInvoluntary), `pkg/jobcontroller/jobcontroller.go` (HandleSystemResume → CloseInvoluntary), `pkg/remote/conncontroller/conncontroller_test.go` (3 tests). Commit: `402acb77` (tests: `8f9c0a67`). See [[reconnection.md]] Phase 2K.

## 2026-07-23: Visibility-driven reconnect (tab switch / app focus)

**Decision:** No trigger re-established a disconnected connection when the user's attention returned. Added `VisibilityReconnectHandler` (frontend, `visibilityreconnect.tsx`) — a side-effect-only React component mounted in `WorkspaceElem` that fires `ConnEnsureCommand` for disconnected/error connections on the active tab when the user switches tabs or focuses the app. Debounced 200ms. Skips local/WSL, connected, connecting, and connections with an active password prompt. Backend `EnsureConnection` is idempotent + cooldown-guarded; `Connect()` is serialized by `lifecycleLock`.

**Files changed:** `frontend/app/tab/visibilityreconnect.tsx` (new), `frontend/app/workspace/workspace.tsx` (mounts the handler). Commit: `d519f484`. See [[reconnection.md]] Phase 2I, [[visibility-driven-reconnect.md]] Change 3.

## 2026-07-23: Per-window password prompt serialization

**Decision:** When visibility-driven reconnect fires `EnsureConnection` for multiple disconnected password-connections on the same tab, all prompts rendered simultaneously. Added `windowPromptLocks` (`pkg/userinput/userinput.go`) — a per-window mutex that serializes SSH auth prompts (password, keyboard-interactive, passphrase). Only one prompt is shown at a time per window. Cached-password and publickey connections skip the lock (no `GetUserInput` call). Non-auth prompts (confirm dialogs) are never serialized.

**Files changed:** `pkg/userinput/userinput.go` (windowPromptLocks, acquireWindowPromptLock, isSSHAuthPrompt). Commit: `98bbd632`. See [[reconnection.md]] Phase 2J, [[visibility-driven-reconnect.md]] Change 4.

## 2026-07-23: Scheduler tuning — silent cap + early-terminate

**Decision:** (1) Added `ConnReconnectMaxDurationSilent` (15min) for silently-reconnectable connections (key-based / cached password) — silent retries are cheap. Interactive-attempt connections keep the 5min cap. (2) Early-terminate the scheduler on `auth-failed` (server rejecting credentials — retrying won't help, `requestPasswordRePrompt` handles re-prompting) and `connection-refused` (server not accepting SSH — visibility-driven reconnect will retry on next tab switch). Network-unreachable errors continue to retry with aggressive mode unchanged.

**Files changed:** `pkg/jobcontroller/jobcontroller.go` (constants, scheduleConnectionReconnect). Commit: `fd78d03a`. See [[reconnection.md]] Phase 2L, [[visibility-driven-reconnect.md]] Change 5.

## 2026-07-24: Reconnection UX P0 product decisions (D1–D6)

**Context:** Production-ready reconnection UX for remote-first workflows. Spec: [[specs/reconnection-ux-backlog.md]] (UX-0.1 … UX-0.5).

| ID | Decision |
|----|----------|
| **D1** | After user Disconnect, visibility reconnect must **not** auto-connect — require explicit Reconnect. Implemented via sticky `SSHConn.SuppressAutoReconnect` set only by `Close()` / `ConnDisconnectCommand`. |
| **D2** | Stop auto-retry **keeps** password cache; Disconnect **clears** it. `PauseAutoReconnect()` vs `Close()`. |
| **D3** | Password Cancel is sticky until **manual Reconnect** (not timed cool-down). Connect failure with `user-cancelled` sets `SuppressAutoReconnect`. |
| **D4** | Attention heartbeat default **30s**; **10s** when last error was network/dial-unreachable. Frontend hybrid in `VisibilityReconnectHandler`. |
| **D5** | Heartbeat may call `EnsureConnection` for interactive (no cache) when tab **visible** (prompt OK if user present). |
| **D6** | `JobManagerGone`: **no** auto-start new shell; one-click **Start new durable session** CTA only (`forceRestartController`). |

**Also:**
- Permanent handshake failures (`remote.IsPermanentConnError`: host-key, known_hosts, config) stop scheduler + set suppress; overlay shows dedicated copy (UX-0.4).
- New RPC `ConnStopAutoRetryCommand` for Stop auto-retry UI control (UX-0.5).
- Job-level overlay when `conn.status === connected` but durable job is reconnecting / failed / gone (UX-0.2).

**Key files:** `pkg/remote/conncontroller/conncontroller.go`, `pkg/jobcontroller/jobcontroller.go`, `pkg/remote/sshclient.go`, `pkg/wshrpc/wshserver/wshserver.go`, `frontend/app/tab/visibilityreconnect.tsx`, `frontend/app/block/connstatusoverlay.tsx`.

## 2026-07-24: Password cache and suppress classification

**Decision:**

1. **`userAbortConnect` is per-connection** — Stop/Cancel on host A must not abort host B.
2. **Sticky suppress** only for real user Stop/Cancel (or permanent host-key errors), **never** for scheduler/`EnsureConnection` parent-context timeouts.
3. **Cached password + `authPromptState`** cleared only on **true credential rejection** (`ssh: unable to authenticate`). Transport failures (`handshake failed`, EOF, reset, dial timeout) preserve cache so reconnect is silent when the network returns.
4. **Involuntary disconnect** still uses `CloseInvoluntary` (preserve cache); user Disconnect uses `Close` (clear cache + suppress).
5. **Frecency `ConnectCount`** increments on `CreateTab` (`RecordConnectionUsage`), not on every SSH `Connect` (avoids password re-auth and durable reconnect inflating rank).

**Commits:** `c6540dbb`, `f86644ed`, `c9f2e782`, `73349acd`, `50f3e3e8`. Branch: `feat/reconnect-ux-p0`.

## 2026-07-25: Soft network readiness gates (backlog, not implementing now)

**Decision:** Capture soft gates before automatic TCP dial as **later work** (UX-2.8 in [[specs/reconnection-ux-backlog.md]]), not part of the current P0 land.

**Intent:** Do not assume the network is ready at connect time. Optional Wave-side checks before an automatic dial:

1. Local interface/route (and similar) — no outbound traffic.  
2. DNS with an explicit short timeout when the connection host is **not** a literal IP — stall/timeout usually means the network is flaky or not ready; backoff. Skip DNS for IP literals.  
3. Optional TCP probe with a short timeout (value TBD).

Gates are soft (delay/retry, user Connect can bypass). They do not prove the SSH host is up, do not replace path-failure retries, and do not alone solve Little Snitch (outbound checks from Wave stall while LS is pending).

**Related open discussion:** draft soft-cancel of long `connecting` attempts vs gates + dial retry policy — not settled for ship.

## 2026-07-24: Soft-cancel stale connecting (Little Snitch / firewall race)

**Context:** Opening a new unsigned build triggers Little Snitch “binary changed.” While that modal is up, app network is blocked. UI-driven `ConnEnsure` starts dials that hang in `Status_Connecting` (up to `DefaultConnectionTimeout` = 60s). Visibility reconnect **skipped** connecting hosts, so after the user allowed the binary the hung dial kept running and password prompts only appeared after it failed — felt like “connection is trying, no password until it fails.” Key-based hosts auto-retried more quietly so the race was less noticeable.

**Decision:**

1. **Soft-cancel ≠ user Stop.** `softCancelInFlightConnect` cancels the in-flight connect context **without** setting `userAbortConnect` or `SuppressAutoReconnect`. Distinct from `AbortConnect` / `PauseAutoReconnect`.
2. **Stale threshold = 8s** of `Status_Connecting` with no active password/passphrase/kbd prompt (`userinput.HasActiveAuthPromptForConn`). Never kill an on-screen auth dialog.
3. **`EnsureConnection` owns the retry:** on stale connecting → soft-cancel → wait for lifecycle unlock → fresh `Connect`. Fresh connecting still uses `WaitForConnect`.
4. **Visibility Ensures while connecting** (no longer skip); heartbeat **5s** while any eligible conn is connecting so focus after LS can hit the soft-cancel path within one interval after the 8s threshold.
5. **Auth method order:** prefer `password`/`keyboard-interactive` before `publickey` when `authPromptUsed`, or when state is unknown and no publickey is configured (password-only cold start).

**Files:** `pkg/remote/conncontroller/conncontroller.go`, `pkg/userinput/userinput.go`, `frontend/app/tab/visibilityreconnect.tsx`, unit tests in `conncontroller_test.go` / `userinput_test.go`.

**Not changed:** global dial timeout stays 60s for slow networks; soft-cancel is attention-driven (Ensure on focus/heartbeat), not a shorter hard dial timeout.

## 2026-08-16: Reconnect Stream recovery RPC + stream-wedge instrumentation

**Context:** A terminal block can appear "connected" while its output stream is wedged — a flow-control/ACK deadlock or seq drift between the remote `StreamManager` and the backend `Reader`. Input keeps working, the SSH connection stays healthy (keepalives pass), and a frontend tab reload can't help because no new bytes reach the WaveFS term file. The existing `JobControllerReconnectJobCommand` can't recover it either, since `doReconnectJob` skips jobs it considers "already connected".

**Decision:**

1. Add `blockrestartstream` RPC (`BlockRestartStreamCommand(blockId)`) that calls `restartStreaming` directly for the block's job, bypassing the "already connected" guard. This re-handshakes seq/ACK and starts a fresh output loop without reconnecting SSH or killing the durable shell.
2. Surface it in the term block **Advanced** context menu as **"Reconnect Stream"**.
3. Add low-noise instrumentation to localize the wedge:
   - remote `StreamManager`: `stallWatchdog` (logs full flow-control state when unacked data has no ACK for >10s) plus rate-limited `RecvAck` rejection logs (`stale` / `seq-behind-head` / `ack-exceeds-sent`).
   - backend `streamclient`: rate-limited seq-anomaly logs (dropped / out-of-order packets) and `processSendAck` route-missing / send-error logs.

**Files:** `pkg/jobcontroller/jobcontroller.go`, `pkg/jobmanager/streammanager.go`, `pkg/streamclient/streamreader.go`, `pkg/streamclient/streambroker.go`, `pkg/wshrpc/{wshrpctypes,wshserver,wshclient}`, `frontend/app/store/wshclientapi.ts`, `frontend/app/view/term/term-model.ts`.

**Open:** root cause not yet identified; the instrumentation is intended to capture the exact stuck state on the next occurrence (likely seq drift or an ACK deadlock in the durable-shell stream path).

## 2026-08-16: Files-widget transfer transport — application-layer tar.gz, SSH compression deferred

**Context:** The files widget (preview block in directory mode) transfers files over the WSH RPC protocol, which is JSON text; binary payloads are base64-encoded (`Data64`). The whole-file write/upload path carries a 32 MB cap and ships the entire file as one base64 blob in a single RPC; there is no progress, cancel, or recursive (directory) transfer. We considered enabling SSH channel compression to reclaim base64's ~33% overhead. `golang.org/x/crypto/ssh` (vendored via `local_crypto_patch/contents`) does not implement compression — `supportedCompressions = []string{compressionNone}` — so SSH compression would require implementing the `zlib@openssh.com` codec in the local crypto patch, and it taxes every byte on the connection (terminal traffic included) and gives no benefit on already-compressed files.

**Decision:**

1. **Application-layer compression only.** Use tar.gz streaming on the transfer path for recursive (directory) transfers and bulk multi-file transfers. This compresses only where it helps, doubles as the recursive-transfer mechanism, and leaves the SSH layer untouched.
2. **Do not implement SSH channel compression** (`zlib@openssh.com`) for now. Revisit only if profile data shows base64 overhead on non-archive (single-file) transfers is the bottleneck after window/chunk tuning.
3. **Stream-broker transport for all transfers.** Move upload/write off the whole-file base64 RPC onto the existing stream broker (chunked, ACK flow-controlled, no total-size limit). Progress and cancellation derive from `Writer.GetAckState()` / `Writer.GetCanceledChan()`.
4. **Transparency requirement:** archive/bulk transfers must be surfaced distinctly from single-file transfers (phase: preparing → transferring → extracting, with file count and totals) so users do not expect scp-style per-file appearance.
5. **Hybrid archive strategy:** pre-archive to a temp tar.gz when the tree crosses **either** a size threshold or a file-count threshold (OR-trigger: `totalSize > sizeThreshold` OR `fileCount > fileCountThreshold`), giving a determinate progress bar for large or many-file trees; stream-compress on the fly otherwise (faster start, indeterminate bar). Defaults ~64 MB / ~1,000 files, TBD. Size predicts network time; file count predicts archive/extract syscall time — either can dominate (e.g. `node_modules`-shaped trees).

**Files:** (new) `.pi/specs/files-widget-transfer-engine.md`; code changes tracked there.

## 2026-08-16: wsh Agent API ("Agent Control Fabric") — design decisions

**Decision:** Expose terminal orchestration to AI agents via `wsh`, modeled on tmux, with two execution modes and flat geometry for layout understanding.

**Context:** Agents (pi, Claude Code, Cursor) run inside terminals but can't see/control other blocks, understand spatial layout, configure the app, or prompt the user. tmux is the de-facto standard agents are already trained on, so naming should transfer from tmux (session→workspace, window→tab, pane→block).

**Decisions:**

1. **Two execution modes** — Mode A synchronous (`wsh run --wait --json`, the 90% workhorse: stdout+stderr+exit code+duration) vs Mode B asynchronous tmux-style block control (create / send-keys / capture / status / select / kill).
2. **tmux-transferable naming** — grouped noun forms (`wsh block capture`, `send-keys`, `split`, `select`, `kill`, `rename`) plus top-level tmux aliases (`wsh capture-pane`, `send-keys`, `split-pane`, ...). `termscrollback` → `block capture`.
3. **Flat geometry for v1** — per-block `x/y/w/h` fractions in `block list --json`; raw layout tree deferred. Directional (`--left-of` etc.) + title-substring addressing added to the existing resolver.
4. **Prompt surface** — `wsh prompt` uses a UI modal (works for hidden/background orchestrators); stdin deferred.
5. **Trust gate** — `agent:allowremotelocalcontrol` default **off**; remote-origin `wsh` targeting the `local` connection is rejected unless the user opts in.
6. **`block status`** minimal for v1 (running/exited/exit-code); `--tail` capture (not `--since`) for v1.

**Files:** `.pi/specs/wsh-agent-api.md` (full command reference + 28 test cases).

**Consequences:**
- Build order: Mode A → Mode B → layout → settings → prompt → trust gate.
- Requires new RPCs (geometry, process state, input injection, prompt) and CLI surface; the existing `ResolveIds` resolver already covers most addressing forms (blocknum, `view:N`, `tab:N`, `this`, uuid).

## 2026-08-22: Stream freeze — A1 ACK retry + B2 lock-free recv metadata

**Context:** Recurring "connected but frozen" terminal is a flow-control deadlock: the backend drops a stream ACK after `timeout sending request` (5s wait on bare-client `OutputCh`, cap 32), the remote 64 KB window never advances, and the remote does not probe. Diagnosis: `.pi/stream-freeze-diagnosis.md` (on `odds-and-ends`). Review rejected the diagnosis's "snapshot trust/source at recv-loop start" (loop starts untrusted) and deferred BlockFile coalescing (frontend paints `data64`; dropping chunks corrupts the terminal).

**Decision:** Implement A1 + B2 on `feat/files-widget` (already merged with `odds-and-ends` stream code). Not B1 (snapshot at start), not C1 (drop BlockFile events).

1. **A1 — never drop the last ACK.** On send failure, keep one pending ACK per stream (highest seq + rwnd; Fin/Cancel OR'd). Retry on a short interval. ACK enqueue uses a 10ms fail-fast timeout so the single send worker is not blocked for 5s. Cleanup of the reader happens only after a successful Fin/Cancel send. Missing writer-route ACKs are still dropped (nowhere to send).
2. **B2 — lock-free recv-loop metadata.** `trusted` / `sourceRouteId` / `alive` are atomics, loaded every message. Recv loop no longer takes `router.lock` via `getLinkMeta`. Trust/bind after loop start is still observed. `UnregisterLink` sets `alive=false`.

**Deferred:** B3 (non-blocking `inputCh` send), B4 (per-link sender / don't hold `router.lock` around `SendRpcMessage`), C2 (concatenating BlockFile flush).

**Files:** `pkg/streamclient/streambroker.go`, `pkg/wshutil/wshstreamadapter.go`, `pkg/wshutil/wshrouter.go`, tests in `pkg/streamclient/ack_retry_test.go` and `pkg/wshutil/wshrouter_recvloop_test.go`.

## 2026-08-24: RemoteTerm external rename — external surfaces only, upstream identifiers kept

**Context:** The fork's public identity is **RemoteTerm**. A partial rename had already landed (`package.json` name/productName/appId, `app.setName()`, window titles, About modal, app menu, TERM_PROGRAM). The review spec (`.pi/specs/remoteterm-rename-review.md`) tiered the remaining work: Tier A (user-facing) renames, Tier B (internal/upstream identifiers) kept as-is to preserve clean upstream merges.

**Decision:**

1. **External-only rename.** Rename UI strings, window titles, menus, dialogs, onboarding, packaging metadata, and repo docs. Do NOT rename Go import paths, internal TS identifiers, `WAVETERM_*` env vars, or the on-disk `~/.waveterm` data dir — merge friction and user-data migration risk outweigh branding purity.
2. **GitHub repo renamed** to `github.com/whoisjeremylam/remoteterm`; all docs/links updated. (GitHub redirects the old `waveterm-remote` URL.)
3. **Domain is `remoteterm.io`** (`remoteterm.dev` was taken). `package.json` `homepage` and the About modal "Website" button point at it; the domain is not yet registered — accepted as a temporary dead link. `appId` changed `dev.remoteterm.app` → `io.remoteterm.app` (correct reverse-DNS while install base is small; changes macOS bundle ID / Windows AppUserModelID / Linux desktop file identity).
4. **Upgrade modals suppressed.** `onboarding-upgrade-*` (Wave AI feature history) no longer opens on version bump, and the widgets-bar "Release Notes" entry is removed. Files left on disk unreferenced to avoid upstream delete-conflicts.
5. **Onboarding:** GitHub star links → fork repo; upstream Discord section removed.
6. **Stale upstream docs deleted:** `README.ko.md`, `README.zh-TW.md`, `ROADMAP.md`. CONTRIBUTING/SECURITY/BUILD/CODE_OF_CONDUCT left as upstream.

**Deferred (with rationale):** `docs/` Docusaurus site (no fork docs host — in-app links stay on `docs.waveterm.dev`, accurate for the shared codebase); `build/deb-postinstall.tpl` `/opt/Wave` paths and `Taskfile.yml` `APP_NAME` (packaging identity / migration risk); `wsh` CLI help and Go dialog strings (code, not chrome); logo artwork (wave motif acceptable; `aria-label` already RemoteTerm); data-dir/env-var rename (needs tested migration, own spec).

**Files:** `package.json`, `index.html`, `electron-builder.config.cjs`, `frontend/app/{onboarding/onboarding.tsx, modals/{about,modalsrenderer,modalregistry}.tsx, workspace/widgets.tsx, element/quicktips.tsx}`, `README.md`, `AGENTS.md`, `.pi/`, `.github/ISSUE_TEMPLATE/bug-report.yml`.

## 2026-09-02: Web CDP companion — useful v1 cut (spec next)

**Decision:** Treat Wave’s existing web widget (Electron `<webview>`, `wsh web open`) as the agent browser. Do not add a separate Chrome, cloud browser, or Playwright/Puppeteer dependency. Ship a **useful v1** smaller than [[specs/web-agent-api.md]], specified in [[specs/web-agent-api-v1.md]] before any implementation.

**Context:** Agent Control Fabric v2 is implemented on `feat/agent-control-fabric`. Agents still cannot drive the embedded browser. The parent web spec is the ego-lite-shaped full vision (code-first mini-API over `webContents.debugger`, AX `@N` refs, partitions, locators). Effort for that full surface is ~3–5 weeks; a useful first ship is ~1.5–2.5 weeks.

**v1 includes:** CDP attach in emain; compact AX snapshot with `@N` refs; `click`/`fill`/`type` via `Input.*`; `js` / optional `cdp` escape hatch; `secret(name)` from the Wave secret store; `wsh web snapshot` / `screenshot`; un-hide `wsh web get`; setting `agent:allowbrowsercontrol` default **off**, stacked with existing `agent:allowremotelocalcontrol`. Connection gate is **not** widened.

**v1 excludes:** Playwright locators (`getByRole` etc.), downloads, `--background` / partition CLI flags, MCP, passkeys (already deferred 2026-08-16).

**Next:** implement from the locked spec. Do not start from the parent vision doc.

**Reuse:** `emain/emain-web.ts` (`getWebContentsByBlockId`, `webGetSelector`), `cmd/wsh/cmd/wshcmd-web.go`, `web:partition`, `clear-webview-storage`. Block-layout screenshots are not page CDP screenshots.

## 2026-09-02: Web CDP v1 surface — asymmetric hybrid (locked)

**Decision:** Surface the embedded `<webview>` to agents as **discrete observation + code-first action**, not as ego-lite’s product CLI and not as Playwright MCP.

**Context:** ego-lite’s agent API is a Node heredoc (`ego-browser nodejs <<'EOF'`) with injected JS helpers, not `ego-browser click 3`. That is the right *mechanism* (CDP + AX `@N` + `Input.*` in a host runtime). Wave already has `wsh` as the agent CLI, emain as a long-lived host, and a remote-first RPC path. Cloning task spaces, a fake `page` object, locators, or a discrete click CLI would either lie to agents or add ref-cache work we do not need for v1.

**Surface:**

1. **Look** with `wsh web snapshot` / `screenshot` / un-hidden `get` — one RPC, data out, no action refs that survive the process.
2. **Act** with `wsh web run` and a small function mini-API (`navigate`, `snapshot`, `click`/`fill`/`type`, `js`, `cdp`, `secret`, `sleep`, `print`, `pageInfo`). `@N` refs live for that run only.
3. **Do not ship** discrete `web click` / `fill` / top-level `cdp`, Playwright locators, `--background`, MCP, or ego-lite task spaces.

**Gates:** `agent:allowbrowsercontrol` default off on `run`/`snapshot`/`screenshot`/`get` (not `open`). Stack with existing `agent:allowremotelocalcontrol` for remote-origin → local webview. Connection gate unchanged.

**Other locks:** refuse DevTools conflict (do not steal); detach debugger after every command; fix `getWebContentsByBlockId` to the block’s tab (no auto-focus); `sleep` + snapshot loop (no `waitFor`); any secret name, audit the name; 256 KiB / 60s default / 5m max on `web run`.

**Files:** `.pi/specs/web-agent-api-v1.md` (locked). Parent vision remains draft: `.pi/specs/web-agent-api.md`.

## 2026-09-02: Crawl4AI is not the Wave web-agent surface

**Decision:** Do not vendor Crawl4AI (`crwl`), Firecrawl, or Playwright-as-a-crawler into Wave. Do not pivot v1 off `webContents.debugger` + AX `@N` + `web run`.

**Context:** Reading a page well (boilerplate, shadow DOM, iframes, cookie banners, markdown-for-LLM) is a real problem. Crawl4AI is built for that: Playwright crawler → cleaned HTML → markdown / `fit_markdown` / CSS-or-LLM extraction. Identity crawling uses **its** Chromium `user_data_dir`, not Wave’s web widget. Connecting it to Electron would mean `--remote-debugging-port`, which v1 already forbids.

**Split:** crawlers ingest **URLs** into text. Wave v1 drives the **user’s logged-in `<webview>`** so an agent can click, fill, and submit. An agent that only needs public-page markdown can already run `crwl` on the remote machine as a user-installed tool.

**Later (not v1):** if article-style reading of the *current widget* is painful, add a thin `wsh web markdown` that runs Readability/html2text/pruning on HTML taken from the guest. Steal the extraction idea, not the crawler.
