# Changes Summary: Race Condition Fixes with Optimistic Locking

## Overview

This implementation addresses race conditions in tab metadata updates (spec-004) by implementing optimistic locking with version checking. The changes prevent TOCTOU (Time-Of-Check-Time-Of-Use) vulnerabilities in concurrent metadata operations.

## Files Modified

### Backend (Go)

#### `pkg/wstore/wstore_dbops.go`
- Added `ErrVersionMismatch` error variable for concurrent modification detection
- Added `ErrObjectLocked` error variable for lock state rejection

#### `pkg/wstore/wstore.go`
- Added `UpdateObjectMetaWithVersion()` function:
  - Performs optimistic locking update with version checking
  - If `expectedVersion > 0` and doesn't match current version, returns `ErrVersionMismatch`
  - If `expectedVersion == 0`, behaves like `UpdateObjectMeta` (no version check)

- Added `UpdateObjectMetaIfNotLocked()` function:
  - Atomically checks lock and updates metadata
  - Lock is checked INSIDE the transaction, eliminating TOCTOU vulnerability
  - Returns `ErrObjectLocked` (wrapped in `ErrVersionMismatch`) if locked
  - Returns `ErrVersionMismatch` if version doesn't match

#### `pkg/service/objectservice/objectservice.go`
- Added `UpdateObjectMetaWithVersion()` RPC service method
- Added `UpdateObjectMetaIfNotLocked()` RPC service method
- Both methods include proper metadata annotations for TypeScript binding generation

### Frontend (TypeScript)

#### `frontend/app/view/term/termwrap.ts`
- Added debounce map (`osc7DebounceMap`) for OSC 7 updates per tab
- Added `OSC7_DEBOUNCE_MS = 300` constant for debounce delay
- Added `clearOsc7Debounce()` helper function
- Added `cleanupOsc7DebounceForTab()` exported function for memory leak prevention
- Updated `handleOsc7Command()` to:
  - Add null safety check for `tabData?.oid`
  - Use debouncing to reduce race condition window
  - Use atomic lock-aware update (`UpdateObjectMetaIfNotLocked`) instead of regular update
  - Gracefully handle version mismatch and locked state errors

#### `frontend/app/tab/tab.tsx`
- Added `getApi` to imports from `@/app/store/global` (fix for pre-existing missing import)

### Generated Files

#### `frontend/app/store/services.ts`
- Auto-generated new TypeScript methods:
  - `UpdateObjectMetaWithVersion(oref, meta, expectedVersion)`
  - `UpdateObjectMetaIfNotLocked(oref, meta, lockKey, expectedVersion)`

## Key Features Implemented

### 1. Optimistic Locking
- Uses existing `version` field in WaveObj types
- Version checked inside transaction to prevent TOCTOU
- Atomic increment of version on successful update (already implemented in `DBUpdate`)

### 2. Error Types
- **ErrVersionMismatch**: Indicates concurrent modification detected
- **ErrObjectLocked**: Indicates update rejected due to lock state
- Both errors are wrapped appropriately for consistent error handling

### 3. OSC 7 Debouncing
- 300ms debounce window for rapid directory changes
- Per-tab debounce timers in a Map
- Cleanup function to prevent memory leaks on tab close

### 4. Atomic Lock Checking
- Lock state checked INSIDE database transaction
- Eliminates race condition between lock check and update
- If lock is toggled during update, the update is safely rejected

## Acceptance Criteria Status

- [x] `UpdateObjectMetaWithVersion` added to `wstore.go`
- [x] RPC endpoints added to `objectservice.go`
- [x] OSC 7 debounce map with cleanup function
- [x] Null safety guards in `termwrap.ts`
- [x] `ErrVersionMismatch` error type created
- [x] `ErrObjectLocked` error type created
- [x] TypeScript compilation passes (our files)
- [x] Go compilation passes
- [x] Changes committed

## Testing Notes

To test the implementation:

1. **Version Mismatch Test**: Open two terminals in the same tab, rapidly change directories in both - the race condition should be handled gracefully

2. **Lock Bypass Test**: Toggle the lock while an OSC 7 update is in flight - the update should be rejected if lock is set

