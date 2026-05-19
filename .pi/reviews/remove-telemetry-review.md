# Review: Remove Telemetry Spec

**Date:** 2026-05-13
**Spec:** `.pi/specs/remove-telemetry.md`
**Status:** Draft spec review — issues found

---

## Executive Summary

The spec is well-structured and covers the majority of telemetry call sites. However, there are **significant omissions** on both backend and frontend, **ambiguous instructions** for `PanicHandler` cleanup, and **missing consideration** of auto-generated code files. If executed as written, the app will fail to compile in Phase C due to unresolved imports in code generators, and the Electron main process (`emain/emain.ts`) will continue sending telemetry events unbeknownst to the remover.

The onboarding flow requires more extensive structural changes than just removing `RecordTEventCommand` calls — the state machine has telemetry baked into page transitions.

**Recommendation:** Update the spec before implementation. The issues are correctable with targeted additions.

---

## Critical Omissions (Will Cause Compile Errors or Missed Telemetry)

### 1. `emain/emain.ts` — Entirely Absent from Spec

The Electron main process sends telemetry independently of the frontend React app. This file is **not mentioned anywhere** in the spec.

**What it does:**
- `sendDisplaysTDataEvent()` — sends display metrics (count, resolution, DPR) via `RpcApi.RecordTEventCommand` (event: `app:display`)
- `logActiveState()` — every 60 seconds sends:
  - `RpcApi.ActivityCommand(ElectronWshClient, activity, ...)` with fg/active minutes, terminal command counts, Wave AI active minutes
  - `RpcApi.RecordTEventCommand(ElectronWshClient, { event: "app:activity", props }, ...)` with aggregated activity props
- `runActiveTimer()` — triggers `logActiveState()` on a 60-second loop, started at app launch (line 419)
- `sendDisplaysTDataEvent()` — called once at startup (line 420)

**Where to add:** Phase B (frontend), or a new Phase E (electron main)

### 2. `cmd/server/main-server.go` — Missing `diagnosticLoop` and Constants

The spec's A.1 lists many removals but **completely omits** the diagnostic ping loop:

| Missing Item | Lines | Purpose |
|--------------|-------|---------|
| `const InitialDiagnosticWait` | 65 | Wait before first diagnostic ping |
| `const DiagnosticTick` | 66 | Sleep interval between ping attempts |
| `func diagnosticLoop()` | 136-154 | Daily ping loop to `ping.waveterm.dev` |
| `func sendDiagnosticPing()` | 157-169 | Sends diagnostic ping via `wcloud.SendDiagnosticPing` |
| `go diagnosticLoop()` | 570 | Starts the diagnostic loop goroutine |

The spec mentions removing `wcloud.SendDiagnosticPing()` call from startup and `WAVETERM_NOPING` env var, but the **loop that repeatedly calls `sendDiagnosticPing()` is never mentioned**. This is the most active telemetry channel (daily pings) and would survive Phase A if the spec is followed literally.

**Note:** `WAVETERM_NOPING` is checked inside `diagnosticLoop()` (line 140), not just at startup.

### 3. `cmd/wsh/cmd/wshcmd-root.go` — Missing CLI Activity Tracking

The `wsh` CLI tool sends command usage stats to the local server via `WshActivityCommand`:

```go
func sendActivity(wshCmdName string, success bool) {
    ...
    wshclient.WshActivityCommand(RpcClient, dataMap, nil)
}
```

This is called from the CLI root command after each `wsh` invocation. Even though the comment says "it does not contact any wave cloud infrastructure," the data is fed into the local telemetry system (`ActivityCommand` → `UpdateActivity` → `db_tevent`).

**Where to add:** Phase A.15 or new A.16

### 4. `cmd/generatego/main-generatego.go` — Missing Code Generator Update

The Go code generator that produces `pkg/wshrpc/wshclient/wshclient.go` explicitly imports `pkg/telemetry/telemetrydata` in its boilerplate (line 29). After Phase C deletes `pkg/telemetry/`, this generator will **fail to compile**, blocking future code regeneration.

```go
gogen.GenerateBoilerplate(&buf, "wshclient", []string{
    ...
    "github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata",
    ...
})
```

Since `TEvent` is removed from the RPC interface in Phase A.2/A.3, the generated `wshclient.go` won't reference `telemetrydata` anymore, but the **static import in the generator template** will still cause a compile error.

**Where to add:** Phase C.3 (cleanup) or Phase C.1

### 5. `frontend/app/store/keymodel.ts` — Missing Call Site

The spec's B.4 table lists many frontend call sites but **misses** `frontend/app/store/keymodel.ts:653`:

```typescript
recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" });
```

This is triggered by a keyboard shortcut for the connection dropdown.

### 6. Auto-Generated Files — Spec Treats Them as Manual Edits

