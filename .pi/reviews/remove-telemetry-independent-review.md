# Independent Review: Remove Telemetry Spec

**Date:** 2026-05-13
**Spec reviewed:** `.pi/specs/remove-telemetry.md`
**Method:** Full codebase audit against spec claims; did not read the prior review at `.pi/reviews/remove-telemetry-review.md`

---

## Summary

The spec is well-structured with a sound phased approach (A→B→C→D) and a thorough file-by-file inventory for most Go backend files. However, it has **4 critical gaps** (entire subsystems unaddressed), **5 errors/omissions** in listed items, and **6 unintended side effects** that need mitigation. The most significant gap is the complete absence of the Electron main process (`emain/`) which contains the primary activity-tracking loop.

---

## 🔴 Critical Gaps — Items the Spec Misses Entirely

### 1. `emain/emain.ts` — Electron main process telemetry

The spec has **no section** for the Electron main process. `emain/emain.ts` contains the most important telemetry call sites:

- **`sendDisplaysTDataEvent()`** (lines 135–162): Sends display info via `RpcApi.RecordTEventCommand` with event `"app:display"`.
- **`logActiveState()`** (lines 168–230+): Core activity tracking loop. Calls `RpcApi.ActivityCommand` and `RpcApi.RecordTEventCommand` with `"app:activity"` events including foreground minutes, active minutes, terminal command counts, AI usage minutes, and display data.
- **`emain-activity.ts`**: Module that collects `wasActive`, `wasInFg`, `termCommandsRun`, `termCommandsRemote`, `termCommandsWsl`, `termCommandsDurable`. All increment/export functions exist solely to feed telemetry.
- **`emain-ipc.ts`**: IPC handler for `"increment-term-commands"` (lines 441–454) which routes to `emain-activity.ts`.
- **`preload.ts`**: Exposes `incrementTermCommands` API to the renderer process.

Without addressing these, telemetry removal is incomplete. The Electron main process is where periodic activity pings are orchestrated.

**Recommendation:** Add new sections (B.7 for emain call sites, B.8 for emain-activity tracking module) covering:
- Remove `sendDisplaysTDataEvent()` and `logActiveState()` from `emain.ts`
- Remove all `RpcApi.RecordTEventCommand` and `RpcApi.ActivityCommand` calls from `emain.ts`
- Remove the `TEventProps`/`ActivityUpdate` type imports
- Remove `incrementTermCommands*` functions from `emain-activity.ts` (or make them no-ops)
- Remove the `"increment-term-commands"` IPC handler from `emain-ipc.ts`
- Remove `incrementTermCommands` from `preload.ts`
- Remove `getActivityState`, `setWasActive`, `setWasInFg` if only used by telemetry (verify no other callers)

### 2. `cmd/wsh/cmd/wshcmd-root.go` — `sendActivity()` and `activityWrap()`

The spec does not mention the `wsh` CLI's activity tracking:

- **`activityWrap()`** (line 106): A wrapper that calls `sendActivity` after every wsh command execution.
- **`sendActivity()`** (line 221): Calls `wshclient.WshActivityCommand` to report which CLI command was run and whether it succeeded.
- **`wshcmd-file.go`**: Every file subcommand (`file list`, `file cat`, `file info`, `file rm`, `file write`, `file append`, `file cp`, `file mv`) uses `activityWrap`.

The spec mentions removing `WshActivityCommand` from the server/RPC layers (A.2/A.3/A.4) but never addresses the **callers**.

**Recommendation:** Add new section A.16:
- Remove `sendActivity()` function from `wshcmd-root.go`
- Remove `activityWrap()` function from `wshcmd-root.go`
- Remove `activityWrap` wrapping from all command `RunE` assignments in `wshcmd-file.go` (change `activityWrap("file", fileListRun)` to just `fileListRun`, etc.)
- Remove the `sendActivity` comment block (lines 216–218)
- Remove `wshclient` import if no other uses remain in `wshcmd-root.go`

### 3. `cmd/generatego/main-generatego.go` — Code generator imports `telemetrydata`

The Go code generator that produces `pkg/wshrpc/wshclient/wshclient.go` has a hardcoded import of `"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"` (line 29). When Phase C deletes `pkg/telemetry/telemetrydata/`, this generator will fail to compile. The spec does not mention updating it.

**Recommendation:** Add to Phase C.3 (or new C.4):
- Remove `"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"` from `cmd/generatego/main-generatego.go` imports
- After removing telemetry RPC types from `wshrpctypes.go`, regenerate `wshclient.go` to remove the generated telemetry methods

### 4. Auto-generated TypeScript files — manual edits will be overwritten

