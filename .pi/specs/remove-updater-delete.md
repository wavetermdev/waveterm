# Spec: Delete Updater Dead Code

**Date:** 2026-05-18
**Status:** Draft
**Prerequisite:** [[.pi/specs/remove-updater.md]] (all phases A-E complete)

## Goal

Delete all unreachable updater code left behind by the disable-phase. After this spec, no updater-related code or dependencies remain in the fork.

## Background

The disable-phase ([[.pi/specs/remove-updater.md]]) made `configureAutoUpdater()` a no-op and stubbed IPC APIs, but left the `Updater` class, event listeners, and menu items intact for upstream compatibility. Several files still import from `emain/updater.ts` and reference the `updater` object. This spec removes all of it.

## What Remains After Disable-Phase

| File | What's Left | Status |
|------|-------------|--------|
| `emain/updater.ts` | Full `Updater` class, `getUpdateChannel()`, event listeners, `autoUpdater` import, `configureAutoUpdater()` no-op | Dead code |
| `emain/emain-menu.ts` | "Check for Updates" menu item → `updater?.checkForUpdates(true)` | Calls dead code |
| `emain/emain-wavesrv.ts` | `import { updater }`, checks `updater?.status == "installing"` before restart | Always false |
| `emain/emain-window.ts` | `import { updater }`, checks `updater?.status == "installing"` in quit handlers (2 places) | Always false |
| `emain/emain-wsh.ts` | `import { getResolvedUpdateChannel }`, `handle_getupdatechannel()` RPC handler | Returns stale value |
| `emain/emain.ts` | `updater?.stop()` in cleanup, `import { configureAutoUpdater, updater }` | Both no-ops |
| `package.json` | `"electron-updater": "^6.6"` dependency | Unused |

## Implementation Phases

### Phase A: Remove updater references from Electron main process

**Goal:** No file imports from `emain/updater.ts`. All updater-related menu items and guards removed.

#### A.1: Remove "Check for Updates" menu item

**File:** `emain/emain-menu.ts`

- Remove the import: `import { updater } from "./updater"`
- Remove the "Check for Updates" menu item from `appMenuItems`:
  ```typescript
  {
      label: "Check for Updates",
      click: () => {
          fireAndForget(() => updater?.checkForUpdates(true));
      },
  },
  ```
- Keep the "About Wave Terminal" item and separator (adjust separator if needed for menu formatting)

**Before:**
```typescript
const appMenuItems: Electron.MenuItemConstructorOptions[] = [
    { label: "About Wave Terminal", ... },
    { label: "Check for Updates", ... },
    { type: "separator" },
];
```

**After:**
```typescript
const appMenuItems: Electron.MenuItemConstructorOptions[] = [
    { label: "About Wave Terminal", ... },
    { type: "separator" },
];
```

#### A.2: Remove updater guard from wavesrv restart

**File:** `emain/emain-wavesrv.ts`

- Remove the import: `import { updater } from "./updater"`
- Remove the `updater?.status == "installing"` check from the restart logic
- The check is a guard that prevents restart during an update install. Since updates are disabled, this check is always false and can be removed.

**Before (approximate):**
```typescript
if (updater?.status == "installing") {
    // skip restart during update install
}
```

**After:**
```typescript
// (check removed — updater disabled)
```

#### A.3: Remove updater guards from window quit handlers

**File:** `emain/emain-window.ts`

- Remove the import: `import { updater } from "./updater"`
- Remove `updater?.status == "installing"` from quit handler guards (2 locations, lines ~304 and ~335)
- These checks prevent window close during update install. Always false now.

**Before (line ~304):**
```typescript
if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
```

**After:**
```typescript
if (getGlobalIsQuitting() || getGlobalIsRelaunching()) {
```

**Before (line ~335):**
```typescript
if (getGlobalIsQuitting() || updater?.status == "installing") {
```

**After:**
```typescript
if (getGlobalIsQuitting()) {
```

#### A.4: Remove `handle_getupdatechannel` RPC handler

**File:** `emain/emain-wsh.ts`

- Remove the import: `import { getResolvedUpdateChannel } from "emain/updater"`
- Remove the `handle_getupdatechannel()` method entirely

**Before:**
```typescript
async handle_getupdatechannel(rh: RpcResponseHelper): Promise<string> {
    return getResolvedUpdateChannel();
}
```

**After:**
```typescript
// (method removed)
```

#### A.5: Clean up `emain/emain.ts`

**File:** `emain/emain.ts`

- Remove `updater` from the import: change `import { configureAutoUpdater, updater } from "./updater"` to `import { configureAutoUpdater } from "./updater"`
- Remove `updater?.stop()` call (line ~175) — updater is never created, this is a no-op

### Phase B: Delete `emain/updater.ts`

**Goal:** The entire updater file is removed. All imports are already cleaned in Phase A.