The spec instructs manual removal from:
- `frontend/app/store/wshclientapi.ts` (B.2)
- `frontend/app/store/services.ts` (B.3)

Both files are **auto-generated** by `cmd/generatets/main-generatets.go`. If the Go RPC interface and service definitions are cleaned up first, regenerating these files will automatically remove the telemetry methods. Manual edits work but will be overwritten on next regeneration.

**Recommendation:** Note that these files should be regenerated, not manually edited, or edit them AND update the generators to prevent drift.

Similarly, `frontend/types/gotypes.d.ts` is auto-generated and will lose `ActivityUpdate`, `TEvent`, `TEventProps`, `TEventUserProps` types automatically once the Go source types are removed.

---

## Side Effects & Risks

### 1. `PanicHandler` Cleanup — Name Collision Risk

The spec says (A.12): "Rename `PanicHandlerNoTelemetry` to `PanicHandler` (since all telemetry is gone, the 'NoTelemetry' variant is now the only one)".

**Problem:** `PanicHandler` already exists in the same file. You cannot rename `PanicHandlerNoTelemetry` to `PanicHandler` while `PanicHandler` still exists. Go will reject the duplicate function name.

**Correct approach:**
1. Modify the existing `PanicHandler` function to remove the `if PanicTelemetryHandler != nil` block and the `go func() { ... }()` telemetry call
2. Delete `PanicHandlerNoTelemetry`
3. Update the two callers of `PanicHandlerNoTelemetry` (both in `pkg/telemetry/telemetry.go`) to use `PanicHandler` — but since `pkg/telemetry/` is deleted in Phase C, this step may be moot
4. Remove `var PanicTelemetryHandler func(panicType string)`

**Result:** The existing `PanicHandler` becomes the no-telemetry version automatically; all its existing callers (40+ locations across the codebase) continue to work without modification.

### 2. Onboarding Flow — Structural Changes Required

The onboarding state machine in `frontend/app/onboarding/onboarding.tsx` has telemetry embedded in its page transitions:

```typescript
type PageName = "init" | "notelemetrystar" | "features";
```

The `InitPage` component receives a `telemetryUpdateFn` prop and a telemetry toggle UI. The state transition is:
```
init -> (telemetry enabled) -> features
init -> (telemetry disabled) -> notelemetrystar -> features
```

**What's needed beyond removing `RecordTEventCommand` calls:**
- Remove `telemetryUpdateFn` prop from `InitPage`
- Remove the telemetry toggle/checkbox from `InitPage` UI
- Remove `"notelemetrystar"` from `PageName` type
- Remove the `notelemetrystar` branch from the switch/case page renderer
- Simplify the transition to: `init -> features` unconditionally
- Remove `telemetryEnabled` state and `telemetrySetting` atom usage
- Remove `NoTelemetryStarPage` export if it's no longer used

The spec mentions "The InitPage in onboarding has a telemetry toggle; remove that UI element" which is correct directionally, but the actual code changes are more extensive than just removing a toggle.

### 3. AI Cloud Mode Gate

In `pkg/aiusechat/usechat.go:86`:
```go
if config.WaveAICloud && !telemetry.IsTelemetryEnabled() {
    return nil, fmt.Errorf("Wave AI cloud modes require telemetry to be enabled")
}
```

