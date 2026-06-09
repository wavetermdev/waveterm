# Spec: Remove Auto-Updater

**Date:** 2026-05-18
**Status:** Draft

## Goal

Disable and remove all automatic update checking, downloading, and installation from Wave Terminal. The fork should not contact `dl.waveterm.dev`, check GitHub releases, or install updates. No update-related UI should be visible to the user.

## What the Updater Does Today

1. **Periodic check** — On startup, then every hour (configurable via `autoupdate:intervalms`), contacts `https://dl.waveterm.dev/releases-w2` to check for new versions
2. **Automatic download** — When a newer version is found, downloads it silently in the background
3. **User notification** — Shows a system notification + in-tab-bar banner when download completes
4. **Install on click** — User clicks notification → dialog with "Restart" / "Later" → `autoUpdater.quitAndInstall()`
5. **Install on quit** — `autoUpdater.autoInstallOnAppQuit = true` (default) — installs downloaded update on next launch if user quits normally
6. **Channel selection** — Supports `latest` and `beta` channels via `autoupdate:channel` setting; reads `app-update.yml` bundled in the binary

## Scope

### What to remove/disable

- All outbound network calls to `dl.waveterm.dev`
- Background update checking (periodic + startup)
- Automatic download of new versions
- System notifications about updates
- In-tab-bar update status banner (`UpdateStatusBanner`)
- "Update Channel" line in the About modal
- IPC APIs for updater status (`onUpdaterStatusChange`, `getUpdaterStatus`, `getUpdaterChannel`, `installAppUpdate`)
- `updaterStatusAtom` in the frontend store
- `electron-updater` dependency (optional, see Phase E)
- `publish` config in `electron-builder.config.cjs`
- Default `autoupdate:*` settings values

### What to keep

- `autoupdate:*` fields in `SettingsType` (`settingsconfig.go`) — harmless, keeps fork closer to upstream
- `ConfigKey_AutoUpdate*` constants in `metaconsts.go` — auto-generated, harmless
- `autoupdate:*` entries in `schema/settings.json` — harmless
- `emain/updater.ts` file itself — stubbed to no-op, not deleted (upstream compatibility)
- `electron-updater` in `package.json` — kept as dependency (upstream compatibility, no runtime cost)

## Implementation Phases

### Phase A: Disable the updater in the Electron main process

**Goal:** No network calls to update servers. No downloads. No installs. App starts without errors.

#### A.1: Make `configureAutoUpdater()` a no-op

**File:** `emain/updater.ts`

- Replace the body of `configureAutoUpdater()` to skip all updater initialization:
  ```typescript
  export async function configureAutoUpdater() {
      console.log("skipping auto-updater (disabled in this build)");
  }
  ```
- This eliminates:
  - All calls to `autoUpdater.checkForUpdates()`
  - All event listeners on `autoUpdater`
  - All periodic intervals
  - All system notifications
  - All calls to `autoUpdater.quitAndInstall()`
- The `Updater` class, `getUpdateChannel()`, and all other code stays intact but unreachable.

#### A.2: Remove `updater?.stop()` call in cleanup

**File:** `emain/emain.ts`

- Line ~175: `updater?.stop()` — This is harmless (updater is null since `configureAutoUpdater` is a no-op), but can be removed for cleanliness.
- **Decision:** Leave it. It's a single line that does nothing when `updater` is undefined/never created. Removing it creates a larger diff for no benefit.

### Phase B: Remove update UI from the frontend

**Goal:** No update status banner, no update channel in About modal. App renders without errors.

#### B.1: Make `UpdateStatusBanner` always render null

**File:** `frontend/app/tab/updatebanner.tsx`

- Change `UpdateStatusBannerComponent` to return `null` unconditionally:
  ```typescript
  const UpdateStatusBannerComponent = () => {
      return null;
  };
  ```
- Keep the file and export intact. The component is still imported by `tabbar.tsx` and `vtabbar` preview, so keeping the export avoids cascading changes.

#### B.2: Remove "Update Channel" from the About modal

**File:** `frontend/app/modals/about.tsx`

- Remove the `updaterChannel` prop from `AboutModalVProps` interface
- Remove the "Update Channel: {updaterChannel}" line from the rendered JSX
- Remove the `updaterChannel` computation in `AboutModal` component:
  ```typescript
  // Remove this line:
  const updaterChannel = fullConfig?.settings?.["autoupdate:channel"] ?? "latest";
  ```
