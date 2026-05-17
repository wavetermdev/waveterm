This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@.kilocode/rules/rules.md

---

## Skill Guides

This project uses a set of "skill" guides — focused how-to documents for common implementation tasks. When your task matches one of the descriptions below, **read the linked SKILL.md file before proceeding** and follow its instructions precisely.

| Skill        | File                                     | Description                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add-config   | `.kilocode/skills/add-config/SKILL.md`   | Guide for adding new configuration settings to Wave Terminal. Use when adding a new setting to the configuration system, implementing a new config key, or adding user-customizable settings.                                               |
| add-rpc      | `.kilocode/skills/add-rpc/SKILL.md`      | Guide for adding new RPC calls to Wave Terminal. Use when implementing new RPC commands, adding server-client communication methods, or extending the RPC interface with new functionality.                                                 |
| add-wshcmd   | `.kilocode/skills/add-wshcmd/SKILL.md`   | Guide for adding new wsh commands to Wave Terminal. Use when implementing new CLI commands, adding command-line functionality, or extending the wsh command interface.                                                                      |
| context-menu | `.kilocode/skills/context-menu/SKILL.md` | Guide for creating and displaying context menus in Wave Terminal. Use when implementing right-click menus, adding context menu items, creating submenus, or handling menu interactions with checkboxes and separators.                      |
| create-view  | `.kilocode/skills/create-view/SKILL.md`  | Guide for implementing a new view type in Wave Terminal. Use when creating a new view component, implementing the ViewModel interface, registering a new view type in BlockRegistry, or adding a new content type to display within blocks. |
| electron-api | `.kilocode/skills/electron-api/SKILL.md` | Guide for adding new Electron APIs to Wave Terminal. Use when implementing new frontend-to-electron communications via preload/IPC.                                                                                                         |
| waveenv      | `.kilocode/skills/waveenv/SKILL.md`      | Guide for creating WaveEnv narrowings in Wave Terminal. Use when writing a named subset type of WaveEnv for a component tree, documenting environmental dependencies, or enabling mock environments for preview/test server usage.          |
| wps-events   | `.kilocode/skills/wps-events/SKILL.md`   | Guide for working with Wave Terminal's WPS (Wave PubSub) event system. Use when implementing new event types, publishing events, subscribing to events, or adding asynchronous communication between components.                            |

---

## Common Commands

All build commands use [Task](https://taskfile.dev/) (`task`). Run from the repo root.

### Development

```sh
task init           # First-time setup: npm install + go mod tidy + docs npm install
task dev            # Build backend + run via Vite dev server (hot reload)
task start          # Build backend + run standalone (no hot reload)
task quickdev       # macOS arm64 only: faster dev loop, skips wsh build and generate
task preview        # Run standalone component preview server (no Electron, no backend) at http://localhost:7007
```

### Building

```sh
task build:backend  # Build wavesrv + wsh for all targets
task generate       # Re-generate TypeScript bindings and Go code from pkg/wshrpc/wshrpctypes.go
task check:ts       # TypeScript type-check (npx tsc --noEmit)
task package        # Production build + package for current platform (artifacts in make/)
```

### Testing

```sh
npm test                        # Run all Vitest frontend tests
npm run coverage                # Run tests with coverage
go test ./pkg/...               # Run all Go tests from repo root
go test ./pkg/somepackage/...   # Run a single Go package's tests
```

### Debugging

- Frontend DevTools: `Cmd+Option+I` (macOS) or `Ctrl+Option+I` (Linux/Windows)
- Backend logs (dev): `~/.waveterm-dev/waveapp.log`

---

## Architecture

Wave Terminal is an Electron app with a React/TypeScript renderer process and a Go backend server. The two communicate via **wshrpc** — a custom RPC protocol over WebSocket and Unix domain sockets.

### Top-level layout

| Directory | Purpose |
|-----------|---------|
| `emain/` | Electron main process (window management, IPC, auto-update) |
| `frontend/` | React renderer process (UI, state, views) |
| `cmd/` | Go entry points: `server/`, `wsh/`, `generatets/`, `generatego/`, `generateschema/` |
| `pkg/` | Go packages (see below) |
| `tsunami/` | Tsunami builder subsystem (separate Go module + frontend) |
| `db/` | SQL migration files for wstore and filestore |
| `docs/` | Docusaurus documentation site |

### Frontend (`frontend/`)

- **`app/store/`** — Jotai atoms and global state; `wshclientapi.ts` is generated (do not edit manually)
- **`app/block/`** — Block container components and `BlockRegistry` (maps view type strings to components)
- **`app/view/`** — All view implementations: `term/`, `codeeditor/`, `preview/`, `webview/`, `waveai/`, `sysinfo/`, `tsunami/`, etc.
- **`app/tab/` / `app/workspace/`** — Tab and workspace UI
- **`layout/`** — Drag/drop layout engine
- **`types/gotypes.d.ts`** — Generated from Go types; do not edit manually
- **`preview/`** — Standalone Vite app for component preview (no backend needed); run with `task preview`

### Go backend (`pkg/`)

| Package | Purpose |
|---------|---------|
| `wshrpc/` | RPC type definitions (`wshrpctypes.go`) and generated client; source of truth for all RPC commands |
| `wshrpc/wshserver/` | Server-side RPC handler implementations |
| `wstore/` | Database and object storage layer |
| `wconfig/` | Configuration system (`settingsconfig.go`) |
| `wcore/` | Core business logic |
| `wps/` | Wave PubSub event system |
| `blockcontroller/` | Block execution and lifecycle management |
| `remote/` | SSH and remote connection handling |
| `filestore/` | File storage |
| `web/` | HTTP/WebSocket server |
| `waveobj/` | Core Wave data object types |
| `service/` | Service layer |
| `waveai/` | AI integration |
| `shellexec/` | Shell execution |

### Electron main (`emain/`)

Key files: `emain.ts` (app lifecycle), `emain-window.ts` (window), `emain-tabview.ts` (tabs), `emain-ipc.ts` (IPC handlers), `emain-wavesrv.ts` (Go backend process management), `preload.ts` (renderer ↔ main bridge).

Frontend accesses Electron APIs via `getApi()` from `@/store/global` — the full API type is `ElectronApi` in `custom.d.ts`.

### WSH RPC Communication

All IPC (frontend ↔ backend, main ↔ backend, backend ↔ remote SSH/WSL) goes through the WSH RPC system:

1. **Define** the RPC command in `pkg/wshrpc/wshrpctypes.go`
2. **Run** `task generate` to regenerate `frontend/app/store/wshclientapi.ts` and related Go files
3. **Implement** server-side handler in `pkg/wshrpc/wshserver/wshserver.go`

Callers use _routes_ (block ID, connection name, or `"waveapp"`) — the RPC layer picks the right transport automatically.

### Code Generation

Run `task generate` after modifying any of these files:
- `pkg/wshrpc/wshrpctypes.go` — RPC types → TypeScript client + Go boilerplate
- `pkg/wconfig/settingsconfig.go` — Config types → schema + TypeScript types
- `pkg/waveobj/wtypemeta.go` — Wave object types → TypeScript types

Never manually edit `frontend/types/gotypes.d.ts` or `frontend/app/store/wshclientapi.ts`.
