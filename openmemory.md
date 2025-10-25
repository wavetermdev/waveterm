# Wave Terminal Project Index

## Overview
**Wave Terminal** is an open-source AI-native terminal that combines traditional terminal features with graphical capabilities like file previews, web browsing, and AI assistance. It enables modern development workflows by allowing developers to stay in their terminal while accessing visual interfaces.

- **Version**: 0.12.1
- **License**: Apache-2.0
- **Platforms**: macOS 11+, Windows 10+, Linux (glibc-2.28+)
- **Repository**: github.com/wavetermdev/waveterm
- **Website**: https://waveterm.dev

## Technology Stack

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite with electron-vite
- **Styling**: Tailwind CSS v4
- **State Management**: Jotai 2.9.3
- **Terminal**: xterm.js with multiple addons (fit, search, serialize, web-links, webgl)
- **Code Editor**: Monaco Editor with YAML support
- **UI Components**: Radix UI, React Resizable Panels, React DnD
- **Charts**: ObservableHQ Plot, Recharts
- **Testing**: Vitest, Storybook

### Backend
- **Language**: Go 1.24.6
- **Database**: SQLite with sqlx, Database migrations with golang-migrate
- **Web Framework**: Gorilla Mux (router), Gorilla WebSocket
- **Authentication**: JWT tokens (golang-jwt/jwt/v5)
- **Cloud Services**: AWS SDK v2 (S3, configuration)
- **SSH**: Custom SSH handling with knownhosts, config parsing
- **AI Integration**: OpenAI SDK, Google Generative AI
- **System Monitoring**: gopsutil for system metrics
- **File Operations**: Various utilities for cross-platform file handling

### Desktop Application
- **Framework**: Electron v38
- **Builder**: electron-builder
- **Auto-updater**: electron-updater
- **Window Management**: Multi-window architecture with custom protocols

## Architecture

### Application Structure
```
/waveterm/
├── frontend/           # React frontend application
├── emain/             # Electron main process (TypeScript)
├── pkg/               # Go backend packages
├── cmd/               # Go command-line tools and servers
├── tsunami/           # Local workspace package (replaced in go.mod)
├── public/            # Static assets
├── assets/            # Images and icons
├── docs/              # Documentation
├── aiprompts/         # AI architecture documentation and prompts
├── testdriver/        # Automated testing configurations
├── build/             # Build configuration
└── [config files]     # Project configuration files
```

### Core Components

#### Frontend Architecture (`/frontend/`)
```
frontend/
├── app/               # Main application components (216 files)
│   ├── element/       # UI elements and widgets
│   ├── modal/         # Modal dialogs
│   ├── settings/      # Settings pages
│   └── store/         # State management
├── layout/            # Layout components (16 files)
├── types/             # TypeScript type definitions
├── util/              # Utility functions (15 files)
└── wave.ts           # Main frontend entry point
```

#### Backend Packages (`/pkg/`)
- **Core Systems**:
  - `wcore/` - Core application logic
  - `waveapp/` - Application management
  - `wavebase/` - Base utilities and types
  - `waveobj/` - Core object models

- **Authentication & Security**:
  - `authkey/` - Authentication key management
  - `wconfig/` - Configuration management

- **AI Integration**:
  - `waveai/` - AI service integration
  - `aiusechat/` - AI chat functionality

- **Remote & Connectivity**:
  - `remote/` - Remote connection management
  - `wsl/` - WSL integration
  - `wslconn/` - WSL connection handling
  - `genconn/` - Generic connection management

- **Data & Storage**:
  - `wstore/` - Data storage abstraction
  - `filestore/` - File storage operations
  - `db/` - Database schemas and migrations

- **Services**:
  - `service/` - Service layer components
  - `web/` - Web server functionality
  - `wps/` - Process management

- **Utilities**:
  - `util/` - General utilities (47 modules)
  - `wshutil/` - Shell utilities
  - `wshrpc/` - RPC communication

