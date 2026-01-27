# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wave Terminal is an open-source, AI-native terminal built with Electron. It combines traditional terminal features with graphical capabilities like file previews, web browsing, and AI assistance. The architecture consists of four main components:

1. **Frontend** (React + TypeScript) - UI and user interactions
2. **emain** (Electron Main Process) - Window management, native OS integration
3. **wavesrv** (Go Backend) - Core business logic, database, remote connections
4. **wsh** (Go CLI/Server) - Command-line tool and remote multiplexing server

## Fork-Specific Notes

This is a personal fork with experimental features. Key differences from upstream:

- **Telemetry Removed** - All telemetry collection is disabled. Wave AI works without requiring telemetry to be enabled.
- **WaveApp/Tsunami Removed** - The experimental WaveApp Builder and Tsunami framework have been removed.
- **xterm.js 6.1.0** - Upgraded from 5.5.0 to 6.1.0-beta.106, enabling DEC mode 2026 (Synchronized Output) for proper TUI animations. Uses `DomScrollableElement` scrollbar.
- **Font Ligatures** - Enable with `"term:ligatures": true` in settings. Works with ligature fonts (Fira Code, JetBrains Mono, etc.).
- **Tab Base Directory System** - Project-centric workflow with colored tabs, breadcrumb navigation, and smart OSC 7 auto-detection. See `docs/docs/tabs.mdx` for full documentation.
- **Backend Validation** - Comprehensive metadata validation in `pkg/waveobj/validators.go` (path traversal prevention, URL validation, optimistic locking).
- **Theme System Redesign** - Two-dimensional theme: Mode (Dark/Light/System via `app:theme`) × Accent (Green/Warm/Blue/Purple/Teal via `app:accent`). Uses `data-theme` and `data-accent` CSS attributes on `document.documentElement`. See `frontend/app/hook/usetheme.ts`.
- **Oh-My-Posh Configurator** - Visual editor for OMP themes in the Appearance panel. Discovers config files, renders block/segment previews, edits properties. See `frontend/app/element/settings/omp-configurator/`.
- **Remote Debugging in Dev Mode** - In dev mode (`WAVETERM_DEV` set), Electron automatically enables Chrome DevTools Protocol on port 9222. This allows Electron MCP tools and other CDP clients to connect for automated testing.
- **PowerShell Profile Loading** - User's `$PROFILE` is now sourced automatically after Wave's shell integration.
- **Windows PowerShell 7** - Build scripts require `pwsh` (PowerShell 7+), not Windows PowerShell 5.1.

## Build System

The project uses **Task** (modern Make alternative) for build orchestration. See `Taskfile.yml` for all available tasks.

### Common Commands

```bash
# Install dependencies (run this first after cloning)
task init

# Development server with hot reload
task dev

# Run standalone without hot reload
task start

# Production build and packaging
task package

# TypeScript type checking
task check:ts

# Run tests
npm test

# Run tests with coverage
npm run coverage

# Clean build artifacts
task clean

# Run a single Go test
go test -run TestName ./pkg/packagename/

# Clear dev data (useful when debugging)
task dev:cleardata

# Clear dev config
task dev:clearconfig
```

### Quick Development Shortcuts

```bash
# Fast development mode (macOS ARM64 only, no docsite, no wsh)
task electron:quickdev

# Fast development mode (Windows x64 only, no docsite, no wsh)
task electron:winquickdev

# Rebuild and install wsh locally (macOS ARM64 only)
task dev:installwsh
```

### Code Generation

The project uses code generators to maintain type safety between Go and TypeScript:

```bash
# Generate TypeScript bindings from Go types
task generate

# This runs:
# - cmd/generatets/main-generatets.go -> frontend/types/gotypes.d.ts
# - cmd/generatets/main-generatets.go -> frontend/app/store/services.ts
# - cmd/generatets/main-generatets.go -> frontend/app/store/wshclientapi.ts
# - cmd/generatego/main-generatego.go -> various Go files
```

**Always run `task generate` after modifying:**
- Go RPC types in `pkg/wshrpc/`
- Service definitions in `pkg/service/`
- Wave object types in `pkg/waveobj/`

## Architecture Overview