- Remove `updaterChannel` from the `<AboutModalV>` props

### Phase C: Stub updater IPC APIs in the frontend

**Goal:** Frontend code that references updater APIs doesn't crash. Atoms initialize cleanly.

#### C.1: Stub IPC methods in preload

**File:** `emain/preload.ts`

- Replace the 4 updater IPC bindings with stubs:
  ```typescript
  // Updater disabled — stubs for upstream compatibility
  onUpdaterStatusChange: (callback) => {}, // never fires
  getUpdaterStatus: () => "up-to-date",
  getUpdaterChannel: () => "latest",
  installAppUpdate: () => {},
  ```

#### C.2: Simplify `updaterStatusAtom` initialization

**File:** `frontend/app/store/global-atoms.ts`

- Remove the `try/catch` block that calls `getApi().getUpdaterStatus()` and `getApi().onUpdaterStatusChange()`
- Initialize the atom to `"up-to-date"` directly:
  ```typescript
  const updaterStatusAtom = atom<UpdaterStatus>("up-to-date") as PrimitiveAtom<UpdaterStatus>;
  ```
- Remove the error logging for the updater init.
- Keep the atom in the exported `atoms` object (it's referenced by tabbar env subsets and preview mocks).

#### C.3: Remove updater init from `wave.ts`

**File:** `frontend/wave.ts`

- Remove the line:
  ```typescript
  globalStore.set(atoms.updaterStatusAtom, getApi().getUpdaterStatus());
  ```
- This is redundant since the atom is already initialized to `"up-to-date"` and the IPC API is stubbed.

### Phase D: Update default settings

**Goal:** Default config reflects disabled updater. Existing user configs are harmless (settings are just ignored).

#### D.1: Set autoupdate defaults to disabled

**File:** `pkg/wconfig/defaultconfig/settings.json`

- Change `"autoupdate:enabled"` from `true` to `false`
- Leave `autoupdate:installonquit` and `autoupdate:intervalms` as-is (harmless, never read)

### Phase E: Remove `publish` config from build configuration (optional)

**Goal:** Even if someone runs `electron-builder` on the fork, it won't try to publish to upstream servers.

#### E.1: Remove publish URL from electron-builder config

**File:** `electron-builder.config.cjs`

- Remove the `publish` block:
  ```javascript
  publish: {
      provider: "generic",
      url: "https://dl.waveterm.dev/releases-w2",
  },
  ```
- This prevents the build system from generating update manifests pointing to upstream servers.

### Phase F: Remove `electron-updater` dependency (optional, later)

**Goal:** Remove the `electron-updater` npm package entirely.

#### F.1: Remove import from `emain/updater.ts`

- Remove `import { autoUpdater } from "electron-updater"`
- Remove `import YAML from "yaml"` (only used for `app-update.yml` parsing in `getUpdateChannel()`)
- Remove `import { readFileSync } from "fs"` (only used in `getUpdateChannel()`)
- Remove `import path from "path"` (only used in `getUpdateChannel()`)
- The file becomes a single-line no-op export with no dependencies.

#### F.2: Remove from `package.json`

- Remove `"electron-updater": "^6.6"` from dependencies
- Run `npm install` to update `package-lock.json`

**Recommendation:** Defer Phase F. The `electron-updater` package is ~300KB and adds no runtime overhead when `configureAutoUpdater()` is a no-op. Keeping it minimizes diff size and simplifies upstream merges.

## Implementation Order

1. **A.1** — Disable `configureAutoUpdater()` (stops all network activity immediately)
2. **B.1** — Hide update banner in tab bar
3. **B.2** — Remove update channel from About modal
4. **C.1** — Stub IPC APIs
5. **C.2** — Simplify `updaterStatusAtom`
6. **C.3** — Remove updater init from `wave.ts`
7. **D.1** — Update default settings
8. **E.1** — Remove publish config from build

## Verification Checklist

- [ ] `task dev` completes without errors
- [ ] `task start` launches the app
- [ ] No console errors related to updater
- [ ] No outbound HTTP to `dl.waveterm.dev` (verify with `lsof -i` or network monitoring)
- [ ] No update banner appears in tab bar
- [ ] About modal does not show "Update Channel"
- [ ] No system notifications about updates
- [ ] App functions normally (terminals, SSH, file browser, etc.)
- [ ] Existing tests pass (`task test` / `npm test`)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `electron-updater` import causes build errors if removed | Phase F deferred; keep dependency. Even if removed, `emain/updater.ts` stays as a no-op stub. |
| Upstream merge conflicts on `updater.ts` | Minimal changes (single function body). Rest of file untouched. |
| Existing user configs with `autoupdate:enabled: true` | Harmless — the setting is never read after `configureAutoUpdater()` is a no-op. |
| Preview mocks reference `updaterStatusAtom` | Atom stays in the atoms object, just always `"up-to-date"`. Mocks work unchanged. |
| Tabbar env subsets declare `updaterStatusAtom` | Env declarations stay unchanged; atom exists and is accessible. |
| `app-update.yml` bundled in production binary | Without `configureAutoUpdater()` creating an `Updater`, the file is never read. Can be cleaned in a later pass. |

## File Cross-Reference

### Phase A (Electron main — disable updater)

| File | Section | What changes |
|------|---------|--------------|
| `emain/updater.ts` | A.1 | `configureAutoUpdater()` → no-op |

### Phase B (Frontend — hide UI)

| File | Section | What changes |
|------|---------|--------------|
| `frontend/app/tab/updatebanner.tsx` | B.1 | Component always returns `null` |
| `frontend/app/modals/about.tsx` | B.2 | Remove "Update Channel" line + prop |

### Phase C (Frontend — stub IPC)

| File | Section | What changes |
|------|---------|--------------|
| `emain/preload.ts` | C.1 | 4 updater IPC methods → stubs |
| `frontend/app/store/global-atoms.ts` | C.2 | `updaterStatusAtom` → static `"up-to-date"`, remove IPC subscription |
| `frontend/wave.ts` | C.3 | Remove `set(atoms.updaterStatusAtom, ...)` call |

### Phase D (Default settings)

| File | Section | What changes |
|------|---------|--------------|
| `pkg/wconfig/defaultconfig/settings.json` | D.1 | `autoupdate:enabled` → `false` |

### Phase E (Build config)

| File | Section | What changes |
|------|---------|--------------|
| `electron-builder.config.cjs` | E.1 | Remove `publish` block |

### Left Untouched

| File/Directory | Why |
|----------------|-----|
| `emain/emain.ts` | `updater?.stop()` is harmless null-op; `configureAutoUpdater()` call stays (now no-op) |
| `pkg/wconfig/settingsconfig.go` | `AutoUpdate*` fields stay for upstream compatibility |
| `pkg/wconfig/metaconsts.go` | `ConfigKey_AutoUpdate*` stay (auto-generated) |
| `schema/settings.json` | `autoupdate:*` entries stay (harmless) |
| `frontend/types/custom.d.ts` | `UpdaterStatus` type + IPC API declarations stay (type-safe stubs) |
| `frontend/app/tab/tabbarenv.ts` | `updaterStatusAtom` env declaration stays |
| `frontend/app/tab/vtabbarenv.ts` | `updaterStatusAtom` env declaration stays |
| `frontend/app/tab/tabbar.tsx` | `<UpdateStatusBanner />` render stays (component returns null) |
| `frontend/preview/mock/mockwaveenv.ts` | `updaterStatusAtom` mock stays |
| `frontend/preview/previews/tabbar.preview.tsx` | `updaterStatus` usage stays |
| `frontend/preview/previews/vtabbar.preview.tsx` | `updaterStatus` usage stays |
| `package.json` | `electron-updater` dependency stays (Phase F deferred) |
| `.github/workflows/publish-release.yml` | Fork doesn't publish releases; workflow is upstream-only |
| `Taskfile.yml` | `RELEASES_BUCKET` var stays; `artifacts:publish:*` tasks are upstream-only |

## Interaction with Other Specs

- **remove-telemetry.md** — No overlap. Telemetry spec explicitly called out `autoupdate:*` settings as "genuine auto-update config, not telemetry" and left them untouched.
- **remove-waveai.md** — No overlap. AI removal doesn't touch updater code.
