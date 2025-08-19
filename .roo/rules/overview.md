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
- [`menu.ts`](emain/menu.ts) - Application menu system
- [`updater.ts`](emain/updater.ts) - Auto-update functionality
- [`preload.ts`](emain/preload.ts) - Preload script for renderer security
- [`preload-webview.ts`](emain/preload-webview.ts) - Webview preload script

**Responsibilities:**
- Window and tab management
- Native OS integration
- Auto-updater
- Menu system
- Security (preload scripts)
- Communication with Go backend

### 2. Frontend React Application (`frontend/`)

The React application runs in the Electron renderer process:

**Structure:**
```
frontend/
├── app/                # Main application code
│   ├── app.tsx         # Root App component
│   ├── block/          # Block-based UI components
│   ├── element/        # Reusable UI elements
│   ├── hook/           # Custom React hooks
│   ├── modals/         # Modal components
│   ├── store/          # State management (Jotai)
│   ├── view/           # Different view types
│   │   ├── chat/       # Chat interface
│   │   ├── codeeditor/ # Code editor (Monaco)
│   │   ├── term/       # Terminal view
│   │   ├── webview/    # Web view
│   │   └── waveai/     # AI integration
│   └── workspace/      # Workspace management
├── layout/             # Layout system
├── types/              # TypeScript type definitions
└── util/               # Utility functions
```

**Key Technologies:**
- React 18 with TypeScript
- Jotai for state management
- Monaco Editor for code editing
- XTerm.js for terminal emulation
- Tailwind CSS for styling
- SCSS for additional styling

### 3. Go Backend Server (`cmd/server/`)

The Go backend server handles all heavy lifting operations:

**Entry Point:** [`main-server.go`](cmd/server/main-server.go)

**Key Responsibilities:**
- Database operations
- SSH connections
- File system operations
- Networking
- Telemetry
- Configuration management
- WebSocket communication
- RPC services

### 4. Go Packages (`pkg/`)

The Go codebase is organized into modular packages:

**Core Packages:**
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
- `util/` - Common utilities

**Additional Packages:**
- `authkey/` - Authentication
- `eventbus/` - Event system
- `wcloud/` - Cloud integration
- `waveai/` - AI functionality
- `panichandler/` - Error handling
- `shellexec/` - Shell execution

### 5. Command Line Tools (`cmd/`)

Additional Go command-line utilities:
- `wsh/` - Wave Shell command-line tool
- `server/` - Main backend server
- `generatego/` - Code generation
- `generateschema/` - Schema generation
- `generatets/` - TypeScript generation
- `packfiles/` - File packaging utility

### 6. Database Layer (`db/`)

Database migrations for two main stores:
- `migrations-wstore/` - Main application database
- `migrations-filestore/` - File storage database

## Communication Architecture

The core communication system is built around the **WSH RPC (Wave Shell RPC)** system, which provides a unified interface for all inter-process communication.

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Electron      │    │   React          │    │   Go Backend    │
│   Main Process  │◄──►│   Frontend       │◄──►│   Server        │
│   (emain/)      │    │   (frontend/)    │    │   (cmd/server/) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │        WSH RPC        │        WSH RPC        │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Native OS     │    │   Web APIs       │    │   System APIs   │
│   Integration   │    │   DOM/Canvas     │    │   SSH/Network   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                │ WSH RPC
                                ▼
                    ┌─────────────────────┐
                    │   Remote Systems    │
                    │   (SSH, WSL, etc.)  │
                    └─────────────────────┘
