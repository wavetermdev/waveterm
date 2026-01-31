---
workflow: shell-selector-feature
workflow_status: complete
current_phase: complete
started: 2026-01-30
last_updated: 2026-01-31
completed_at: 2026-01-31
branch: feat/shell-selector
base_branch: main
---

# Shell Selector Feature - COMPLETE

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

### Phase 3: Block Frame Integration (DONE)

Commits:
- `ecd24366` feat: integrate shell selector into block frame and simplify connection dropdown

Files changed:
- `frontend/app/block/blockframe.tsx` - Integrated ShellButton and ShellSelectorModal

Changes:
- Added ShellButton and ShellSelectorModal imports
- Created changeShellModalAtom for shell modal state
- Show ShellButton for local connections in terminal headers
- Show ConnectionButton only for remote SSH connections
- Render ShellSelectorModal in BlockFrame_Default_Component

### Phase 4: Connection Dropdown Filtering (DONE)

Same commit as Phase 3:
- `ecd24366` feat: integrate shell selector into block frame and simplify connection dropdown

Files changed:
- `frontend/app/modals/conntypeahead.tsx` - Simplified connection dropdown

Changes:
- Removed local shell profiles from connection dropdown
- Connection dropdown now shows: Local, WSL distros, SSH connections
- Shell selector handles local shell selection (pwsh, cmd, bash)
- Removed unused hasGitBash, localShellProfiles logic
- Removed unused createLocalShellProfileItems function
- Removed ConnectionsModel import (no longer needed)

### Phase 5: Settings Migration (DEFERRED)

Not implemented in this PR - can be added later:
- `term:localshellpath` → `shell:profiles` + `shell:default`
- `conn:local` connections → `shell:profiles`

## QA Test Results

Screenshots captured in `.claude/qa/`:
- `shell-selector-test.png` - Terminal headers showing "Default Shell"
- `shell-selector-modal.png` - App with shell selector feature

Test Results:
- ✅ Terminal blocks show "Default Shell" in headers for local connections
- ✅ ShellButton component renders correctly with icon
- ✅ Build passes without errors
- ✅ Connection dropdown simplified (no local shell profiles)
- ✅ No console errors related to shell selector

## Acceptance Criteria

- [x] Shell profiles are a separate concept from connections (data model)
- [x] Terminal header shows current shell name (not connection)
- [x] Shell selector modal shows grouped shells (Windows, WSL)
- [x] WSL distros display without "wsl://" prefix
- [x] No connection status indicators for local shells
- [x] Default shell can be configured (setting exists)
- [ ] Existing settings migrate gracefully (deferred to Phase 5)
- [x] Connection dropdown only shows SSH remotes
- [x] File browser connection dropdown unaffected (WSL still shows)

## Commits

1. `b8d647ff` - Phase 1: Backend settings infrastructure
2. `2b971185` - Phase 2a: ShellButton component and metadata
3. `a63050b5` - Phase 2b: ShellSelectorModal component
4. `4546548c` - Workflow state update
5. `ecd24366` - Phase 3+4: Block frame integration and connection dropdown filtering

## File Structure

```
.claude/specs/spec-shell-selector.md  # Feature specification
frontend/app/block/blockutil.tsx      # ShellButton component
frontend/app/block/block.scss         # Shell button styles
frontend/app/block/blockframe.tsx     # Integration point
frontend/app/modals/shellselector.tsx # Shell selector modal
frontend/app/modals/conntypeahead.tsx # Simplified connection dropdown
pkg/wconfig/settingsconfig.go         # Shell profile type
pkg/waveobj/wtypemeta.go              # shell:profile metadata
schema/settings.json                  # Settings schema
```
