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

# High Contrast Mode + Background Toggle Implementation

## Summary

This implementation adds two features to the Unified Appearance Panel:

1. **Preview Background Toggle** - Allows users to preview theme cards on different background colors
2. **High Contrast Mode** - Detects and fixes transparent segments in Oh-My-Posh configurations

## Part 1: Preview Background Toggle (spec-012)

### New Files Created

- `frontend/app/element/settings/preview-background-toggle.tsx` - Toggle component
- `frontend/app/element/settings/preview-background-toggle.scss` - Styling

### Features

- Three preview modes:
  - **Dark**: Preview all themes on dark background (#1a1a1a)
  - **Light**: Preview all themes on light background (#fafafa)
  - **Split**: Show each theme card split 50/50 (left dark, right light)
- Keyboard accessible (arrow keys to switch modes)
- ARIA labels for screen readers
- Toggle state persists within session (not saved to config)

### Modified Files

- `frontend/app/element/settings/termtheme-control.tsx` - Added `previewBackground` prop
- `frontend/app/element/settings/omptheme-control.tsx` - Added `previewBackground` prop
- `frontend/app/view/waveconfig/appearance-content.tsx` - Integrated toggle above theme selectors

## Part 2: High Contrast Mode (spec-013)

### New Files Created

- `frontend/app/element/settings/omp-high-contrast.tsx` - High contrast UI component
- `frontend/app/element/settings/omp-high-contrast.scss` - Styling

### Backend Changes

#### `pkg/wshutil/omputil.go`

Added functions for transparent segment detection and high contrast mode:

- `TransparentSegmentInfo` - Struct for segment info
- `OmpSegment`, `OmpBlock`, `OmpConfig` - Types for parsing OMP config
- `ParseOmpConfig()` - Parse OMP config from JSON
- `isTransparent()` - Check if background is transparent
- `DetectTransparentSegments()` - Find segments with transparent backgrounds
- `resolveColor()` - Resolve palette references (p:colorname)
- `ApplyHighContrastMode()` - Add contrasting backgrounds based on foreground luminance
- `deepCopyOmpConfig()` - Deep copy config structure
- `SerializeOmpConfig()` - Serialize config back to JSON
- `GetBackupPath()` - Get backup file path
- `CreateOmpBackup()` - Create backup of config
- `RestoreOmpBackup()` - Restore config from backup

Note: Uses existing `CalculateLuminance` and `IsLightColor` functions from `colorutil.go`.

#### `pkg/wshrpc/wshrpctypes.go`

Added new RPC command types:

- `CommandOmpAnalyzeData` - Analysis request (empty)
- `CommandOmpAnalyzeRtnData` - Analysis result with transparent segments list
- `TransparentSegmentInfo` - Info about each transparent segment
- `CommandOmpApplyHighContrastData` - High contrast request with backup option
- `CommandOmpApplyHighContrastRtnData` - Result with backup/modified paths
- `CommandOmpRestoreBackupData` - Restore request (empty)
- `CommandOmpRestoreBackupRtnData` - Restore result

Added interface methods:
- `OmpAnalyzeCommand`
- `OmpApplyHighContrastCommand`
- `OmpRestoreBackupCommand`

#### `pkg/wshrpc/wshserver/wshserver.go`

Implemented handlers for the new commands:

- `OmpAnalyzeCommand` - Parses config and detects transparent segments
- `OmpApplyHighContrastCommand` - Creates backup (optional), applies high contrast mode
- `OmpRestoreBackupCommand` - Restores config from backup file

### Frontend Component Features

- **Warning banner** when transparent segments detected
- **Apply button** to enable high contrast mode
- **Restore button** to restore from backup (after applying)
- **Details section** showing affected segments with:
  - Block and segment indices
  - Segment type
  - Foreground color with swatch

### High Contrast Algorithm

1. Parse OMP config file
2. Find segments with `background: "transparent"` or empty background
3. For each transparent segment:
   - Resolve foreground color (including palette references like `p:blue`)
   - Calculate foreground luminance using WCAG 2.0 formula
   - If foreground is light (luminance > 0.5): add dark background (#1a1a1a)
   - If foreground is dark (luminance < 0.5): add light background (#f5f5f5)
4. Write modified config (with backup)

## Files Changed (High Contrast Mode)

### Frontend

| File | Change |
|------|--------|
| `frontend/app/element/settings/preview-background-toggle.tsx` | New - Toggle component |
| `frontend/app/element/settings/preview-background-toggle.scss` | New - Styling |
| `frontend/app/element/settings/omp-high-contrast.tsx` | New - High contrast UI |
| `frontend/app/element/settings/omp-high-contrast.scss` | New - Styling |
| `frontend/app/element/settings/termtheme-control.tsx` | Modified - Added previewBackground prop |
| `frontend/app/element/settings/omptheme-control.tsx` | Modified - Added previewBackground prop |
| `frontend/app/element/settings/index.ts` | Modified - Export new components |
| `frontend/app/element/settings/settings-controls.scss` | Modified - Import new SCSS |
| `frontend/app/view/waveconfig/appearance-content.tsx` | Modified - Integrated components |
| `frontend/app/store/wshclientapi.ts` | Regenerated - New RPC commands |
| `frontend/types/gotypes.d.ts` | Regenerated - New types |

### Backend

| File | Change |
|------|--------|
| `pkg/wshutil/omputil.go` | Modified - Added high contrast functions |
| `pkg/wshrpc/wshrpctypes.go` | Modified - Added RPC types |
| `pkg/wshrpc/wshserver/wshserver.go` | Modified - Added handlers |
| `pkg/wshrpc/wshclient/wshclient.go` | Regenerated - New commands |

## Acceptance Criteria Status (High Contrast Mode)

- [x] PreviewBackgroundToggle shows Dark/Light/Split options
- [x] Toggle state affects theme preview backgrounds
- [x] Backend detects transparent segments in OMP config
- [x] Backend applies contrasting backgrounds based on foreground luminance
- [x] OmpHighContrast component shows warning when transparent segments exist
- [x] Toggle enables/disables high contrast mode (apply/restore)
- [x] Backup created before modifying config
- [x] Palette color references (p:colorname) resolved correctly