- **UI & Frontend**:
  - `vdom/` - Virtual DOM utilities
  - `blockcontroller/` - Block UI controller
  - `blocklogger/` - Block logging

- **AI Documentation & Prompts**:
  - `aiprompts/` - AI architecture documentation and system prompts (21 files)
    - Detailed AI integration documentation (streaming, UI components, backend design)
    - AI provider integration guides (OpenAI, Anthropic, Google AI)
    - System prompt templates for various AI features
    - Architecture decision records and technical specifications

#### Command Line Tools (`/cmd/`)
- `wsh/` - Wave shell integration (38 files)
- `server/` - Backend server
- `generatego/`, `generateschema/`, `generatets/` - Code generation tools
- `packfiles/` - File packaging utilities
- Various test commands

#### Electron Main Process (`/emain/`)
- `emain.ts` - Main entry point (25KB)
- `emain-window.ts` - Window management (32KB)
- `emain-wavesrv.ts` - Wave server integration
- `menu.ts` - Menu system
- `updater.ts` - Auto-update functionality
- Platform-specific modules

## Key Features & Functionality

### Terminal Features
- **Multi-tab Interface**: Flexible drag & drop organization
- **Command Blocks**: Isolated command execution with monitoring
- **Remote Connections**: SSH/WSL with full terminal access
- **Terminal Customization**: Themes, styles, background images

### AI Integration
- **Multiple Providers**: OpenAI, Claude, Azure, Perplexity, Ollama
- **Chat Interface**: Integrated AI chat within terminal blocks
- **Context Awareness**: Terminal context for AI interactions

### File Management
- **Rich Previews**: Markdown, images, video, PDFs, CSVs, directories
- **Built-in Editor**: Monaco editor with syntax highlighting
- **Remote File Editing**: Edit remote files seamlessly

### Testing & Development Tools
- **Test Driver**:
  - `testdriver/` - Automated testing configurations
    - YAML-based test scenarios for UI automation
    - Onboarding flow testing
    - Integration test specifications

### Developer Experience
- **Hot Reload**: Development mode with live reloading
- **Storybook**: Component development and testing
- **TypeScript**: Full type safety across frontend
- **Testing**: Vitest for unit tests, coverage reporting
- **Code Generation**: Automated TypeScript types from Go schemas

## Build System

### Development Commands
```bash
npm run dev          # Start development server
npm run storybook    # Start Storybook development
npm run test         # Run tests
npm run coverage     # Run tests with coverage
```

### Production Builds
```bash
npm run build:dev    # Development build
npm run build:prod   # Production build
```

### Go Development
- Standard Go tooling (go build, go test, go run)
- Code generation tools in `/cmd/` for TypeScript types and schemas
- Database migrations with golang-migrate

## Configuration & Settings

### Application Config (`wconfig/`)
- User settings management
- Custom configuration directories
- Platform-specific paths

### Build Configuration
- `electron-builder.config.cjs` - Desktop app packaging
- `electron.vite.config.ts` - Vite configuration for Electron
- `tsconfig.json` - TypeScript configuration
- `tailwind.config.js` - Tailwind CSS configuration

## Integration Points

### External Services
- **AI APIs**: OpenAI, Google AI, various providers
- **Cloud Storage**: AWS S3 integration
- **Authentication**: JWT-based auth system

### System Integration
- **File System**: Cross-platform file operations
- **Process Management**: Shell execution and monitoring
- **Network**: WebSocket communication, HTTP servers

## Development Workflow

1. **Frontend Development**: React + TypeScript with Vite hot reload
2. **Backend Development**: Go with standard tooling
3. **Code Generation**: Automated TypeScript types from Go schemas
4. **Testing**: Unit tests with Vitest, integration tests
5. **Documentation**: Storybook for component docs

## Project Status
- **Active Development**: Regular releases and roadmap updates
- **Community**: Discord community, GitHub issues
- **Documentation**: Comprehensive docs at docs.waveterm.dev
- **Legacy Support**: Legacy documentation at legacydocs.waveterm.dev

## User Defined Namespaces
[To be filled as development progresses]