```

### WSH RPC System (`pkg/wshrpc/`)

The WSH RPC system is the backbone of Wave Terminal's communication architecture:

**Key Components:**
- [`wshrpctypes.go`](pkg/wshrpc/wshrpctypes.go) - Core RPC interface and type definitions
- [`wshserver/`](pkg/wshrpc/wshserver/) - Server-side RPC implementation
- [`wshremote/`](pkg/wshrpc/wshremote/) - Remote connection handling
- [`wshclient.go`](pkg/wshrpc/wshclient.go) - Client-side RPC implementation

**Transport Flexibility:**
- **WebSockets** - Primary transport for frontend ↔ backend communication
- **Unix Domain Sockets** - Local process communication
- **Terminal/Stdio** - Communication over terminal connections
- **SSH Tunneling** - Remote system communication

**RPC Interface:**
The [`WshRpcInterface`](pkg/wshrpc/wshrpctypes.go:147) defines 100+ commands including:
- File operations (`FileRead`, `FileWrite`, `FileCopy`, etc.)
- Block management (`CreateBlock`, `DeleteBlock`, `ControllerInput`)
- Remote operations (`RemoteStreamFile`, `RemoteFileInfo`, etc.)
- Connection management (`ConnStatus`, `ConnConnect`, `ConnDisconnect`)
- AI integration (`AiSendMessage`, `StreamWaveAi`)
- Event system (`EventPublish`, `EventSub`, `EventRecv`)

**Communication Flow:**
1. **Frontend → Backend**: React components call WSH RPC methods via WebSocket
2. **Electron → Backend**: Main process uses WSH RPC for system integration
3. **Backend → Remote**: Go server uses WSH RPC over SSH/terminal for remote operations
4. **WSH Binary**: Command-line tool communicates with backend via same RPC system

This unified RPC system allows the `wsh` binary to work both locally and remotely, providing the same interface whether running on the local machine or on a remote server via SSH.

### Type-Safe Code Generation

Wave Terminal uses an innovative code generation system to maintain type safety between Go and TypeScript:

**Generation Process:**
1. **Go Definitions** - All RPC types and interfaces are defined in Go ([`wshrpctypes.go`](pkg/wshrpc/wshrpctypes.go))
2. **TypeScript Generation** - [`cmd/generatets/main-generatets.go`](cmd/generatets/main-generatets.go) automatically generates TypeScript bindings
3. **Build Integration** - The `generate` task in [`Taskfile.yml`](Taskfile.yml:252) runs code generation as part of the build process

**Generated Files:**
- [`frontend/types/gotypes.d.ts`](frontend/types/gotypes.d.ts) - TypeScript type definitions from Go structs
- [`frontend/app/store/services.ts`](frontend/app/store/services.ts) - Service layer bindings
- [`frontend/app/store/wshclientapi.ts`](frontend/app/store/wshclientapi.ts) - RPC client API methods

**Benefits:**
- **Type Safety** - Compile-time type checking between frontend and backend
- **Single Source of Truth** - Go types are the authoritative definition
- **Automatic Sync** - Changes to Go types automatically propagate to TypeScript
- **IDE Support** - Full IntelliSense and autocomplete for RPC calls

This approach ensures that the frontend and backend stay in sync, preventing runtime errors from type mismatches and providing excellent developer experience with full type safety across the entire stack.

## Build System

**Configuration Files:**
- [`package.json`](package.json) - Node.js dependencies and scripts
- [`electron.vite.config.ts`](electron.vite.config.ts) - Vite build configuration
- [`tsconfig.json`](tsconfig.json) - TypeScript configuration
- [`electron-builder.config.cjs`](electron-builder.config.cjs) - Electron packaging

**Build Targets:**
- **Main Process** - TypeScript → JavaScript (Node.js)
- **Preload Scripts** - TypeScript → CommonJS
- **Renderer** - React/TypeScript → ES6 bundle
- **Go Backend** - Go → Native binary

## Key Features

1. **Terminal Emulation** - XTerm.js-based terminal with modern features
2. **Block-based UI** - Modular block system for different content types
3. **AI Integration** - Built-in AI assistance and chat
4. **Code Editor** - Monaco Editor integration
5. **Remote Connections** - SSH and WSL support
6. **File Management** - Integrated file browser and operations
7. **Workspace Management** - Multi-workspace support
8. **Auto-updates** - Electron-based update system
9. **Cross-platform** - macOS, Linux, Windows support

## Development Workflow

1. **Frontend Development** - React components with hot reload
2. **Backend Development** - Go server with live reload
3. **Electron Integration** - Main process development
4. **Database Migrations** - SQL migration system
5. **Testing** - Vitest for frontend, Go testing for backend
6. **Documentation** - Docusaurus-based docs site

This architecture provides a robust foundation for a modern terminal application, combining the best of web technologies (React, TypeScript) with native performance (Go, Electron) and system integration capabilities.