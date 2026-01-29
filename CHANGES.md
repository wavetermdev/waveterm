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
