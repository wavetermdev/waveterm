<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->


# Wave Terminal - Agent Coding Guidelines

## Project Overview

Wave Terminal is an Electron-based AI-native terminal with React frontend and Go backend. The architecture uses a custom RPC system (WSH RPC) for frontend-backend communication.

## Build Commands

### Development
```bash
task dev           # Run Electron with HMR (hot module reloading)
task start         # Run Electron standalone (no HMR)
task preview       # Run component preview server at http://localhost:7007
task init          # Initialize project (npm install + go mod tidy)
```

### Building
```bash
task package               # Package application for current platform
task build:backend         # Build Go backend (wavesrv + wsh)
task build:frontend:dev    # Build frontend in development mode
task generate              # Generate TypeScript bindings from Go types
```

### Linting & Type Checking
```bash
task check:ts      # Typecheck TypeScript (tsc --noEmit)
npx eslint .       # Run ESLint (configured in eslint.config.js)
```

## Testing

### Frontend (Vitest)
```bash
npm test               # Run tests in watch mode
npm run test           # Alias for vitest
npm run coverage       # Generate coverage report (output: ./coverage)
vitest run             # Run tests once (no watch)
```

**Run a single test:**
```bash
vitest run <test-file-pattern>     # e.g., vitest run util.test.ts
vitest -t <test-name>              # Run tests matching name
```

### Backend (Go)
```bash
go test ./pkg/...                  # Run all package tests
go test ./pkg/wshrpc/              # Run tests for specific package
```

**Run a single Go test:**
```bash
go test -run TestFunctionName ./pkg/package
go test -v -run . ./pkg/package    # Run with verbose output
```

## Code Style

### General
- **Indentation:** 4 spaces for all files (configured via .editorconfig)
- **Line endings:** LF (no CRLF)
- **Line length:** No hard limit, but be reasonable
- **Filenames:** All lowercase (except where case matters like Taskfile.yml)

### Go Conventions

**Naming:**
- Use `Make*` prefix for struct initialization functions (e.g., `MakeBlock()`, not `NewBlock()`)
- Use string constants for enums/status values (NO custom type enums)
  ```go
  const StatusRunning = "running"  // Good
  // type Status string; const StatusRunning Status = "running"  // BAD
  ```
- Global consts at top of file using PascalCase

**Code Patterns:**
- Prefer `Printf()` over `Println()`
- Use `defer` for locking: `lock.Lock(); defer lock.Unlock()`
- Create helper functions to avoid inline lock/unlock
- Prefer early returns: `if (!cond) { return }; functionality;` (less indentation)
- NEVER run `go build` in weird directories - linter errors indicate compilation issues

**Comments:**
- ONLY explain WHY, NEVER add obvious "what" comments
- Examples of BAD comments: `mutex.Lock() // Lock the mutex`, `counter++ // Increment counter`
- Comments only for non-obvious edge cases, warnings, or complex algorithms

### TypeScript/React Conventions

**Imports:**
- Use `@/...` for cross-project imports (configured in tsconfig.json)
- Use `./name` for same-directory imports only
- Named exports only (no default exports)

**Type Handling:**
- Strict null checks are OFF - no need for `| null` everywhere
- For Jotai atoms that need writing: type as `PrimitiveAtom<Type>` (not just `atom<Type>`)
- Avoid `=== undefined` / `!== undefined` - use `== null` / `!= null` instead
- `React.RefObject` is always mutable in React 19 (no `MutableRefObject` needed)

**Styling:**
- Tailwind v4 is preferred for new components
- Import `cn` from `@/util/util` for class merging (uses tailwind-merge)
- Use class-variance-authority for element variants
- Add `cursor-pointer` to clickable elements
- NEVER use `cursor-help` or `cursor-not-allowed` (looks terrible)
- Accent button style: `bg-accent/80 text-primary rounded hover:bg-accent transition-colors cursor-pointer`

**Component Patterns:**
- `useAtom()` and `useAtomValue()` are React hooks - must be called at component top level, NEVER inline in JSX
- Complete all hook calls before any conditional returns
- If using `React.memo()`, add a `displayName` for the component
- NEVER create private fields with `#` prefix (impossible to debug/inspect)

**Jotai Model Pattern:**
- Models use singleton pattern: `private static instance`, `private constructor`, `static getInstance()`
- Simple atoms as field initializers
- Dependent atoms created in constructor
- Models use `globalStore.get/set` (no React hooks in models)
- Component side calls `getInstance()`, uses hooks like `useAtomValue(model.statusAtom)`

## Communication Patterns

### RPC System (WSH RPC)
- Define RPC calls in `pkg/wshrpc/wshrpctypes.go`
- Implement server RPCs in `pkg/wshrpc/wshserver.go`
- After modifying Go types, run `task generate` to update TypeScript bindings
- Generated files (frontend/types/gotypes.d.ts, frontend/app/store/wshclientapi.ts) - do NOT manually edit

### Electron API
```typescript
import { getApi } from "@/store/global";
getApi().getIsDev();  // Access preload functions
```
Full API defined in custom.d.ts as type `ElectronApi`.

## Configuration Files

- **package.json** - Frontend scripts, deps
- **Taskfile.yml** - Build system commands (use `task <name>`)
- **go.mod** - Go 1.25.6
- **tsconfig.json** - TypeScript config with `@` path mapping
- **eslint.config.js** - ESLint flat config
- **vitest.config.ts** - Vitest test config
- **.golangci.yml** - Go linter config (unused linter disabled)
- **prettier.config.cjs** - Prettier config with organize-imports plugin

## Directories

- `emain/` - Electron main process code
- `frontend/` - React renderer process (main app)
- `cmd/` - Go entry points (server, wsh, generators)
- `pkg/` - Go packages (wconfig, wcore, wps, etc.)
- `tsunami/` - Go-based UI component system
- `tests/` - Test files

## Important Notes

- Copyright year for new/updated files: **2026**
- The project is in unreleased POC/MVP - no backward compatibility concerns
- Database migrations in `db/migrations-wstore/` and `db/migrations-filestore/`
- Use `atob()`/`btoa()` alternatives from `frontend/util/util.ts` (UTF-8 safe)
- Prefer `replace_in_file` over `write_to_file` for existing files
- Always verify current directory before running commands
- Use `task` for all build operations, not `npm run` or `go build`
