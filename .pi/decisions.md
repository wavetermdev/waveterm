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

## 2026-05-20: MOSH Research — Not a Priority

**Finding:** MOSH (Mobile Shell) provides seamless reconnection (roaming, sleep/wake) and client-side local echo via UDP-based State Synchronization Protocol. However, it's not a priority for this fork.

**Why not:**
- **No port forwarding** — open issue since 2014, no movement. Port forwarding is a core requirement.
- **No OSC52 clipboard** — remote programs can't put text in local clipboard.
- **No scrollback** — only syncs visible terminal state.
- **No file transfer** (scp/sftp).
- **C++ only** — no Go or JS library implementations of the core protocol.
- **Slow development** — last release 1.4.0 (October 2022).

**Alternative: tsshd (trzsz-ssh)** — Go-based, supports full SSH features (port forwarding, agent forwarding, X11, scrollback, OSC52) + UDP roaming via QUIC/KCP. More architecturally relevant but would require significant integration effort.

**Local echo with wsh** — Technically possible (Wave Terminal already knows screen state and intercepts keystrokes), but non-trivial (must detect line-editing vs application mode, validate predictions against round-trip timing). Low value for typical homelab latency (<50ms).

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
4. MOSH/tsshd support (backlog, if roaming becomes a real pain point)