`frontend/types/gotypes.d.ts`, `frontend/app/store/services.ts`, and `frontend/app/store/wshclientapi.ts` are **auto-generated** by `cmd/generatets/main-generatets.go`. They contain telemetry-related types and methods (`ActivityUpdate`, `TEvent`, `TEventProps`, `TEventUserProps`, `TelemetryUpdate`, etc.). The spec lists manual edits to these files (B.2, B.3), but since they're auto-generated, **manual edits will be overwritten** on the next build.

**Recommendation:** Revise B.2/B.3 to note:
- These files are auto-generated; do NOT edit them directly
- Instead, remove the telemetry RPC methods/types from the Go source types that feed the generator:
  - Remove `ActivityCommand`, `RecordTEventCommand`, `SendTelemetryCommand`, `WaveAIEnableTelemetryCommand`, `WshActivityCommand` from `pkg/wshrpc/wshrpctypes.go`
  - Remove `TelemetryUpdate` from `pkg/service/clientservice/clientservice.go`
  - Remove `ActivityUpdate` type from `pkg/wshrpc/wshrpctypes.go`
  - Remove `TEvent`/`TEventProps`/`TEventUserProps` types from `pkg/telemetry/telemetrydata/telemetrydata.go` (or delete the package in Phase C)
- After Go source changes, regenerate with `task dev` (or the appropriate generate task)
- **Also** remove the manual call sites in frontend code that reference these generated types/methods (B.4 table entries)

---

## 🟡 Errors and Omissions

### 5. `WshActivityCommand` missing from A.2, A.3, A.4

The spec lists these methods to remove from wshserver/wshrpctypes/wshclient:
- `ActivityCommand()`, `RecordTEventCommand()`, `SendTelemetryCommand()`, `WaveAIEnableTelemetryCommand()`

But it **omits `WshActivityCommand()`**, which is a distinct RPC method (separate from `ActivityCommand`). `WshActivityCommand` takes `map[string]int` and is used by the `wsh` CLI's `sendActivity()` function. It exists in all three layers:
- `wshserver.go` line 1316
- `wshrpctypes.go` line 86
- `wshclient.go` line 1051

**Fix:** Add `WshActivityCommand()` to A.2, A.3, and A.4.

### 6. Phase A.1 missing `diagnosticLoop()` and related constants

The spec lists functions to remove from `main-server.go` but omits:
- **`diagnosticLoop()`** (line 136) — the periodic diagnostic ping loop
- **`InitialDiagnosticWait`** constant (line 65)
- **`DiagnosticTick`** constant (line 66)
- **`go diagnosticLoop()`** startup call (line 570)

The spec mentions `wcloud.SendDiagnosticPing()` and `WAVETERM_NOPING` but not the loop that orchestrates them.

**Fix:** Add to A.1:
- Remove `diagnosticLoop()` function
- Remove `InitialDiagnosticWait` and `DiagnosticTick` constants
- Remove `go diagnosticLoop()` from startup sequence

### 7. `frontend/app/store/keymodel.ts` — Missing call site

The spec's table in B.4 does not include `keymodel.ts`, but it contains:
- Import of `recordTEvent` (line 18)
- `recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" })` (line 653)

**Fix:** Add to B.4 table:
| `frontend/app/store/keymodel.ts` | `recordTEvent` import and call (line 653) |

### 8. `frontend/app/aipanel/telemetryrequired.tsx` — Dedicated telemetry consent component

This is an entire React component (`TelemetryRequiredMessage`) that blocks AI panel usage until the user enables telemetry. It calls `RpcApi.WaveAIEnableTelemetryCommand`. The spec's B.6 delegates AI panel files to the AI removal spec, but this component is **about telemetry**, not AI — it's the telemetry consent gate for AI features. It must be addressed here or with an explicit cross-reference guaranteeing the AI spec handles it.

**Fix:** Either:
- Add explicit entry in B.6 noting that `telemetryrequired.tsx` must be removed or replaced with a non-telemetry gate when AI panel is modified, OR
- Add it to Phase B with a note that it's co-owned with the AI removal spec

### 9. Preview/test files not addressed

- `frontend/preview/mock/mockfilesystem.ts` line 317: References `telemetry.log` in mock filesystem data.
- `frontend/preview/previews/onboarding.preview.tsx` line 27: Passes `telemetryUpdateFn={async () => {}}` to `InitPage`.

**Fix:** Add to B.4 or B.5:
| `frontend/preview/mock/mockfilesystem.ts` | Remove `telemetry.log` mock entry |
| `frontend/preview/previews/onboarding.preview.tsx` | Remove `telemetryUpdateFn` prop (after onboarding restructuring) |

---