3. **Debounce Test**: Rapidly `cd` between directories - only the final directory should be set as basedir

4. **Memory Leak Test**: Open and close multiple tabs - the debounce map should be cleaned up

## Notes

- The spec mentions retry logic for manual updates (handleSetBaseDir, handleToggleLock) - this was NOT implemented as the spec noted it as optional for Phase 4 and the core race condition fixes are functional without it
- Pre-existing TypeScript errors in unrelated files (streamdown.tsx, notificationpopover.tsx) remain unfixed as they are not related to this implementation

---

# Phase 3: Live OMP Theme Reload

## Summary

Implemented live Oh-My-Posh (OMP) theme reloading per spec `.claude/specs/spec-011-live-omp-reload.md`. When users change their OMP theme in the Appearance panel, the OMP prompt is automatically reinitialized in all active terminals without requiring restart.

## Changes Made

### Backend (Go)

#### `pkg/wshrpc/wshrpctypes.go`
- Added `CommandOmpReinitData` struct with `BlockId` field
- Added `OmpReinitCommand` method to `WshRpcInterface`

#### `pkg/wshrpc/wshserver/wshserver.go`
- Implemented `OmpReinitCommand` handler that:
  - Validates block exists and is a terminal (view=term)
  - Detects shell type from:
    1. Block metadata (`term:localshellpath`)
    2. Global settings (`TermLocalShellPath`)
    3. System default (via `shellutil.DetectLocalShellPath()`)
  - Generates appropriate reinit command based on shell type:
    - **PowerShell**: `oh-my-posh init pwsh --config $env:POSH_THEME | Invoke-Expression`
    - **Bash**: `eval "$(oh-my-posh init bash --config $POSH_THEME)"`
    - **Zsh**: `eval "$(oh-my-posh init zsh --config $POSH_THEME)"`
  - Sends command to terminal via `blockcontroller.SendInput()`
  - Returns error for unsupported shell types (fish, cmd, unknown)

### Generated Files

#### `frontend/types/gotypes.d.ts`
- Added `CommandOmpReinitData` TypeScript type

#### `frontend/app/store/wshclientapi.ts`
- Added `OmpReinitCommand` RPC method binding

#### `pkg/wshrpc/wshclient/wshclient.go`
- Added `OmpReinitCommand` client binding

### Frontend (TypeScript/React)

#### `frontend/app/view/waveconfig/appearance-content.tsx`
- Added `reinitOmpInAllTerminals()` utility function that:
  - Fetches all blocks in current workspace via `BlocksListCommand`
  - Filters for terminal blocks (`meta.view === "term"`)
  - Sends `OmpReinitCommand` to each terminal
  - Handles errors gracefully (logs warnings but doesn't fail)
- Updated `handleOmpThemeChange` callback to:
  - Save the setting via `settingsService.setSetting()`
  - Trigger OMP reinit in all terminals

## Acceptance Criteria Status

- [x] OmpReinitCommand handler exists and works for PowerShell, Bash, Zsh
- [x] Handler validates block exists and is a terminal before sending command
- [x] Frontend can trigger reinit after theme changes
- [x] Errors handled gracefully (OMP not installed, invalid config - command just runs in shell)
- [x] Shell type detection works correctly (cascades from block -> settings -> system)

## Security Considerations Addressed

- Only executes the specific reinit command, not arbitrary input
- Validates block exists and is a terminal type before sending
- Shell type detection is done entirely on backend (frontend just passes block ID)

## Commits

1. `d135958d` - feat(omp): add OmpReinitCommand for live theme reload
2. `967f8cb6` - chore: regenerate TypeScript bindings for OmpReinitCommand
3. `e1925bd7` - feat(omp): trigger OMP reinit on theme change in UI

## Testing Notes

To test this feature:
1. Open Wave Terminal with OMP installed and configured
2. Open a terminal with a supported shell (pwsh, bash, or zsh)
3. Go to Settings > Appearance > Oh-My-Posh Integration
4. Select a different OMP theme
5. Observe the terminal receiving the reinit command and updating the prompt

If OMP is not installed or POSH_THEME is not set, the reinit command will still be sent but will fail gracefully in the shell (showing a "command not found" error or similar).
