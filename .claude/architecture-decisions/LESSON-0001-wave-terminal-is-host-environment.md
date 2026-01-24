# LESSON-0001: Wave Terminal IS the Host Environment

**Date:** 2026-01-22
**Category:** Development Environment
**Severity:** CRITICAL

---

## Problem

When developing Wave Terminal, Claude Code runs **inside** Wave Terminal itself. This creates a unique situation where the application under development is also the host environment for the development agent.

## Incident

During xterm.js 6.1.0 migration testing:
- Agent checked for running processes with `tasklist | grep wave`
- Found multiple `Wave.exe` and `wavesrv.x64.exe` processes
- Incorrectly assumed these were the dev instance that was just started
- Nearly suggested actions that could have killed the host terminal

## Key Understanding

```
┌─────────────────────────────────────────────────┐
│  Wave Terminal (Production/User Instance)        │
│  ├── Wave.exe (main process)                    │
│  ├── wavesrv.x64.exe (backend server)           │
│  └── Claude Code (running in this terminal)     │
│       └── Agent conversation (THIS SESSION)     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Wave Terminal (Dev Instance - separate)        │
│  ├── Wave.exe (dev main process)               │
│  ├── wavesrv.x64.exe (dev backend)             │
│  └── Started by `npm run dev` or `task dev`    │
└─────────────────────────────────────────────────┘
```

## Rules

### NEVER DO:
- ❌ Kill `Wave.exe` or `wavesrv.x64.exe` processes without explicit user instruction
- ❌ Assume Wave.exe processes are from your dev instance
- ❌ Run `taskkill` on any Wave-related processes
- ❌ Use the Electron MCP tools to interact with the production Wave instance

### ALWAYS DO:
- ✅ Understand that Wave Terminal is the HOST, not the target
- ✅ The dev instance runs separately with its own processes
- ✅ Ask user before any process management
- ✅ Use `npm run dev` or `task dev` to start a SEPARATE dev instance

## Impact

- **If violated:** Kills Claude Code session, loses all conversation context
- **Recovery:** User must restart Wave Terminal and Claude Code from scratch
- **Data loss:** Any uncommitted work or in-progress analysis

## Applies To

- Any development work on Wave Terminal
- Any testing involving Electron processes
- Any process management commands
- Any use of Electron MCP tools

---

## Related

- xterm.js 6.1.0 upgrade task
- QA testing procedures for Electron apps
