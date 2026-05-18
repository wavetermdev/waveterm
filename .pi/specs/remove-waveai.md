# Spec: Remove Wave AI Features

**Date:** 2026-05-12
**Status:** Draft

## Goal

Disable and hide all Wave AI features from the UI. Do not delete code initially — comment out or guard behind no-ops so the fork stays close to upstream and re-enabling is trivial.

## Scope

### What to remove/disable

- Wave AI chat panel (`waveai` block type)
- AI file diff viewer (`aifilediff` block type)
- AI modes configuration (`waveai.json`)
- AI presets configuration (`aipresets.json`)
- AI-related keyboard shortcuts
- AI focus management
- AI RPC commands (frontend client + backend server)
- AI web endpoints
- AI activity telemetry
- AI config fields in `settingsconfig.go`
- AI documentation pages
- `ai:apitokensecretname` field (AI token via secrets)
- AI button in tab bar (`WaveAIButton`)
- AI panel from workspace layout
- AI onboarding page (`WaveAIPage`, `fakechat.tsx`)

### What to keep

- `pkg/secretstore/` — general encrypted key-value store (used by SSH passwords, potentially future features)
- `ssh:passwordsecretname` — SSH password via secrets (non-AI use case)

## Implementation Phases

### Phase A: Disable the UI (frontend only)

**Goal:** AI panels cannot be opened, AI is not visible in any menus or settings. App builds and runs without errors.

#### A.1: Unregister AI block types

**File:** `frontend/app/block/blockregistry.ts`

- Comment out or remove: `BlockRegistry.set("waveai", WaveAiModel)`
- Comment out or remove: `BlockRegistry.set("aifilediff", AiFileDiffViewModel)`
- Remove imports: `WaveAiModel`, `AiFileDiffViewModel`

**Verification:** App starts without errors. No AI block types registered.

#### A.2: Strip AI from block utilities

**File:** `frontend/app/block/blockutil.tsx`

- Remove the `view == "waveai"` cases in `getBlockTitle()` and `getBlockIcon()` (or return empty/nil)

#### A.3: Remove AI keyboard shortcuts

**File:** `frontend/app/store/keymodel.ts`

- Remove the `WaveAIModel` import
- Remove all `WaveAIModel.getInstance()` calls (lines ~151, 155, 177, 184, 192, 199, 227, 248, 252, 260, 265, 268, 687, 691, 696, 700)
- Remove `focusType === "waveai"` branches
- Remove `inWaveAI` variable and related navigation logic

#### A.4: Remove AI focus management

**File:** `frontend/app/store/focusManager.ts`

- Remove `waveAIHasFocusWithin` and `WaveAIModel` imports
- Change `FocusStrType` from `"node" | "waveai"` to just `"node"`
- Remove `setWaveAIFocused()` and `requestWaveAIFocus()` methods
- Remove `"waveai"` branches in focus handling

#### A.5: Remove AI global atoms

**File:** `frontend/app/store/global-atoms.ts`

- Remove `waveaiModeConfigAtom`
- Remove `ai@` preset filtering logic (line ~68)
- Remove from exported atoms list

#### A.6: Remove AI event listeners

**File:** `frontend/app/store/global.ts`

- Remove `waveai:modeconfig` event handler
- Remove `waveai:ratelimit` event handler

#### A.7: Remove AI RPC client methods

**File:** `frontend/app/store/wshclientapi.ts`

- Remove: `GetWaveAIChatCommand`, `GetWaveAIModeConfigCommand`, `GetWaveAIRateLimitCommand`, `WaveAIAddContextCommand`, `WaveAIEnableTelemetryCommand`, `WaveAIGetToolDiffCommand`, `WaveAIToolApproveCommand`

**File:** `frontend/app/store/tabrpcclient.ts`

- Remove `WaveAIModel` import
- Remove `handle_waveaiaddcontext()` method

#### A.8: Remove AI from term model

**File:** `frontend/app/view/term/term-model.ts`

- Remove `WaveAIModel` import
- Remove the AI-related code at line ~848

