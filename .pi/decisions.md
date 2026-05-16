# Architecture Decisions — waveterm-remote Fork

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
