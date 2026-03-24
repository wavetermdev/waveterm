# Wave Terminal - High Level Architecture Overview

## Project Description

Wave Terminal is an open-source AI-native terminal built for seamless workflows. It's an Electron application that serves as a command line terminal host (it hosts CLI applications rather than running inside a CLI). The application combines a React frontend with a Go backend server to provide a modern terminal experience with advanced features.

## Top-Level Directory Structure

```
waveterm/
├── emain/              # Electron main process code
├── frontend/           # React application (renderer process)
├── cmd/                # Go command-line applications
├── pkg/                # Go packages/modules
├── db/                 # Database migrations
├── docs/               # Documentation (Docusaurus)
├── build/              # Build configuration and assets
├── assets/             # Application assets (icons, images)
├── public/             # Static public assets
├── tests/              # Test files
├── .github/            # GitHub workflows and configuration
└── Configuration files (package.json, tsconfig.json, etc.)
```

## Architecture Components

### 1. Electron Main Process (`emain/`)

The Electron main process handles the native desktop application layer:

**Key Files:**

- [`emain.ts`](emain/emain.ts) - Main entry point, application lifecycle management
- [`emain-window.ts`](emain/emain-window.ts) - Window management (`WaveBrowserWindow` class)
- [`emain-tabview.ts`](emain/emain-tabview.ts) - Tab view management (`WaveTabView` class)
- [`emain-wavesrv.ts`](emain/emain-wavesrv.ts) - Go backend server integration
- [`emain-wsh.ts`](emain/emain-wsh.ts) - WSH (Wave Shell) client integration
- [`emain-ipc.ts`](emain/emain-ipc.ts) - IPC handlers for frontend ↔ main process communication
- [`emain-menu.ts`](emain/emain-menu.ts) - Application menu system
- [`updater.ts`](emain/updater.ts) - Auto-update functionality
- [`preload.ts`](emain/preload.ts) - Preload script for renderer security
- [`preload-webview.ts`](emain/preload-webview.ts) - Webview preload script

### 2. Frontend React Application (`frontend/`)

The React application runs in the Electron renderer process:

**Structure:**

```
frontend/
├── app/                # Main application code
│   ├── app.tsx         # Root App component
│   ├── aipanel/        # AI panel UI
│   ├── block/          # Block-based UI components
│   ├── element/        # Reusable UI elements
│   ├── hook/           # Custom React hooks
│   ├── modals/         # Modal components
│   ├── store/          # State management (Jotai)
│   ├── tab/            # Tab components
│   ├── view/           # Different view types
│   │   ├── codeeditor/ # Code editor (Monaco)
│   │   ├── preview/    # File preview
│   │   ├── sysinfo/    # System info view
│   │   ├── term/       # Terminal view
│   │   ├── tsunami/    # Tsunami builder view
│   │   ├── vdom/       # Virtual DOM view
│   │   ├── waveai/     # AI chat integration
│   │   ├── waveconfig/ # Config editor view
│   │   └── webview/    # Web view
│   └── workspace/      # Workspace management
├── builder/            # Builder app entry
├── layout/             # Layout system
├── preview/            # Standalone preview renderer
├── types/              # TypeScript type definitions
└── util/               # Utility functions
```

**Key Technologies:**

- Electron (desktop application shell)
- React 19 with TypeScript
- Jotai for state management
- Monaco Editor for code editing
- XTerm.js for terminal emulation
- Tailwind CSS v4 for styling
- SCSS for additional styling (deprecated, new components should use Tailwind)
- Vite / electron-vite for bundling
- Task (Taskfile.yml) for build and code generation commands

### 3. Go Backend Server (`cmd/server/`)

The Go backend server handles all heavy lifting operations:

**Entry Point:** [`main-server.go`](cmd/server/main-server.go)

### 4. Go Packages (`pkg/`)

The Go codebase is organized into modular packages:

**Key Packages:**

- `wstore/` - Database and storage layer
- `wconfig/` - Configuration management
- `wcore/` - Core business logic
- `wshrpc/` - RPC communication system
- `wshutil/` - WSH (Wave Shell) utilities
- `blockcontroller/` - Block execution management
- `remote/` - Remote connection handling
- `filestore/` - File storage system
- `web/` - Web server and WebSocket handling
- `telemetry/` - Usage analytics and telemetry
- `waveobj/` - Core data objects
- `service/` - Service layer
- `wps/` - Wave PubSub event system
- `waveai/` - AI functionality
- `shellexec/` - Shell execution
- `util/` - Common utilities

### 5. Command Line Tools (`cmd/`)

Key Go command-line utilities:

- `wsh/` - Wave Shell command-line tool
- `server/` - Main backend server
- `generatego/` - Code generation
- `generateschema/` - Schema generation
- `generatets/` - TypeScript generation

## Communication Architecture

The core communication system is built around the **WSH RPC (Wave Shell RPC)** system, which provides a unified interface for all inter-process communication: frontend ↔ Go backend, Electron main process ↔ backend, and backend ↔ remote systems (SSH, WSL).

### WSH RPC System (`pkg/wshrpc/`)

The WSH RPC system is the backbone of Wave Terminal's communication architecture:

**Key Components:**

- [`wshrpctypes.go`](pkg/wshrpc/wshrpctypes.go) - Core RPC interface and type definitions (source of truth for all RPC commands)
- [`wshserver/`](pkg/wshrpc/wshserver/) - Server-side RPC implementation
- [`wshremote/`](pkg/wshrpc/wshremote/) - Remote connection handling
- [`wshclient.go`](pkg/wshrpc/wshclient.go) - Go client for making RPC calls
- [`frontend/app/store/wshclientapi.ts`](frontend/app/store/wshclientapi.ts) - Generated TypeScript RPC client

**Routing:** Callers address RPC calls using _routes_ (e.g. a block ID, connection name, or `"waveapp"`) rather than caring about the underlying transport. The RPC layer resolves the route to the correct transport (WebSocket, Unix socket, SSH tunnel, stdio) automatically. This means the same RPC interface works whether the target is local or a remote SSH connection.

## Development Notes

- **Build commands** - Use `task` (Taskfile.yml) for all build, generate, and packaging commands
- **Code generation** - Run `task generate` after modifying Go types in `pkg/wshrpc/wshrpctypes.go`, `pkg/wconfig/settingsconfig.go`, or `pkg/waveobj/wtypemeta.go`
- **Testing** - Vitest for frontend unit tests; standard `go test` for Go packages
- **Database migrations** - SQL migration files in `db/migrations-wstore/` and `db/migrations-filestore/`
- **Documentation** - Docusaurus site in `docs/`
