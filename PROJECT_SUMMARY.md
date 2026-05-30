# WaveTerm — Project Overview

> An open-source, AI-native terminal emulator for macOS, Linux, and Windows.
> Built by Command Line Inc — https://waveterm.dev | License: Apache-2.0

---

## 1. Main Features

- **Wave AI** — Context-aware terminal assistant. Reads terminal output, analyzes widgets, performs file operations. Supports OpenAI, Claude, Gemini, Azure, Perplexity, Ollama/LM Studio (local models). BYO-key model.
- **Durable SSH Sessions** — Remote terminal sessions survive network interruptions and restarts with automatic reconnection.
- **Flexible Drag-and-Drop Interface** — Organize terminal blocks, editors, web browsers, and AI assistants in a tiled layout.
- **Built-in Editor** — Monaco-based code editor for editing remote files with syntax highlighting.
- **Rich File Preview** — Preview markdown, images, video, PDFs, CSVs, directories on remote hosts.
- **Command Blocks** — Isolate and monitor individual commands in dedicated blocks.
- **`wsh` CLI** — Manage workspace from the command line and share data between terminal sessions.
- **Secure Secret Storage** — Uses native system backends (Keychain, Credential Manager, etc.).
- **No Accounts Required** — Telemetry-free, privacy-first.
- **WaveApp Builder (Tsunami)** — Build custom UIs using a Go VDOM framework rendered in the terminal.

---

## 2. Tech Stack

### Frontend (Renderer Process)
| Technology        | Purpose                                    |
|-------------------|--------------------------------------------|
| React 19          | UI framework                               |
| TypeScript 5.9    | Type-safe JavaScript                       |
| Vite 6 + SWC      | Build tool & fast refresh                  |
| Tailwind CSS v4   | Utility-first styling                      |
| Jotai             | Atomic state management                    |
| xterm.js          | Terminal emulator                          |
| Monaco Editor     | Code editor                                |
| Electron 41       | Desktop shell (main + renderer processes)  |
| Floating UI       | Popovers & menus                           |
| Recharts / Observable Plot | Charts & data visualization     |
| Mermaid           | Diagram rendering                          |
| Shiki             | Syntax highlighting                        |
| React DnD         | Drag-and-drop                              |
| Immer             | Immutable state updates                    |
| Winston           | Logging                                    |
| Vercel AI SDK     | Multi-provider AI integration              |

### Backend (Go Server — `wavesrv`)
| Technology               | Purpose                             |
|--------------------------|-------------------------------------|
| Go 1.25                  | Backend language                    |
| gorilla/mux             | HTTP router                         |
| gorilla/websocket       | WebSocket server (frontend comms)   |
| go-sqlite3 + sqlx       | SQLite database                     |
| golang-migrate/migrate  | DB migrations                       |
| creack/pty (fork)       | PTY management                      |
| crypto/ssh              | SSH client                          |
| spf13/cobra             | CLI framework (wsh)                 |
| shirou/gopsutil         | System/process monitoring           |
| google/generative-ai-go | Gemini AI integration               |
| golang-jwt/jwt          | JWT auth                            |
| fsnotify                | File system watcher (config HMR)    |

### Dev Tooling
| Tool              | Purpose                          |
|-------------------|----------------------------------|
| Task (Taskfile)   | Build orchestrator (replaces Make) |
| electron-vite     | Electron + Vite integration       |
| electron-builder  | Packaging & distribution         |
| Zig compiler      | CGO cross-compilation            |
| ESLint + Prettier | JS/TS linting & formatting       |
| golangci-lint     | Go linting                       |

---

## 3. Project Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Electron Main Process              │
│                   (emain/emain.ts)                  │
│  ┌──────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ App Mgmt │  │ Windows/   │  │ Spawns wavesrv │  │
│  │ Lifecycle│  │ Menus      │  │ (Go backend)   │  │
│  └──────────┘  └────────────┘  └───────┬────────┘  │
│                                        │            │
│  ┌──────────────────────────────────────┘            │
│  │  Preload Script (emain/preload.ts)                │
│  │  contextBridge → window.api (IPC)                │
│  └──────────────────────────────────────────────────┘
│                         │
├─────────────────────────┼───────────────────────────┤
│              Renderer Process                       │
│  ┌──────────────────────────────────────────────────┐│
│  │  React App (frontend/app/app.tsx)               ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │Terminal  │ │  AI      │ │  Preview / Web   │ ││
│  │  │Block     │ │  Panel   │ │  Block           │ ││
│  │  └──────────┘ └──────────┘ └──────────────────┘ ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │Monaco    │ │ Tsunami  │ │  Tab Bar, Menu,  │ ││
│  │  │Editor    │ │ VDom     │ │  Modals, ...     │ ││
│  │  └──────────┘ └──────────┘ └──────────────────┘ ││
│  │                                                  ││
│  │  State: Jotai atoms + WOS (Wave Object Store)   ││
│  │  Comms: WPS (Wave PubSub) over WebSocket        ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
                         │
              WebSocket / WSH RPC
                         │
