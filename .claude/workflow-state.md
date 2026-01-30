---
workflow: shell-selector-feature
workflow_status: in_progress
current_phase: 2-integration
started: 2026-01-30
last_updated: 2026-01-30
branch: feat/shell-selector
base_branch: main
---

# Shell Selector Feature - Implementation Progress

## Summary

This feature separates local shells (cmd, pwsh, bash, WSL) from remote connections (SSH).
The key insight is that shells are NOT connections - they're just local processes that get spawned.

## Completed Work

### Phase 1: Backend Settings Infrastructure (DONE)

Commits:
- `b8d647ff` feat: add shell profile settings infrastructure (Phase 1)

Files changed:
- `pkg/wconfig/settingsconfig.go` - Added ShellProfileType struct, shell settings
- `pkg/wconfig/metaconsts.go` - Generated ConfigKey_Shell* constants
- `schema/settings.json` - Added shell:* settings schema
- `frontend/types/gotypes.d.ts` - Generated TypeScript types
- `frontend/app/store/settings-registry.ts` - Added Shell category (hidden)

New settings:
- `shell:default` - Default shell profile ID
- `shell:profiles` - Map of custom shell profile configurations

### Phase 2: UI Components (DONE)

Commits:
- `2b971185` feat: add ShellButton component and shell:profile metadata (Phase 2)
- `a63050b5` feat: add ShellSelectorModal for selecting shell profiles (Phase 2)

Files changed:
- `pkg/waveobj/wtypemeta.go` - Added ShellProfile field to MetaTSType
- `pkg/waveobj/metaconsts.go` - Generated MetaKey_ShellProfile constant
- `frontend/app/block/blockutil.tsx` - Added ShellButton component, helper functions
- `frontend/app/block/block.scss` - Added .shell-button styles
- `frontend/app/modals/shellselector.tsx` - NEW: Shell selector modal

Features implemented:
- ShellButton component displays current shell name with icon
- ShellSelectorModal shows grouped shells (Windows, WSL)
- shell:profile metadata key for terminal blocks
- Icons for different shell types (PowerShell, CMD, WSL distros)
- Search/filter support in modal
- Keyboard navigation

## Remaining Work

### Phase 3: Block Frame Integration (TODO)

Wire up the shell selector to the terminal block header:
1. Add `changeShellModalAtom` to BlockFrame
2. Show ShellButton for local terminals (when connection is empty/local)
3. Show ConnectionButton only for remote SSH connections
4. Render ShellSelectorModal in BlockFrame
5. Update viewModel to include `manageShell` atom

Key decision needed: When to show ShellButton vs ConnectionButton?
- Option A: Always show ShellButton for local, ConnectionButton for remote
- Option B: Replace ConnectionButton entirely for terminals, use it only for file browser

### Phase 4: Connection Dropdown Filtering (TODO)

Remove local shells from connection dropdown:
- Update `conntypeahead.tsx` to filter out shell profiles entirely
- Connection dropdown should only show SSH remotes
- File browser keeps showing WSL/local for filesystem distinction

### Phase 5: Settings Migration (TODO)

Migrate existing settings:
- `term:localshellpath` → `shell:profiles` + `shell:default`
- `conn:local` connections → `shell:profiles`

## File Structure

```
.claude/specs/spec-shell-selector.md  # Feature specification
frontend/app/block/blockutil.tsx      # ShellButton component
frontend/app/block/block.scss         # Shell button styles
frontend/app/modals/shellselector.tsx # Shell selector modal
pkg/wconfig/settingsconfig.go         # Shell profile type
schema/settings.json                  # Settings schema
```

## Testing Notes

Build verified: `npx electron-vite build` passes successfully

To test the components manually:
1. The ShellButton and ShellSelectorModal are implemented but not yet wired up
2. The shell:profile metadata key is available for terminal blocks
3. Shell profiles can be configured in shell:profiles setting

## Acceptance Criteria Progress

- [x] Shell profiles are a separate concept from connections (data model)
- [ ] Terminal header shows current shell name (not connection) - component ready, not wired
- [ ] Shell selector modal shows grouped shells (Windows, WSL) - component ready, not wired
- [x] WSL distros display without "wsl://" prefix
- [x] No connection status indicators for local shells
- [ ] Default shell can be configured - setting exists, no UI yet
- [ ] Existing settings migrate gracefully - not implemented
- [ ] Connection dropdown only shows SSH remotes - not implemented
- [x] File browser connection dropdown unaffected