### Frontend Architecture

**Entry Point:** `frontend/wave.ts`
- Initializes the Wave Terminal application
- Sets up Jotai store, WPS (WebSocket Pub/Sub), and Monaco editor
- Root React component: `frontend/app/app.tsx`

**State Management:** Jotai (atom-based state)
- Global atoms defined in `frontend/app/store/global.ts`
- Store instance: `globalStore` (exported from `frontend/app/store/jotaiStore.ts`)
- Key models: `GlobalModel`, `TabModel`, `ConnectionsModel`

**Key Frontend Directories:**
- `frontend/app/block/` - Terminal blocks and renderers
- `frontend/app/view/` - Different view types (terminal, preview, web, etc.)
- `frontend/app/workspace/` - Workspace and tab layout management
- `frontend/layout/` - Layout system using `react-resizable-panels`
- `frontend/app/store/` - State management, RPC clients, WOS (Wave Object Store)
- `frontend/app/element/` - Reusable UI components
- `frontend/app/monaco/` - Monaco editor integration

**Hot Module Reloading:**
- Vite enables HMR for most changes
- State changes (Jotai atoms, layout) may require hard reload: `Cmd+Shift+R` / `Ctrl+Shift+R`

### Electron Main Process (emain)

**Entry Point:** `emain/emain.ts`
- Manages Electron app lifecycle and window creation
- Spawns and manages the `wavesrv` backend process
- Handles native menus, context menus, and OS integration

**IPC Communication:**
- Functions exposed from emain to frontend are defined in two places:
  1. `emain/preload.ts` - Electron preload script
  2. `frontend/types/custom.d.ts` - TypeScript declarations
- Frontend calls: `getApi().<function>()`

**Key emain Files:**
- `emain/emain.ts` - Main entry point
- `emain/emain-window.ts` - Window management
- `emain/emain-menu.ts` - Menu bar and context menus
- `emain/emain-wavesrv.ts` - wavesrv process management
- `emain/emain-tabview.ts` - Tab view management
- `emain/preload.ts` - Preload script for renderer

### Go Backend (wavesrv)

**Entry Point:** `cmd/server/main-server.go`

**Core Packages:**
- `pkg/wstore/` - Database operations and Wave object persistence
- `pkg/waveobj/` - Wave object type definitions (Client, Window, Tab, Block, etc.)
- `pkg/service/` - HTTP service endpoints
- `pkg/wshrpc/` - WebSocket RPC system (communication with frontend and wsh)
- `pkg/blockcontroller/` - Terminal block lifecycle management
- `pkg/remote/` - SSH and remote connection handling
- `pkg/wcloud/` - Cloud sync and authentication
- `pkg/waveai/` - AI integration (OpenAI, Claude, etc.)
- `pkg/filestore/` - File storage and management

**Database:**
- SQLite databases in `db/migrations-wstore/` and `db/migrations-filestore/`
- Wave objects: `Client`, `Window`, `Workspace`, `Tab`, `Block`, `LayoutState`
- All Wave object types registered in `pkg/waveobj/waveobj.go`

**RPC Communication:**
- Uses custom `wshrpc` protocol over WebSocket
- RPC types defined in `pkg/wshrpc/wshrpctypes.go`
- Commands implemented in `pkg/wshrpc/wshserver/` and `pkg/wshrpc/wshremote/`

### wsh (Wave Shell)

**Entry Point:** `cmd/wsh/main-wsh.go`

**Dual Purpose:**
1. CLI tool for controlling Wave from the terminal
2. Remote server for multiplexing connections and file streaming

**Communication:**
- Uses `wshrpc` protocol over domain socket or WebSocket
- Enables single-connection multiplexing for remote terminals

## Development Guidelines

### Frontend Development

1. **Use existing patterns:** Before adding new components, search for similar features:
   ```bash
   # Find similar views
   grep -r "registerView" frontend/app/view/

   # Find block implementations
   ls frontend/app/block/
   ```

2. **State management:** Use Jotai atoms for reactive state
   - Global atoms in `frontend/app/store/global.ts`
   - Component-local atoms using `atom()` from `jotai`