## 🟠 Unintended Side Effects

### 10. Onboarding flow will break without restructuring

The current onboarding has a 3-page flow:
```
init → (telemetry enabled → features) | (telemetry disabled → notelemetrystar → features)
```

The `InitPage` component has:
- A telemetry toggle checkbox
- A `telemetryUpdateFn` prop that calls `TelemetryUpdate`
- Logic in `acceptTos` that opens the AI panel only when `telemetryEnabled`
- A `NoTelemetryStarPage` ("Telemetry Disabled ✓") dedicated page

Simply removing telemetry calls without restructuring this UI will leave:
- A non-functional checkbox
- A dead `telemetryUpdateFn` callback
- An `acceptTos` handler that conditionally opens AI panel based on a setting that no longer exists
- A meaningless `NoTelemetryStarPage`

**Recommendation:** Expand B.5 with a restructuring plan:
- Remove the telemetry toggle from `InitPage`
- Remove the `telemetryUpdateFn` prop
- Remove `NoTelemetryStarPage` and the `"notelemetrystar"` page state
- Simplify the flow to `init → features`
- Move the GitHub star prompt to `InitPage` or `FeaturesPage` without the telemetry-disabled framing
- Remove `telemetry:enabled` state reads (`useSettingsKeyAtom("telemetry:enabled")`)
- In `acceptTos`, remove the `if (telemetryEnabled)` AI panel check (or hardcode it if AI spec removes the panel)

### 11. `AgreeTos`/TOS flow dependency in onboarding

`AgreeTos()` in `clientservice.go` sets `TosAgreed` timestamp. The onboarding `acceptTos` function calls `AgreeTos` then checks `telemetryEnabled`. The spec says to keep `TosAgreed` "for now" but doesn't address how the TOS acceptance flow works without the telemetry consent step.