#### B.1: Delete the file

- Delete: `emain/updater.ts`
- This removes: `Updater` class (~150 lines), `getUpdateChannel()`, `getResolvedUpdateChannel()`, all `autoUpdater` event listeners, `configureAutoUpdater()` no-op

#### B.2: Remove `configureAutoUpdater` import from `emain/emain.ts`

- Remove `import { configureAutoUpdater } from "./updater"` (the last remaining import)
- Remove the `await configureAutoUpdater()` call from the startup sequence (line ~303)

### Phase C: Remove `electron-updater` dependency

**Goal:** The npm package is no longer in the project.

#### C.1: Remove from `package.json`

- Remove `"electron-updater": "^6.6"` from dependencies

#### C.2: Update lock file

- Run `npm install` to regenerate `package-lock.json` without `electron-updater`

### Phase D: Clean up stub IPC APIs (optional)

**Goal:** Remove the stubbed IPC methods that no longer serve any purpose.

#### D.1: Remove stubs from preload

**File:** `emain/preload.ts`

- Remove the 4 updater IPC stubs:
  ```typescript
  onUpdaterStatusChange: (callback) => {},
  getUpdaterStatus: () => "up-to-date",
  getUpdaterChannel: () => "latest",
  installAppUpdate: () => {},
  ```

#### D.2: Remove type declarations

**File:** `frontend/types/custom.d.ts`

- Remove from `ElectronApi` interface:
  ```typescript
  onUpdaterStatusChange: (callback: (status: UpdaterStatus) => void) => void;
  getUpdaterStatus: () => UpdaterStatus;
  getUpdaterChannel: () => string;
  installAppUpdate: () => void;
  ```
- Remove `UpdaterStatus` type:
  ```typescript
  type UpdaterStatus = "up-to-date" | "checking" | "downloading" | "ready" | "error" | "installing";
  ```

#### D.3: Remove `updaterStatusAtom` from global atoms

**File:** `frontend/app/store/global-atoms.ts`

- Remove `updaterStatusAtom` declaration
- Remove it from the exported `atoms` object

#### D.4: Remove updaterStatusAtom from env subsets

| File | What to remove |
|------|----------------|
| `frontend/app/tab/tabbarenv.ts` | `updaterStatusAtom` from env subset type |
| `frontend/app/tab/vtabbarenv.ts` | `updaterStatusAtom` from env subset type |

#### D.5: Remove from preview mocks

| File | What to remove |
|------|----------------|
| `frontend/preview/mock/mockwaveenv.ts` | `updaterStatusAtom` from mock atoms |
| `frontend/preview/mock/preview-electron-api.ts` | `onUpdaterStatusChange`, `getUpdaterStatus`, `getUpdaterChannel`, `installAppUpdate` stubs |
| `frontend/preview/previews/tabbar.preview.tsx` | `updaterStatus` usage |
| `frontend/preview/previews/vtabbar.preview.tsx` | `updaterStatus` usage |

#### D.6: Remove `UpdateStatusBanner` entirely

| File | What to remove |
|------|----------------|
| `frontend/app/tab/updatebanner.tsx` | Delete entire file |
| `frontend/app/tab/tabbar.tsx` | Remove `import { UpdateStatusBanner }` and `<UpdateStatusBanner />` render |

### Phase E: Clean up Go autoupdate settings (optional, later)

**Goal:** Remove `autoupdate:*` fields from Go config structs.

> **Recommendation: Defer this phase.** The Go fields are harmless and keeping them minimizes upstream merge conflicts. Only remove if the fork diverges significantly from upstream.

| File | What to remove |
|------|----------------|
| `pkg/wconfig/settingsconfig.go` | `AutoUpdateClear`, `AutoUpdateEnabled`, `AutoUpdateIntervalMs`, `AutoUpdateInstallOnQuit`, `AutoUpdateChannel` fields |
| `pkg/wconfig/metaconsts.go` | `ConfigKey_AutoUpdate*` constants (auto-generated; regenerate after settingsconfig change) |
| `pkg/wconfig/defaultconfig/settings.json` | `autoupdate:enabled`, `autoupdate:installonquit`, `autoupdate:intervalms` entries |
| `schema/settings.json` | `autoupdate:*`, `autoupdate:enabled`, `autoupdate:intervalms`, `autoupdate:installonquit`, `autoupdate:channel` entries |
| `frontend/types/gotypes.d.ts` | Auto-generated; regenerate after Go changes |

## Implementation Order

1. **A.1** — Remove "Check for Updates" menu item
2. **A.2** — Remove updater guard from wavesrv restart
3. **A.3** — Remove updater guards from window quit handlers
4. **A.4** — Remove `handle_getupdatechannel` RPC handler
5. **A.5** — Clean up `emain.ts` import + `updater?.stop()`
6. **B.1** — Delete `emain/updater.ts`
7. **B.2** — Remove `configureAutoUpdater` import + call from `emain.ts`
8. **C.1** — Remove `electron-updater` from `package.json`
9. **C.2** — `npm install` to update lock file
10. **D.1–D.6** — Clean up stub IPC APIs (optional)
11. **E** — Clean up Go settings (deferred)