The spec says (A.11): "remove the gate or hardcode it to pass". If telemetry is removed first (before AI removal), this gate **must** be removed or hardcoded to allow cloud AI, or Wave AI cloud modes will break with a compile error (the `telemetry` package won't exist).

**Side effect:** Removing this gate means Wave AI cloud modes will work without telemetry, which is the desired end state for the fork, but it's a behavioral change that should be noted.

### 4. `wsh` CLI Activity Tracking Behavior Change

The `sendActivity` function in `cmd/wsh/cmd/wshcmd-root.go` currently helps the developers "understand which commands are actually being used." Removing it means zero visibility into `wsh` command usage, but that's aligned with the goal.

### 5. Database Tables — Orphaned Data

`db_tevent` and `db_activity` tables exist in user's SQLite databases. The spec correctly deletes the code that writes to them, but **existing data remains on disk**. This is harmless (no new data accumulates, no data is sent), but if completeness is desired, a one-time cleanup or migration to drop these tables could be added. Not strictly necessary.

### 6. `TosAgreed` Field

The spec correctly notes that `TosAgreed` is harmless without telemetry reading it. However, `TosAgreed` is also referenced in `cmd/server/main-server.go` (line 326) as part of `startupActivityUpdate`, which is being removed anyway. No side effects.

### 7. `ClientId` Non-Telemetry Uses

Verified: `wstore.GetClientId()` is used by:
- `pkg/remote/sshclient.go` (durable sessions)
- `pkg/jobcontroller/jobcontroller.go` (job manager)
- `pkg/wcloud/wcloud.go` (telemetry — being removed)
- `cmd/server/main-server.go` (diagnostic ping — being removed)

The spec correctly advises keeping `ClientId`. Good.

---

## Documentation Audit Findings

### Covered Correctly
- `docs/docs/telemetry.mdx` — listed for deletion ✓
- `docs/docs/telemetry-old.mdx` — listed for deletion ✓
- `docs/docs/config.mdx` — listed for audit ✓
- `docs/docs/faq.mdx` — listed for audit ✓
- `docs/docs/index.mdx` — listed for audit ✓

### Additional Doc References Found
- `docs/docs/releasenotes.mdx` — has telemetry mentions (lines 178, 379, 505, 690)
- `docs/docs/waveai.mdx` — line 93 mentions "anonymous telemetry"
- `docs/docs/waveai-modes.mdx` — line 80 mentions "telemetry requirement messages"

These are noted in the spec as "handled by AI removal spec" or "optional, historical." This is reasonable.

---

## Recommendations for Spec Updates

### Immediate Additions (Before Implementation)

| # | Addition | Phase |
|---|----------|-------|
| 1 | Add `emain/emain.ts`: remove `sendDisplaysTDataEvent()`, `logActiveState()`, `runActiveTimer()`, and their startup calls | Phase B or new Phase E |
| 2 | Add `cmd/server/main-server.go`: remove `diagnosticLoop()`, `sendDiagnosticPing()`, `go diagnosticLoop()`, `InitialDiagnosticWait`, `DiagnosticTick` | Phase A.1 |
| 3 | Add `cmd/wsh/cmd/wshcmd-root.go`: remove `sendActivity()` function and its call site | Phase A.16 |
| 4 | Add `cmd/generatego/main-generatego.go`: remove `telemetrydata` from generator boilerplate imports | Phase C.3 |
| 5 | Add `frontend/app/store/keymodel.ts` to Phase B.4 call sites table | Phase B.4 |
| 6 | Clarify `PanicHandler` cleanup: modify existing `PanicHandler` to remove telemetry block, delete `PanicHandlerNoTelemetry`, update its callers | Phase A.12 |
| 7 | Expand onboarding instructions: remove `telemetryUpdateFn` prop, `PageName` variants, simplify state machine transitions | Phase B.5 |
| 8 | Note auto-generated files (`wshclientapi.ts`, `services.ts`, `gotypes.d.ts`) should be regenerated after Go changes, not just manually edited | Phase B intro |

### Optional but Recommended

| # | Addition | Rationale |
|---|----------|-----------|
| 9 | Add DB cleanup note: `db_tevent` and `db_activity` tables will remain in existing user databases but won't receive new data | Verification checklist or risk assessment |
| 10 | Consider removing `autoupdate:channel` and `autoupdate:enabled` from `CountCustomSettings` exclusion since auto-update is being discussed for removal | If auto-update is removed in a follow-up spec, this becomes relevant |

---

## Risk Matrix (Post-Spec-Correction)

| Risk | Severity | Mitigation |
|------|----------|------------|
| ClientId used by non-telemetry code | Low | Keep `wstore.GetClientId()` — spec already covers ✓ |
| `TosAgreed` field harmless without readers | Low | Keep field, no migration needed — spec already covers ✓ |
| Onboarding structural changes | Medium | Expand Phase B.5 instructions per review |
| Upstream merge conflicts | Medium | Phase A keeps `pkg/telemetry/` intact; Phase C deferred — spec already covers ✓ |
| Compile errors from code generators | High | Add `cmd/generatego/` cleanup to spec |
| Electron main telemetry survives | High | Add `emain/emain.ts` to spec |
| Daily diagnostic pings survive | High | Add `diagnosticLoop` removal to spec |
| `PanicHandler` name collision | Medium | Clarify A.12 instructions |
| AI cloud modes break if gate removed before AI spec | Low | Hardcode gate to pass or remove — spec covers, just note execution order |

---

## Verification Checklist Amendments

After the spec is updated and implemented:

- [ ] `emain/emain.ts` has no `RecordTEventCommand` or `ActivityCommand` calls
- [ ] `cmd/server/main-server.go` has no `diagnosticLoop`, `sendDiagnosticPing`, or `go diagnosticLoop()`
- [ ] `cmd/wsh/cmd/wshcmd-root.go` has no `sendActivity` function
- [ ] `cmd/generatego/main-generatego.go` does not import `telemetrydata`
- [ ] `frontend/app/store/keymodel.ts` has no `recordTEvent` calls
- [ ] Onboarding flow transitions directly from `init` to `features` without telemetry consent
- [ ] `pkg/panichandler/panichandler.go` has only one `PanicHandler` function (no telemetry side-effects)
- [ ] No references to `telemetry:enabled` in `docs/docs/` remain