3. **RPC calls:** Use the generated `RpcApi` from `frontend/app/store/wshclientapi.ts`:
   ```typescript
   import { RpcApi } from "@/app/store/wshclientapi";
   import { TabRpcClient } from "@/app/store/wshrpcutil";

   const result = await RpcApi.SomeCommand(TabRpcClient, { param: "value" });
   ```

4. **Wave Objects:** Access via WOS (Wave Object Store):
   ```typescript
   import * as WOS from "@/store/wos";

   const tab = WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabId));
   ```

### Backend Development

1. **Database changes:** Add migrations to `db/migrations-wstore/` or `db/migrations-filestore/`

2. **New RPC commands:**
   - Define in `pkg/wshrpc/wshrpctypes.go`
   - Implement handler in `pkg/wshrpc/wshserver/`
   - Run `task generate` to update TypeScript bindings

3. **New Wave object types:**
   - Add to `pkg/waveobj/wtype.go`
   - Register in `init()` function
   - Run `task generate`

4. **Testing:** Write tests in `*_test.go` files:
   ```bash
   # Run Go tests
   go test ./pkg/...

   # Run specific package
   go test ./pkg/wstore/
   ```

### Code Style

- **TypeScript:** Prettier + ESLint (configured in `eslint.config.js`, `prettier.config.cjs`)
- **Go:** Standard `go fmt` + `staticcheck` (see `staticcheck.conf`)
- **Text files:** Must end with a newline (`.editorconfig`)

## Testing & Debugging

### Frontend Debugging

- **DevTools:** `Cmd+Option+I` (macOS) or `Ctrl+Option+I` (Windows/Linux)
- **Console access to global state:**
  ```javascript
  globalStore
  globalAtoms
  WOS
  RpcApi
  ```

### Remote Debugging (Electron MCP)

In dev mode, Electron exposes Chrome DevTools Protocol on port 9222 automatically. This enables Electron MCP tools for automated testing without manual interaction.

**How it works:**
- `emain/emain.ts` checks `isDev` (set when `WAVETERM_DEV=1`) and appends `--remote-debugging-port=9222`
- `task dev` or `task electron:winquickdev` set `WAVETERM_DEV=1` automatically
- Electron MCP tools (`get_electron_window_info`, `take_screenshot`, `send_command_to_electron`) connect via CDP

**Usage with Electron MCP:**
```
# Verify the app is running with debugging
mcp__electron__get_electron_window_info

# Take a screenshot
mcp__electron__take_screenshot

# Inspect page elements
mcp__electron__send_command_to_electron(command="get_page_structure")

# Click elements by text
mcp__electron__send_command_to_electron(command="click_by_text", args={text: "Settings"})

# Evaluate JavaScript in the renderer
mcp__electron__send_command_to_electron(command="eval", args={code: "document.title"})

# Check console for errors
mcp__electron__read_electron_logs(logType="console")
```

**Note:** Do NOT use Playwright to control the Electron app — use Electron MCP tools instead.

### Backend Debugging

- **Logs:** `~/.waveterm-dev/waveapp.log` (development mode)
- Contains both NodeJS (emain) and Go (wavesrv) logs

### Running Tests

```bash
# TypeScript/React tests
npm test

# With coverage
npm run coverage

# Go tests
go test ./pkg/...
```

## File Organization Conventions

- **Go files:** `packagename_descriptor.go` (e.g., `waveobj_wtype.go`)
- **TypeScript files:** `component-name.tsx`, `util-name.ts`
- **SCSS files:** `component-name.scss`
- **Test files:** `*_test.go`, `*.test.ts`, `*.test.tsx`

## Platform-Specific Notes

### Windows

- Use Zig for CGO static linking
- Use `task electron:winquickdev` for fast iteration
- Backslashes in file paths for Edit/MultiEdit tools

### Linux

- Requires Zig for CGO static linking
- Platform-specific dependencies in `BUILD.md`
- Use `USE_SYSTEM_FPM=1 task package` on ARM64

### macOS

- No special dependencies
- `task electron:quickdev` works on ARM64 only

## Important Paths