**Recommendation:** `AgreeTos` should remain (it's a TOS acceptance, not telemetry), but the onboarding `acceptTos` handler needs restructuring to decouple TOS from telemetry consent.

### 12. PanicHandler rename direction is confusing

The spec says "Rename `PanicHandlerNoTelemetry` to `PanicHandler`" and "Update all callers of `PanicHandlerNoTelemetry`". But:
- `PanicHandlerNoTelemetry` is only called **within `pkg/telemetry/`** (2 calls in `telemetry.go`). After Phase C deletes that package, there are zero callers.
- `PanicHandler` (the one that calls `PanicTelemetryHandler`) is called by ~80+ sites across the codebase.

The practical approach is: keep the name `PanicHandler`, remove the `PanicTelemetryHandler` dispatch code, and make it behave like `PanicHandlerNoTelemetry`. Delete `PanicHandlerNoTelemetry` entirely since it becomes redundant. No callers outside the telemetry package need updating.

**Recommendation:** Revise A.12 to:
- Remove `PanicTelemetryHandler` variable and its `if` block from `PanicHandler`
- Remove `PanicHandlerNoTelemetry` function entirely
- Remove `panichandler.PanicTelemetryHandler = panicTelemetryHandler` from `main-server.go`
- No caller renames needed

### 13. `autoupdate:channel` and `autoupdate:enabled` entangled with telemetry config

`CountCustomSettings()` in `settingsconfig.go` excludes both `telemetry:enabled` AND `autoupdate:channel` from counting as "custom settings" (lines 990–993). After removing `telemetry:enabled`:
- The exclusion logic needs updating (remove the `telemetry:enabled` check)
- The `autoupdate:channel` exclusion should remain (it's not telemetry-related)

Also, `telemetry.AutoUpdateChannel()` and `telemetry.IsAutoUpdateEnabled()` are convenience functions in `pkg/telemetry/` that just read settings config. They're called in `main-server.go` only for telemetry event payloads (lines 316–317). But `autoupdate` settings are used by `emain/updater.ts` for genuine auto-update. These functions should either:
- Be moved to `wconfig` or a utility package before Phase C, OR
- Have their callers in `main-server.go` removed (since they're only used for telemetry payloads)

**Recommendation:** Add to A.1: Remove `telemetry.AutoUpdateChannel()` and `telemetry.IsAutoUpdateEnabled()` calls from `main-server.go` (they're only used in `startupActivityUpdate`). Add to A.14: Update `CountCustomSettings` to remove the `telemetry:enabled` exclusion.

### 14. `waveai-model.tsx`/`aimode.tsx`/`aipanel.tsx` — `telemetry:enabled` reads

These files read `telemetry:enabled` to gate AI features:
- `waveai-model.tsx` lines 144, 149: Returns `"invalid"` mode when telemetry disabled
- `waveai-model.tsx` lines 422–423: Blocks cloud AI when telemetry disabled
- `aimode.tsx` line 147: Reads `telemetry:enabled`
- `aipanel.tsx` lines 238, 265: Reads `telemetry:enabled`

If the AI removal spec removes the AI panel entirely, these references vanish. If it doesn't, they become dangling references to a deleted setting.

**Recommendation:** Add cross-reference note: If AI panel is NOT fully removed by the AI spec, these `telemetry:enabled` reads must be replaced with either hardcoded `true` (always allow) or removed entirely.

### 15. Database schema — `db_tevent` and `db_activity` tables

These tables are created by SQL migrations (`000003_activity.up.sql` and `000007_events.up.sql`). Phase C deletes the Go code that reads/writes them, but the tables remain in users' databases. This is harmless (empty tables), but for a clean removal:

**Recommendation (optional):** Add a new migration that drops these tables:
```sql
-- 000012_drop_telemetry.up.sql
DROP TABLE IF EXISTS db_tevent;
DROP TABLE IF EXISTS db_activity;
```

### 16. Existing users' `telemetry:enabled` setting

After removing `TelemetryEnabled` from `SettingsConfig`, existing users who have `telemetry:enabled` in their config will have an unrecognized key. The JSON unmarshaling with `omitempty` means it will be silently ignored, which is fine. But the `CountCustomSettings` function explicitly checks for this key — that check needs removal (covered in item 13).

### 17. `WCLOUD_ENDPOINT`/`WCLOUD_PING_ENDPOINT` environment variables

`wcloud.CacheAndRemoveEnvVars()` reads and then unsets these environment variables early in startup (main-server.go line 408). This is a security measure to prevent child processes from accessing cloud endpoint URLs. After removing wcloud, these env vars will remain set in the waveterm process. Harmless for a fork that doesn't use cloud services, but worth noting.

---

## 🟢 What the Spec Gets Right

- The phased approach (A→B→C→D) is sound: removing call sites first, then frontend, then packages, then docs.
- The file-by-file inventory in Phase A is thorough for the Go backend files it lists.
- The risk assessment correctly identifies `ClientId` dual-use and `TosAgreed` concerns.
- The interaction note with the AI removal spec is valuable.
- Phase C (delete packages) after call sites are clean is the right order.
- The verification checklist is practical and well-scoped.
- Correctly identifies that `pkg/telemetry/` and `pkg/wcloud/` should be kept during Phase A to minimize upstream merge conflicts.

---

## Recommended Additions Summary

| # | Item | Severity | Action |
|---|------|----------|--------|
| 1 | `emain/emain.ts` + `emain-activity.ts` + `emain-ipc.ts` + `preload.ts` | 🔴 Critical | New sections B.7/B.8 |
| 2 | `wshcmd-root.go` `sendActivity`/`activityWrap` + `wshcmd-file.go` callers | 🔴 Critical | New section A.16 |
| 3 | `cmd/generatego/main-generatego.go` telemetrydata import | 🔴 Gap | Add to Phase C |
| 4 | Auto-generated TS files — edit Go sources, not TS output | 🔴 Gap | Revise B.2/B.3 |
| 5 | `WshActivityCommand` missing from A.2/A.3/A.4 | 🟡 Error | Fix A.2/A.3/A.4 |
| 6 | `diagnosticLoop()` + constants missing from A.1 | 🟡 Error | Fix A.1 |
| 7 | `keymodel.ts` recordTEvent call site | 🟡 Gap | Add to B.4 table |
| 8 | `telemetryrequired.tsx` — telemetry consent gate | 🟡 Gap | Add to B.6 or cross-reference |
| 9 | Preview files (mockfilesystem.ts, onboarding.preview.tsx) | 🟡 Minor | Add to B.4/B.5 |
| 10 | Onboarding UI restructuring plan | 🟠 Side effect | Expand B.5 |
| 11 | `AgreeTos`/TOS flow decoupling | 🟠 Side effect | Add to B.5 |
| 12 | PanicHandler rename direction | 🟠 Side effect | Revise A.12 |
| 13 | `CountCustomSettings` + `AutoUpdateChannel`/`IsAutoUpdateEnabled` | 🟠 Side effect | Add to A.1 and A.14 |
| 14 | AI panel `telemetry:enabled` reads | 🟠 Side effect | Cross-reference with AI spec |
| 15 | Database migration to drop telemetry tables | 🟢 Optional | New Phase D.3 |
| 16 | Existing users' `telemetry:enabled` config key | 🟢 Low risk | Note in A.14 |
| 17 | `WCLOUD_ENDPOINT`/`WCLOUD_PING_ENDPOINT` env vars | 🟢 Low risk | Note in Phase C |