┌─────────────────────────────────────────────────────┐
│              Go Backend (cmd/server/)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │WebSocket │ │  HTTP    │ │  WSH RPC Router     │ │
│  │Server    │ │  Server  │ │  (wshrpc/)           │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │Block Ctrl│ │ Job Ctrl │ │ SSH Conn Controller │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │  AI      │ │ Database │ │  Config / Secret     │ │
│  │  Service │ │ (SQLite) │ │  Store               │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
│  ┌──────────┐ ┌──────────┐                          │
│  │ Telemetry│ │ Tsunami  │                          │
│  │          │ │ VDom     │                          │
│  └──────────┘ └──────────┘                          │
└─────────────────────────────────────────────────────┘
```

### Communication Flow
- **Frontend ↔ Backend**: WSH RPC over WebSocket (or Unix domain socket)
- **RPC definitions**: `pkg/wshrpc/wshrpctypes.go` (Go) → auto-generated TypeScript bindings in `frontend/types/`
- **Event system**: WPS (Wave PubSub) for async event-driven communication
- **State**: Wave Object Store (WOS) backed by SQLite, reactive via Jotai atoms

### Key Directories
| Directory          | Purpose                                    |
|--------------------|--------------------------------------------|
| `frontend/`        | TypeScript/React UI (renderer process)     |
| `emain/`           | Electron main process                      |
| `pkg/`             | Go backend library (47 sub-packages)       |
| `cmd/`             | Go binary entry points (server, wsh, codegen) |
| `tsunami/`         | WaveApp framework (separate Go module)     |
| `db/`              | SQLite database setup & migrations         |
| `schema/`          | JSON schemas for settings, connections, etc. |
| `docs/`            | Docusaurus documentation site              |
| `tests/`           | Integration tests                          |
| `testdriver/`      | TestDriver.ai E2E test infrastructure      |
| `build/`           | Platform-specific build resources          |
| `public/`          | Static assets (fonts, icons)              |
| `.github/workflows/` | CI/CD pipelines (9 workflows)          |

---

## 4. Development Setup

### Prerequisites
- Go 1.25+
- Node.js 22 LTS
- Task CLI (https://taskfile.dev)
- Zig compiler (for CGO cross-compilation)

### Quick Start
```bash
task init          # npm install + go mod tidy + docs setup
task dev           # Full dev mode (HMR, builds backend)
task preview       # Standalone preview server (no Electron, port 7007)
npm run dev        # electron-vite dev (equivalent to above)
```

### Key Commands
| Command              | Description                               |
|----------------------|-------------------------------------------|
| `task dev`           | Full dev mode with HMR                    |
| `task start`         | Run built app standalone                  |
| `task package`       | Production build + platform installer     |
| `task build:backend` | Build wavesrv + wsh binaries              |
| `task generate`      | Regenerate TypeScript bindings from Go    |
| `task check:ts`      | TypeScript type checking (`tsc --noEmit`) |
| `task clean`         | Remove dist/ and make/ directories        |
| `task docsite`       | Start documentation dev server            |

---

## 5. Testing

### Frontend (Vitest)
```bash
npm test              # Run all tests (vitest, single run)
npm run coverage      # Run with Istanbul coverage (output: ./coverage/)
npx vitest            # Run in watch mode
```

- **Framework**: Vitest v3 with Istanbul coverage
- **Location**: Tests co-located with source as `*.test.ts` / `*.test.tsx`
- **Pattern**: Pure logic tests use `describe`/`it`; component tests use `renderToStaticMarkup`; API mocking via `vi.mock()`
- **TypeCheck**: Vitest also runs TypeScript typechecking during tests
- **Output**: JUnit XML to `test-results.xml`, LCOV coverage to `./coverage/`

**Test files (frontend):** ~14 files covering layout algorithms, tree views, widgets, context menus, WebView, terminal OSC handlers, color validation, etc.

### Backend (Go)
```bash
go test ./...                        # All Go tests
go test -v ./pkg/util/fileutil/...   # Specific package, verbose
```

- **Framework**: Standard Go `testing` package (no testify/ginkgo)
- **Location**: Tests co-located as `*_test.go` (white-box, same package)
- **Pattern**: `t *testing.T`, `t.TempDir()`, hand-written mock structs
- **Coverage**: No Go coverage configured in CI

**Test files (Go):** ~30 test files covering file utilities, AI chat, SSH, streams, data structures, DOM rendering, etc.

### E2E / Integration
- **TestDriver.ai** — AI-driven visual/E2E tests, run in CI on Windows
- **CI**: GitHub Actions — 9 workflows (build, testdriver, codeql, merge gatekeeper)

### Linting & Formatting
```bash
# TypeScript/React
npx eslint frontend/ emain/          # ESLint 9 flat config
npx prettier --check .               # Prettier formatting