## Verification Checklist

- [ ] `task dev` completes without errors
- [ ] `task start` launches the app
- [ ] No "Check for Updates" menu item in the app menu
- [ ] No console errors about missing `updater` module
- [ ] No `electron-updater` in `package.json` dependencies
- [ ] `emain/updater.ts` no longer exists
- [ ] App functions normally (terminals, SSH, file browser, etc.)
- [ ] Existing tests pass

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `updater?.status == "installing"` guards prevent restart/quit during updates | Always false now; removing them is safe. No update can ever reach "installing" state. |
| `handle_getupdatechannel` RPC called by external code | Only called by frontend via IPC; frontend stub already returns `"latest"`. After D.2, no callers remain. |
| Upstream merge conflicts on `emain/` files | Larger diff than disable-phase, but changes are surgical (remove specific lines, not restructure files). |
| `electron-updater` transitive dependencies | Removing it may clean up several sub-dependencies. `npm install` handles this. |
| Preview mocks break without `updaterStatusAtom` | Phase D handles mock cleanup. If Phase D is deferred, mocks still work (atom returns static value). |

## File Cross-Reference

### Phase A (Remove updater references)

| File | Section | What changes |
|------|---------|--------------|
| `emain/emain-menu.ts` | A.1 | Remove `updater` import + "Check for Updates" menu item |
| `emain/emain-wavesrv.ts` | A.2 | Remove `updater` import + `updater?.status == "installing"` guard |
| `emain/emain-window.ts` | A.3 | Remove `updater` import + 2 `updater?.status == "installing"` guards |
| `emain/emain-wsh.ts` | A.4 | Remove `getResolvedUpdateChannel` import + `handle_getupdatechannel()` method |
| `emain/emain.ts` | A.5 | Remove `updater` from import + `updater?.stop()` call |

### Phase B (Delete updater file)

| File | Section | What changes |
|------|---------|--------------|
| `emain/updater.ts` | B.1 | Delete entire file |
| `emain/emain.ts` | B.2 | Remove `configureAutoUpdater` import + `await configureAutoUpdater()` call |

### Phase C (Remove dependency)

| File | Section | What changes |
|------|---------|--------------|
| `package.json` | C.1 | Remove `"electron-updater"` from dependencies |
| `package-lock.json` | C.2 | Regenerated by `npm install` |

### Phase D (Clean up stubs — optional)

| File | Section | What changes |
|------|---------|--------------|
| `emain/preload.ts` | D.1 | Remove 4 updater IPC stubs |
| `frontend/types/custom.d.ts` | D.2 | Remove `UpdaterStatus` type + 4 IPC API declarations |
| `frontend/app/store/global-atoms.ts` | D.3 | Remove `updaterStatusAtom` declaration + export |
| `frontend/app/tab/tabbarenv.ts` | D.4 | Remove `updaterStatusAtom` from env subset |
| `frontend/app/tab/vtabbarenv.ts` | D.4 | Remove `updaterStatusAtom` from env subset |
| `frontend/preview/mock/mockwaveenv.ts` | D.5 | Remove `updaterStatusAtom` from mock atoms |
| `frontend/preview/mock/preview-electron-api.ts` | D.5 | Remove 4 updater API stubs |
| `frontend/preview/previews/tabbar.preview.tsx` | D.5 | Remove `updaterStatus` usage |
| `frontend/preview/previews/vtabbar.preview.tsx` | D.5 | Remove `updaterStatus` usage |
| `frontend/app/tab/updatebanner.tsx` | D.6 | Delete entire file |
| `frontend/app/tab/tabbar.tsx` | D.6 | Remove `UpdateStatusBanner` import + render |

### Phase E (Go settings — deferred)

| File | Section | What changes |
|------|---------|--------------|
| `pkg/wconfig/settingsconfig.go` | E | Remove `AutoUpdate*` fields |
| `pkg/wconfig/metaconsts.go` | E | Remove `ConfigKey_AutoUpdate*` constants |
| `pkg/wconfig/defaultconfig/settings.json` | E | Remove `autoupdate:*` entries |
| `schema/settings.json` | E | Remove `autoupdate:*` schema entries |
| `frontend/types/gotypes.d.ts` | E | Regenerate after Go changes |

## Interaction with Other Specs

- **[[.pi/specs/remove-updater.md]]** — This spec is the deletion follow-up. All phases A-E of the disable-spec must be complete first.
- **[[.pi/specs/remove-waveai.md]]** — No overlap.
- **[[.pi/specs/remove-telemetry.md]]** — No overlap.