- **Frontend entry:** `frontend/wave.ts`
- **Main React app:** `frontend/app/app.tsx`
- **Electron main:** `emain/emain.ts`
- **Go backend entry:** `cmd/server/main-server.go`
- **wsh entry:** `cmd/wsh/main-wsh.go`
- **Generated types:** `frontend/types/gotypes.d.ts`
- **RPC API:** `frontend/app/store/wshclientapi.ts`
- **Dev logs:** `~/.waveterm-dev/waveapp.log`
- **Metadata validators:** `pkg/waveobj/validators.go`
- **Tab docs:** `docs/docs/tabs.mdx`
- **Theme hook:** `frontend/app/hook/usetheme.ts`
- **Theme CSS:** `frontend/app/theme.scss`
- **Settings registry:** `frontend/app/store/settings-registry.ts`
- **Appearance panel:** `frontend/app/view/waveconfig/appearance-content.tsx`
- **OMP configurator:** `frontend/app/element/settings/omp-configurator/`

## Common Gotchas

1. **After changing Go types, always run `task generate`** - TypeScript bindings won't update automatically
2. **emain and wavesrv don't hot-reload** - Must restart `task dev` to see changes
3. **Jotai atom changes may break HMR** - Use hard reload (`Cmd+Shift+R`)
4. **Database schema changes require migrations** - Never modify schema directly
5. **Wave objects must be registered** - Add to `init()` in `pkg/waveobj/waveobj.go`
6. **Windows requires PowerShell 7** - Build scripts use `pwsh -NoProfile`, not Windows PowerShell 5.1
7. **Theme system uses two CSS attributes** - `data-theme` (dark/light) and `data-accent` (green/warm/blue/purple/teal) on `document.documentElement`. Both must be set.
8. **Settings `hideFromSettings` field** - Settings with `hideFromSettings: true` have custom controls in the Appearance panel and are hidden from the General settings panel. Both `searchSettings` functions filter these out.
9. **Remote debugging is dev-only** - Port 9222 is only opened when `isDev` is true. Production builds do not expose CDP.

## Tab Base Directory Feature

Wave Terminal supports per-tab base directories that provide a project-centric workflow where all terminals and widgets within a tab share the same working directory context.

### Metadata Keys

| Key | Type | Description |
|-----|------|-------------|
| `tab:basedir` | `string` | Absolute path to base directory |
| `tab:basedirlock` | `boolean` | When true, disables smart auto-detection |

### Behavior Model

```
┌─────────────────────────────────────────────────────────────┐
│                         TAB                                  │
│  tab:basedir = "/home/user/project"                          │
│  tab:basedirlock = false                                     │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   Terminal 1    │  │   Terminal 2    │  │  File View   │ │
│  │ cmd:cwd = ...   │  │ cmd:cwd = ...   │  │ file = ...   │ │
│  │ (inherits tab)  │  │ (inherits tab)  │  │ (inherits)   │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Smart Auto-Detection (OSC 7)

When a terminal reports its working directory via OSC 7:

1. **Always:** Updates block's `cmd:cwd` metadata
2. **Conditionally:** Updates tab's `tab:basedir` if:
   - `tab:basedirlock` is false
   - `tab:basedir` is empty OR equals "~"

This allows the first terminal to "teach" the tab its project directory.

### Lock Semantics

| State | Behavior |
|-------|----------|
| Unlocked (default) | OSC 7 can update `tab:basedir` (under conditions) |
| Locked | Only manual setting changes `tab:basedir` |

### File Locations

| Purpose | File |
|---------|------|
| Tab context menu UI | `frontend/app/tab/tab.tsx` |
| OSC 7 handling | `frontend/app/view/term/termwrap.ts` |
| Terminal inheritance | `frontend/app/store/keymodel.ts` |
| Widget inheritance | `frontend/app/workspace/widgets.tsx` |
| Go type definitions | `pkg/waveobj/wtypemeta.go` |
| Metadata constants | `pkg/waveobj/metaconsts.go` |

### Related Presets

Tab variable presets can include base directory configuration:

```json
// File: pkg/wconfig/defaultconfig/presets/tabvars.json
{
    "tabvar@my-project": {
        "display:name": "My Project",
        "tab:basedir": "/home/user/my-project",
        "tab:basedirlock": true
    }
}
```