# Go
golangci-lint run                    # golangci-lint (minimal config)
```

> **Note**: Unit tests are NOT run in CI — they are expected to be executed locally. CI only runs TestDriver.ai E2E tests, CodeQL analysis, and build validation.

---

## 6. Debugging

### Dev Mode
```bash
task dev            # Full dev mode: Vite HMR + Go backend + Electron
```
- **Frontend HMR**: Hot Module Replacement via Vite (React components update instantly)
- **Go Backend**: Spawned as a child process by Electron, restarted on changes
- **Chrome DevTools**: `Cmd+Option+I` (macOS) / `Ctrl+Shift+I` (Windows/Linux) in the running app

### Logging
| Log Source        | Location / Method                                |
|-------------------|--------------------------------------------------|
| Electron (main)   | `{dataDir}/waveapp.log` (winston, rotated at 10MB) |
| Go backend        | stderr → captured by Electron → waveapp.log      |
| Frontend debug    | `debug("wave:workspace")` etc. (npm `debug` package) |
| Block debug       | `pkg/blocklogger` — writes logs to terminal block UI |
| Dev-only          | `logutil.DevPrintf()` — only in dev mode          |

### Data & Config Directories
- **Dev mode**: `~/.waveterm-dev/`
- **Production**: Platform-specific (`~/Library/Application Support/waveterm/`, `~/.config/waveterm/`, `%LOCALAPPDATA%/waveterm/`)

### Debug Tools
- **pprof**: Enable via `debug:pprofport` setting in config
- **Connection debug**: Set block meta `term:conndebug` to `"info"` or `"debug"`
- **WebGL debug**: Set `debug:webglstatus` config key
- **SIGUSR1 dump** (Unix): Dumps debug info to `/tmp/waveterm-usr1-dump.log`
- **VS Code**: No `launch.json` provided; recommended extensions: Prettier, Go, ESLint, Vitest, Task

### Environment Variables
| Variable                 | Purpose                            |
|--------------------------|------------------------------------|
| `WAVETERM_DEV`           | Marks dev mode (auto-set by Electron) |
| `WAVETERM_ENVFILE`       | Path to `.env` file                |
| `WAVETERM_CONFIG_HOME`   | Config directory override          |
| `WAVETERM_DATA_HOME`     | Data directory override            |
| `WAVETERM_NOCONFIRMQUIT` | Skip quit confirmation (dev mode)  |
| `WCLOUD_ENDPOINT`        | Cloud API endpoint (dev/staging)   |

---

## 7. Build & Deploy

### Production Build
```bash
task package          # Full production build + platform installer
```

- **Go cross-compilation**: Uses Zig compiler for fully static CGO binaries
- **Targets**: macOS (arm64/amd64), Linux (arm64/amd64), Windows (arm64/amd64), plus MIPS/MIPS64 for wsh
- **Electron packaging**: electron-builder — creates DMG/zip (macOS), NSIS/MSI/zip (Windows), deb/rpm/snap/AppImage/pacman (Linux)
- **App ID**: `dev.commandline.waveterm`

### Code Generation
```bash
task generate         # Generates:
                      # - frontend/types/gotypes.d.ts (TS from Go types)
                      # - Go server stubs from RPC definitions
                      # - JSON schemas from Go config types
```

### CI/CD (GitHub Actions)
- 9 workflow files in `.github/workflows/`
- Build validation on PR (wavesrv + wsh + frontend)
- TestDriver.ai E2E tests (Windows)
- CodeQL static analysis
- Merge gatekeeper (requires: Build, TestDriver, CodeQL, License Compliance, CodeRabbit)

---

## 8. Key Conventions

- **Go**: String constants over custom enums, `Printf` over `Println`, `Make` over `New`, `defer lock.Unlock()`
- **TypeScript**: Named exports only, 4-space indent, `@/` path aliases, `cn()` for class merging
- **Styling**: Tailwind v4; custom CSS in `frontend/tailwindsetup.css`
- **State**: Jotai atoms; singleton models with `getInstance()`, `private constructor`
- **RPC**: Define in `pkg/wshrpc/wshrpctypes.go`, implement in `pkg/wshrpc/wshserver.go`, run `task generate`
- **All lowercase** filenames and JSON fields
- **No Makefile** — use `Task` (Taskfile.yml)

---

*Generated from project exploration — May 2026*