#### A.9: Remove AI config file handling

**File:** `frontend/app/view/waveconfig/waveconfig-model.ts`

- Remove the `waveai.json` config file entry (line ~84)
- Remove `validateWaveAiJson()` function
- Remove `aipresets.json` references (line ~122)

**File:** `frontend/app/monaco/schemaendpoints.ts`

- Remove `waveaiSchema` import and registration
- Remove `aipresetsSchema` import and registration

**File:** `frontend/preview/mock/defaultconfig.ts`

- Remove `waveaiJson` import
- Remove `waveai` entry from mock config

#### A.10: Remove AI visual component

**File:** `frontend/app/view/waveconfig/waveaivisual.tsx`

- Mark as unused (can keep file but it won't be imported anywhere)

#### A.11: Remove AI button from tab bar

**File:** `frontend/app/tab/tabbar.tsx`

- Remove `WaveAIButton` component (lines ~48-76)
- Remove `<WaveAIButton divRef={waveAIButtonRef} />` from render (line ~616)
- Remove `waveAIButtonRef` usage
- Remove `export { TabBar, WaveAIButton }` — change to `export { TabBar }`

#### A.12: Remove AI from workspace

**File:** `frontend/app/workspace/workspace.tsx`

- Remove `import { AIPanel } from "@/app/aipanel/aipanel"`
- Remove `getApi().setWaveAIOpen(isVisible)` call (line ~87)
- Remove `<AIPanel>` rendering from JSX

**File:** `frontend/app/workspace/workspace-layout-model.ts`

- Remove `import { WaveAIModel } from "@/app/aipanel/waveai-model"`
- Remove `waveai:panelopen` and `waveai:panelwidth` meta key handling (lines ~93, ~133, ~137)
- Remove `getApi().setWaveAIOpen(visible)` call (line ~397)
- Remove `WaveAIModel.getInstance().focusInput()` call (line ~409)
- Remove the "vtab stays constant, aipanel absorbs the change" logic (line ~230)

#### A.13: Remove AI from onboarding

**File:** `frontend/app/onboarding/onboarding-features.tsx`

- Remove `WaveAIPage` component (lines ~22-247)
- Remove `"waveai"` from `FeaturePageName` type
- Change default `currentPage` from `"waveai"` to next feature (e.g., `"durable"`)
- Remove `"waveai"` case from page navigation logic
- Remove `handlePrev()` navigation to `"waveai"`

**File:** `frontend/app/onboarding/fakechat.tsx`

- Mark as unused (won't be imported after WaveAIPage is removed)

#### A.14: Electron main — remove AI activity tracking

**File:** `emain/emain.ts`

- Already clean — no AI references found (telemetry removed in prior phase)

**File:** `emain/emain-window.ts`

- Remove `ipcMain.on("set-waveai-open", ...)` handler (line ~760)

**File:** `emain/preload.ts`

- Remove `setWaveAIOpen` from IPC exposed methods (line ~65)

**File:** `emain/emain-tabview.ts`

- Remove `isWaveAIOpen` field from tab view struct (line ~121)
- Remove `this.isWaveAIOpen = false` initialization (line ~145)

### Phase B: Remove backend wiring (Go)

**Goal:** No AI RPC handlers, no AI config fields, no AI web endpoints. `pkg/aiusechat/` stays intact but unused.

#### B.1: Remove AI RPC types

**File:** `pkg/wshrpc/wshrpctypes.go`

- Remove from interface: `GetWaveAIModeConfigCommand`, `WaveAIEnableTelemetryCommand`, `GetWaveAIChatCommand`, `GetWaveAIRateLimitCommand`, `WaveAIToolApproveCommand`, `WaveAIAddContextCommand`, `WaveAIGetToolDiffCommand`
- Remove types: `CommandGetWaveAIChatData`, `CommandWaveAIToolApproveData`, `CommandWaveAIAddContextData`, `CommandWaveAIGetToolDiffData`, `CommandWaveAIGetToolDiffRtnData`
- Remove from telemetry props: `WaveAIFgMinutes`, `WaveAIActiveMinutes`
- Remove `uctypes` import if no longer needed

#### B.2: Remove AI RPC server handlers

**File:** `pkg/wshrpc/wshserver/wshserver.go`

- Remove: `GetWaveAIModeConfigCommand()`, `WaveAIEnableTelemetryCommand()`, `GetWaveAIChatCommand()`, `GetWaveAIRateLimitCommand()`, `WaveAIToolApproveCommand()`, `WaveAIGetToolDiffCommand()`
- Remove imports: `aiusechat`, `chatstore`, `uctypes` (if no other uses remain)

#### B.3: Remove AI RPC client helpers

**File:** `pkg/wshrpc/wshclient/wshclient.go`

- Remove: `GetWaveAIChatCommand()`, `GetWaveAIModeConfigCommand()`, `GetWaveAIRateLimitCommand()`, `WaveAIAddContextCommand()`, `WaveAIEnableTelemetryCommand()`, `WaveAIGetToolDiffCommand()`, `WaveAIToolApproveCommand()`
- Remove `uctypes` import if no longer needed

#### B.4: Remove AI web endpoints

**File:** `pkg/web/web.go`

- Remove: `/api/post-chat-message` handler
- Remove: `/wave/aichat` handler
- Remove `aiusechat` import if no longer needed

#### B.5: Remove AI initialization

**File:** `cmd/server/main-server.go`

- Remove: `aiusechat.InitAIModeConfigWatcher()` call
- Remove `aiusechat` import if no longer needed

#### B.6: Remove AI config fields

**File:** `pkg/wconfig/settingsconfig.go`

- Remove from `FrontendConfig`: `WaveAiShowCloudModes`, `WaveAiDefaultMode`
- Remove from `AIProviderConfig`: `WaveAICloud`, `WaveAIPremium`
- Remove from `FullConfig`: `WaveAIModes`
- Remove `GetCustomAIModeConfigs()` function
- Remove `ai:apitokensecretname` from `AIProviderConfig` (field `APITokenSecretName`)
- Remove `AIModeConfigType` if no longer referenced

#### B.7: Remove AI TypeScript generation

**File:** `pkg/tsgen/tsgenevent.go`

- Remove: `Event_WaveAIRateLimit` mapping
- Remove `uctypes` import if no longer needed

#### B.8: Remove default AI config

**File:** `pkg/wconfig/defaultconfig/waveai.json`

- Delete or mark as unused (won't be loaded if `WaveAIModes` is removed from config)

### Phase C: Clean up docs & schemas

**Goal:** No AI references in public-facing documentation or JSON schemas.

#### C.1: Remove AI documentation

- Delete: `docs/docs/waveai.mdx`
- Delete: `docs/docs/waveai-modes.mdx`
- Delete: `docs/docs/ai-presets.mdx`
- Audit: `docs/docs/secrets.mdx` — remove AI token examples, keep SSH password secret examples
- Audit: `docs/docs/config.mdx` — remove AI config references
- Audit: `docs/docs/telemetry.mdx` — remove AI telemetry references
- Audit: `docs/docs/connections.mdx` — remove `ai:apitokensecretname` references

#### C.2: Remove JSON schemas

- Delete: `schema/waveai.json`
- Delete: `schema/aipresets.json`

### Phase D: Delete unused code (optional, later)

**Goal:** Remove dead code after the fork is stable and verified.

- Delete: `pkg/aiusechat/` (entire directory, ~12K lines)
- Delete: `frontend/app/aipanel/` (17 files)
- Delete: `frontend/app/view/waveai/waveai.tsx`
- Delete: `frontend/app/view/aifilediff/aifilediff.tsx`
- Delete: `frontend/app/view/waveconfig/waveaivisual.tsx`

## Implementation Order

Start with deepest dependencies and work up to UI components to avoid dangling imports:

1. **A.1–A.2** — Block registry + utilities (foundation)
2. **A.3–A.6** — Store layer (keyboard, focus, atoms, events)
3. **A.7–A.9** — RPC clients + config handling
4. **A.10** — Visual component (orphaned)
5. **A.11–A.13** — UI components (tab bar, workspace, onboarding)
6. **A.14** — Electron main (IPC cleanup)

## Verification Checklist

After each phase:

- [ ] `task dev` completes without errors
- [ ] `task start` launches the app
- [ ] No console errors related to missing AI components
- [ ] No AI panels appear in the UI
- [ ] No AI entries in settings/config UI
- [ ] No AI keyboard shortcuts active
- [ ] App functions normally for non-AI features (terminals, file browser, SSH connections)

## Phase A Review — 2026-05-14

### Issues Found During Review

#### 🔴 A.15: Builder workspace still imports AIPanel and WaveAIModel (Not in original spec)

The builder subsystem (`frontend/builder/`) has deep AI integration that was not covered by the original Phase A spec. These are live imports that will crash if `aipanel/` is ever deleted (Phase D).

**Files:**
- `frontend/builder/builder-workspace.tsx` — imports `AIPanel` from `@/app/aipanel/aipanel`, renders `<AIPanel roundTopLeft={false} />`
- `frontend/builder/builder-buildpanel.tsx` — imports `WaveAIModel`, calls `WaveAIModel.getInstance()` for "Add to Context" context menu and AI model access
- `frontend/builder/tabs/builder-previewtab.tsx` — imports `WaveAIModel`, calls `WaveAIModel.getInstance()` for chat ID access
- `frontend/builder/tabs/builder-filestab.tsx` — imports `formatFileSize` from `@/app/aipanel/ai-utils` (generic utility trapped in AI module)
- `frontend/builder/store/builder-focusmanager.ts` — has `BuilderFocusType = "waveai" | "app"` and `setWaveAIFocused()` method

**Fix:** Remove AIPanel from builder workspace, replace WaveAIModel calls with stubs or no-ops, move `formatFileSize` to a shared utility, change `BuilderFocusType` to just `"app"`.

#### 🟡 A.9 partial: "AI Presets" deprecated config entry still in settings UI

`frontend/app/view/waveconfig/waveconfig-model.ts` still has:
- `validateAiJson()` function (lines 35-44) that validates keys starting with `ai@`
- "AI Presets" deprecated config file entry (lines 93-103) pointing to `presets/ai.json` with `docsUrl: "https://docs.waveterm.dev/ai-presets"`

This means AI Presets still appears in the settings UI as a deprecated file.

**Fix:** Remove `validateAiJson()` and the "AI Presets" entry from `deprecatedConfigFiles`.

#### 🟡 A.3 partial: `inWaveAI` dead code in layoutModel.ts

`frontend/layout/lib/layoutModel.ts` line 1107 still has `inWaveAI` parameter in `switchNodeFocusInDirection()`, and lines 1127-1131 have WaveAI-specific navigation logic. Caller in `keymodel.ts` passes `false`, so it's harmless but is dead code.

**Fix:** Remove `inWaveAI` parameter and the WaveAI-specific branch from `switchNodeFocusInDirection()`. Update caller in `keymodel.ts`.

#### 🟢 A.14 partial: Mock Electron API still has `setWaveAIOpen`

`frontend/preview/mock/preview-electron-api.ts` line 53 still has `setWaveAIOpen: (_isOpen: boolean) => {}`.

**Fix:** Remove `setWaveAIOpen` from the mock API object.

#### 🟢 Dead `rateLimitInfoAtom` declaration in global-atoms.ts

`frontend/app/store/global-atoms.ts` line 115 declares `rateLimitInfoAtom` but never exports it or adds it to the `atoms` object. Leftover from AI rate limit tracking.

**Fix:** Remove the `rateLimitInfoAtom` declaration.

### Deferred Items (Not Phase A Bugs)

These are expected to be cleaned up in later phases:

| Item | Why Deferred | Phase |
|------|-------------|-------|
| Auto-generated TS types (`gotypes.d.ts`, `waveevent.d.ts`, `wshclientapi.ts`, `custom.d.ts`) still have AI definitions | Regeneration depends on Go backend types being removed first | B → regenerate |
| `wshclientapi.ts` still has 7 AI RPC commands + `AiSendMessageCommand` | Auto-generated file; will be regenerated after Go types removed | B → regenerate |
| `aipanel/`, `aifilediff/`, `fakechat.tsx`, `waveaivisual.tsx` files still exist | Intentionally kept per spec; Phase D deletes them | D |
| `waveai.tsx` stub still exports `WaveAiModel` class | File exists but not registered in blockregistry; dead code | D |
| `schema/waveai.json`, `schema/aipresets.json` still exist | Phase C removes them | C |
| `schema/settings.json` has `waveai:showcloudmodes` and `waveai:defaultmode` | Phase B/C handles schema cleanup | B/C |
| `docs/docs/waveai.mdx`, `waveai-modes.mdx`, `ai-presets.mdx` still exist | Phase C removes them | C |
| `docs/docs/config.mdx` still has `waveai:showcloudmodes`/`waveai:defaultmode` | Phase C audits this | C |
| `pkg/wconfig/defaultconfig/waveai.json`, `presets/ai.json` still exist | Phase B.8 handles this | B |
| All Go backend types and handlers untouched | Phase B scope | B |
| `filebackup.go` uses `waveai-backups` directory name | Low priority; just a directory name, harmless | D |

### Unintended Consequences to Track

1. **Builder mode will break at Phase D** — The builder imports `AIPanel`, `WaveAIModel`, and `formatFileSize` from `aipanel/`. When that directory is deleted in Phase D, the builder crashes unless A.15 fixes are applied first.
2. **`formatFileSize` trapped in AI module** — `builder-filestab.tsx` imports it from `@/app/aipanel/ai-utils`. Must be relocated before Phase D.
3. **Type definitions out of sync** — Auto-generated TS files have AI types that no longer match runtime reality. No runtime errors but creates confusion. Will resolve when Go types removed and generator re-run.

## Phase B Review — 2026-05-15

### Items Already Removed (from telemetry phase)

- `WaveAIEnableTelemetryCommand` — already gone from interface, server, and client
- `WaveAIFgMinutes` / `WaveAIActiveMinutes` telemetry props — already gone from `wshrpctypes.go`
- `GetCustomAIModeConfigs()` — spec mentioned it but it doesn't exist in `settingsconfig.go` (it's `ComputeResolvedAIModeConfigs()` in `aiusechat/`)

### Additional Items Found (Not in Original Spec)

| ID | File | What to remove |
|----|------|---------------|
| **B.1 (extra)** | `pkg/wshrpc/wshrpctypes.go` | `AiSendMessageCommand` interface method + `AiMessageData` type (no server handler exists) |
| **B.3 (extra)** | `pkg/wshrpc/wshclient/wshclient.go` | `AiSendMessageCommand()` helper function |
| **B.6 (extra)** | `pkg/wconfig/settingsconfig.go` | `CountCustomAIModes()` function (dead code) |
| **B.9** | `pkg/wps/wpstypes.go` | `Event_WaveAIRateLimit`, `Event_AIModeConfig` constants + from `AllEvents` list |
| **B.10** | `pkg/wconfig/metaconsts.go` | `ConfigKey_WaveAiShowCloudModes`, `ConfigKey_WaveAiDefaultMode` (auto-generated; will not reappear after B.6) |
| **B.11** | `pkg/tsgen/tsgen.go` | `uctypes.RateLimitInfo{}` and `wconfig.AIModeConfigUpdate{}` from `Types` slice, `aiusechat/uctypes` import |
| **B.12** | `cmd/generateschema/main-generateschema.go` | `WaveSchemaWaveAIFileName` const + waveai schema generation block |
| **B.13** | `cmd/generatego/main-generatego.go` | `"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"` from boilerplate import list |

### Updated Implementation Order

1. **B.1** — `wshrpctypes.go` (interface + types, including `AiSendMessageCommand` + `AiMessageData`)
2. **B.2** — `wshserver.go` (server handlers)
3. **B.3** — `wshclient.go` (client helpers, including `AiSendMessageCommand`)
4. **B.4** — `web.go` (web endpoints)
5. **B.5** — `main-server.go` (init call)
6. **B.6** — `settingsconfig.go` (config types + `CountCustomAIModes`)
7. **B.7** — `tsgenevent.go` (event type mapping)
8. **B.11** — `tsgen.go` (Types slice + import)
9. **B.9** — `wpstypes.go` (event constants + AllEvents list)
10. **B.13** — `generatego/main-generatego.go` (import list)
11. **B.12** — `generateschema/main-generateschema.go` (schema generation)
12. **B.10** — `metaconsts.go` (AI config key constants)
13. **B.8** — `defaultconfig/waveai.json` (delete)

### Left Untouched

- `cmd/testai/`, `cmd/testopenai/`, `cmd/testsummarize/` — test-only binaries; harmless dead code
- `pkg/aiusechat/` — entire package stays intact (Phase D)

### Phase B Completion — 2026-05-15

All Phase B items implemented and verified. `task build:backend` completes without errors.

**Additional item found during implementation:**
- `cmd/wsh/cmd/wshcmd-ai.go` — `wsh ai` CLI command, deleted (used `AIAttachedFile`, `CommandWaveAIAddContextData`, `WaveAIAddContextCommand`)

**Post-Phase B state:**
- `pkg/aiusechat/` is now a dead package (no external callers)
- Auto-generated TS types (`gotypes.d.ts`, `waveevent.d.ts`, `wshclientapi.ts`) still have stale AI definitions — will be regenerated when the generator is re-run
- `schema/waveai.json` still exists on disk (was pre-generated, not regenerated by `task build:schema` since the generator code is removed) — Phase C will delete it

## Phase C Review — 2026-05-16

### Completed

- **C.1**: Deleted `docs/docs/waveai.mdx`, `waveai-modes.mdx`, `ai-presets.mdx`
- **C.1**: Cleaned `docs/docs/config.mdx` — removed 13 AI config rows (`ai:*`, `waveai:*`, `app:hideaibutton`), cleaned default config JSON, updated env var examples
- **C.1**: Cleaned `docs/docs/gettingstarted.mdx` — removed AI mentions from intro, key features, quick start, and next steps
- **C.1**: Cleaned `docs/docs/index.mdx` — removed Wave AI card, removed AI from intro text
- **C.1**: Cleaned `docs/docs/wsh-reference.mdx` — removed `waveai` from view type filter, removed `presets/ai.json` example
- **C.1**: Truncated `docs/docs/releasenotes.mdx` — kept v0.14.x only (v0.13.1 and earlier removed), stripped all AI mentions from v0.14.x entries
- **C.2**: Deleted `schema/waveai.json`, `schema/aipresets.json`
- **Phase A carryover**: Fixed misleading AI text in `frontend/builder/tabs/builder-previewtab.tsx` EmptyStateView

### Audit Results

| File | AI references found | Action |
|------|-------------------|--------|
| `docs/docs/secrets.mdx` | None (already clean) | No change needed |
| `docs/docs/telemetry.mdx` | File doesn't exist (removed in telemetry phase) | N/A |
| `docs/docs/connections.mdx` | None | No change needed |

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| AI code is imported by non-AI files | Phase A handles frontend imports first; Phase B handles Go imports. Each phase is independently buildable. Builder imports discovered in A.15 review — must fix before Phase D. |
| Builder has AI dependencies | A.15 documents builder AI imports; must fix before Phase D deletes `aipanel/`. Move `formatFileSize` to shared utility. |
| Config migration for existing users | `waveai.json` and `aipresets.json` are simply ignored if not loaded. Existing files on disk are harmless. |
| Upstream merge conflicts | Keeping `pkg/aiusechat/` intact (Phase D deferred) minimizes conflicts. Only wiring code is removed. |
| Secret store still needed | `ssh:passwordsecretname` justifies keeping it. Documented in [[decisions.md#2026-05-12-secret-store--keep]]. |
