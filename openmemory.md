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

### Hyper-Intelligent Terminal System (NEW)
- **Multi-Agent Architecture**: 8 specialized AI agents working in coordination
  - **Command Analysis Agent**: Real-time command suggestions and corrections
  - **Context Manager Agent**: Session context tracking and management
  - **Command Explanation Agent**: AI-powered command explanations with examples
  - **Pattern Analysis Agent**: Command pattern recognition and optimization
  - **Security Monitor Agent**: Real-time threat detection and protection
  - **Optimization Engine Agent**: Performance monitoring and auto-optimization
  - **MCP Integration Agent**: Model Context Protocol for external tool integration
  - **Coordinator Agent**: Agent-to-agent communication and task coordination

- **Advanced AI Features**:
  - **Command Suggestions Overlay**: Real-time AI-powered command suggestions
  - **Context Visualizer**: Multi-dimensional context tracking and visualization
  - **Security Monitoring**: Real-time threat detection and device protection
  - **Performance Optimization**: Continuous system performance monitoring
  - **MCP Protocol Integration**: External tool and service integration
  - **Persistent Optimization**: Learning from user patterns and preferences
  - **Agent Coordination**: Inter-agent communication and task distribution

- **AI Enhancement Modes**:
  - **Standard AI Mode**: Traditional AI chat and assistance
  - **Hyper-Intelligent Mode**: Full multi-agent system with advanced features
  - **Security-First Mode**: Enhanced security monitoring and protection
  - **Performance Mode**: Optimized for maximum efficiency and speed

- **Integration Features**:
  - **Warp Terminal Clone Integration**: Enhanced with command analysis and suggestions
  - **Real-time Command Analysis**: Instant feedback and suggestions as you type
  - **Context-Aware Responses**: AI understands your current terminal state
  - **Multi-Modal Input**: Support for text, files, images, and terminal output
  - **Persistent Learning**: System improves based on user interactions

- **Security & Protection**:
  - **Real-time Threat Detection**: Monitors for suspicious commands and patterns
  - **Device Protection**: System-level protection and monitoring
  - **Risk Assessment**: Analyzes command safety and provides warnings
  - **Auto-Protection**: Automatically enables protections when threats detected
  - **Security Scoring**: Continuous assessment of system security posture

- **Performance & Optimization**:
  - **Response Time Monitoring**: Tracks and optimizes AI response times
  - **Resource Usage Optimization**: Monitors memory, CPU, and network usage
  - **Auto-Optimization**: Automatically adjusts settings for best performance
  - **Efficiency Metrics**: Real-time performance scoring and reporting
  - **Adaptive Learning**: System learns from user behavior patterns

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

# AI-Enhanced Development
npm run ai:dev       # Start development with AI agents
npm run mcp:start    # Start MCP servers
node scripts/check-agent-status.js  # Check AI agent status
node scripts/setup-ai-agents.js     # Setup AI agent system
```

### Production Builds
```bash
npm run build:dev    # Development build
npm run build:prod   # Production build
npm run ai:build     # Production build with AI features
```

### AI System Setup
```bash
# Initial setup
./setup-hyper-intelligent-terminal.sh

# Environment configuration
cp .env.example .env
# Edit .env with your API keys

# Start AI services
npm run mcp:start    # Start MCP servers
npm run ai:dev       # Start with AI agents
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

## AI Component Architecture

### Frontend AI Components (`/frontend/app/aipanel/`)
- **agent-coordinator.ts**: Central coordination system for all AI agents
- **suggestions-overlay.tsx**: Real-time command suggestions overlay
- **command-explanation.tsx**: AI-powered command explanations
- **context-visualizer.tsx**: Multi-dimensional context visualization
- **ai-settings.tsx**: Comprehensive AI agent configuration
- **security-monitor.tsx**: Real-time security monitoring and protection
- **enhanced-terminal-input.tsx**: AI-enhanced terminal input with suggestions
- **hyper-intelligent-terminal.tsx**: Main hyper-intelligent terminal orchestrator
- **mcp-integration.ts**: Model Context Protocol integration service

### Backend AI Integration (`/pkg/`)
- **waveai/**: Core AI backend with multiple provider support
  - OpenAI, Anthropic, Google AI, Perplexity integrations
  - Streaming responses and context management
  - Rate limiting and usage tracking
- **aiusechat/**: Chat system with tool integration
  - Command execution tools
  - File system operations
  - Web browsing capabilities
  - Screenshot and terminal tools

### AI Agent System
- **8 Specialized Agents**: Each with unique capabilities and responsibilities
- **Inter-Agent Communication**: Message-based coordination system
- **Context Sharing**: Shared context across all agents
- **Performance Monitoring**: Real-time performance tracking and optimization
- **Persistent Learning**: System improves based on user interactions

### MCP Integration
- **External Tool Support**: Integration with external tools and services
- **Protocol Compliance**: Full MCP protocol implementation
- **Tool Discovery**: Automatic discovery of available tools
- **Service Management**: Connection management and heartbeat monitoring

## Integration Points

### External Services
- **AI APIs**: OpenAI, Google AI, various providers
- **Cloud Storage**: AWS S3 integration
- **Authentication**: JWT-based auth system
- **MCP Servers**: External tool and service integration

### System Integration
- **File System**: Cross-platform file operations with AI assistance
- **Process Management**: Shell execution and monitoring with AI analysis
- **Network**: WebSocket communication, HTTP servers, MCP connections
- **Security**: Real-time threat detection and system protection

### Advanced Features
- **Command Analysis**: Real-time command parsing and suggestion generation
- **Context Management**: Multi-dimensional context tracking
- **Pattern Recognition**: Command pattern analysis and optimization
- **Security Monitoring**: Continuous threat assessment and protection
- **Performance Optimization**: Auto-tuning and resource management

## Development Workflow

1. **Frontend Development**: React + TypeScript with Vite hot reload
2. **Backend Development**: Go with standard tooling
3. **AI Integration**: Multi-agent system with MCP protocol
4. **Code Generation**: Automated TypeScript types from Go schemas
5. **Testing**: Unit tests with Vitest, integration tests, AI testing
6. **Documentation**: Storybook for component docs

## Project Status

- **Active Development**: Regular releases and roadmap updates
- **Community**: Discord community, GitHub issues
- **Documentation**: Comprehensive docs at docs.waveterm.dev
- **Legacy Support**: Legacy documentation at legacydocs.waveterm.dev

### Recent Enhancements (v0.12.1+)
- **Hyper-Intelligent Terminal**: Multi-agent AI system with 8 specialized agents
- **MCP Protocol Integration**: External tool and service connectivity
- **Advanced Security**: Real-time threat detection and device protection
- **Performance Optimization**: Auto-optimization and efficiency monitoring
- **Command Analysis**: Real-time suggestions and pattern recognition
- **Context Visualization**: Multi-dimensional context tracking and display

## User Defined Namespaces
- **ai-agents**: Multi-agent AI system and coordination
- **mcp-integration**: Model Context Protocol and external tools
- **security-monitoring**: Threat detection and system protection
- **performance-optimization**: System performance and resource management
- **command-analysis**: Command parsing and suggestion generation
- **context-management**: Multi-dimensional context tracking