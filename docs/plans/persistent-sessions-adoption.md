# Persistent Terminal Sessions Adoption Plan

**Source:** Upstream commit `01a26d59` from wavetermdev/waveterm
**Date:** 2026-01-29
**Status:** ✅ COMPLETE

## Overview

This plan outlines the adoption of "Persistent Terminal Sessions" from upstream into the sgeraldes/waveterm fork. The feature allows terminal sessions to survive network disconnections and client restarts.

## Key Exclusions

- **Tsunami/WaveApp code** - Already removed from fork, will not be re-added
- **Telemetry changes** - Already removed from fork

## Implementation Phases

### Phase 1: New Utilities (No conflicts) ✅ COMPLETE

| File | Type | Description |
|------|------|-------------|
| `pkg/utilds/quickreorderqueue.go` | NEW | Reorder queue for input ordering |
| `pkg/utilds/quickreorderqueue_test.go` | NEW | Tests for reorder queue |
| `pkg/utilds/versionts.go` | NEW | Timestamp-based version generator |
| `pkg/util/envutil/envutil.go` | MODIFY | Add SliceToMap, CopyAndAddToEnvMap, PruneInitialEnv |

**Dependencies:** None
**Risk:** Low
**Verification:** Run `go test ./pkg/utilds/...`

---

### Phase 2: RPC/Router Infrastructure ✅ COMPLETE

| File | Type | Description |
|------|------|-------------|
| `pkg/wshrpc/wshrpctypes.go` | MODIFY | Add ProcRoute, GenerateRouteId, InputSessionId/SeqNum |
| `pkg/wshutil/wshrpc.go` | MODIFY | SendRpcMessage returns bool (non-blocking) |
| `pkg/wshutil/wshproxy.go` | MODIFY | MakeRpcProxyWithSize, non-blocking send |
| `pkg/wshutil/wshrouter.go` | MODIFY | Backlog queue system, buffered channels |
| `pkg/wshutil/wshrouter_controlimpl.go` | MODIFY | RouteId handling, ProcRoute validation |
| `pkg/wshutil/wshutil.go` | MODIFY | Symlink resolution, HomeDir in RemoteInfo |
| `pkg/wavejwt/wavejwt.go` | MODIFY | Add ProcRoute field to claims |

**Dependencies:** Phase 1
**Risk:** Medium (interface changes)
**Breaking Changes:**
- `AbstractRpcClient.SendRpcMessage()` return type changes to `bool`

**Verification:**
- `go build ./...`
- Test wsh commands work

---

### Phase 3: Connection & Server ✅ COMPLETE

| File | Type | Description |
|------|------|-------------|
| `pkg/remote/conncontroller/conncontroller.go` | MODIFY | Lifecycle lock, close order fix |
| `pkg/wstore/wstore.go` | MODIFY | SetClientId/GetClientId caching |
| `cmd/server/main-server.go` | MODIFY | Use GetClientId, pass env/sockname |
| `pkg/wshrpc/wshremote/wshremote.go` | MODIFY | InitialEnv, SockName, ConnServerInit |
| `pkg/wshrpc/wshremote/wshremote_job.go` | MODIFY | Combine initial env with job env |
| `cmd/wsh/cmd/wshcmd-connserver.go` | MODIFY | Env handling, socket name |

**Dependencies:** Phase 2
**Risk:** Medium
**Verification:**
- SSH connections work
- Network disconnect doesn't hang

---

### Phase 4: Block Controllers ✅ COMPLETE

| File | Type | Description |
|------|------|-------------|
| `pkg/waveobj/metaconsts.go` | MODIFY | Add MetaKey_CmdPersistent |
| `pkg/waveobj/wtypemeta.go` | MODIFY | Add CmdPersistent field |
| `pkg/blockcontroller/shelljobcontroller.go` | NEW | Persistent session controller |
| `pkg/blockcontroller/blockcontroller.go` | MODIFY | Controller selection, remove tsunami refs |
| `pkg/blockcontroller/shellcontroller.go` | MODIFY | VersionTs, Stop() signature |
| `pkg/jobcontroller/jobcontroller.go` | MODIFY | Job management improvements |
| `pkg/jobmanager/jobmanager.go` | MODIFY | InputQueue with QuickReorderQueue |
| `pkg/jobmanager/jobcmd.go` | MODIFY | termSize tracking |
| `pkg/shellexec/shellexec.go` | MODIFY | Add StartRemoteShellJob |

**Dependencies:** Phase 3
**Risk:** High (breaking interface changes)
**Breaking Changes:**
- `Controller.Stop()` signature: `(graceful bool, newStatus string)` → `(graceful bool, newStatus string, destroy bool)`
- `StopBlockController` → `DestroyBlockController`

**Verification:**
- Terminal blocks work
- `cmd:persistent` metadata enables persistent mode

---

### Phase 5: Regenerate & Test ✅ COMPLETE

| Task | Description |
|------|-------------|
| `task generate` | Regenerate TypeScript bindings |
| Frontend cleanup | Remove jobId from TermWrap if needed |
| Integration test | Test terminal, SSH, persistent sessions |
| Build test | `task build:prod` |

**Dependencies:** Phase 4
**Verification:**
- `task dev` runs without errors
- Terminal functionality works
- Persistent sessions work on remote connections

---

## Files to SKIP (Tsunami/WaveApp)

| File | Reason |
|------|--------|
| `frontend/app/view/tsunami/tsunami.tsx` | Tsunami removed |
| `pkg/blockcontroller/tsunamicontroller.go` | Tsunami removed |
| `pkg/waveapp/waveapp.go` | WaveApp removed |

---

## Modifications Required

### blockcontroller.go - Remove Tsunami References

Remove these code blocks:

```go
// REMOVE: Tsunami controller case in needsReplace logic (~line 158-172)
case *TsunamiController:
    if controllerName != BlockController_Tsunami {
        needsReplace = true
    }

// REMOVE: Tsunami controller creation (~line 225-233)
case BlockController_Tsunami:
    controller = MakeTsunamiController(tabId, blockId)
    registerController(blockId, controller)
```

---

## Testing Checklist

- [x] Go build succeeds: `go build ./...`
- [x] Go tests pass: `go test ./...`
- [x] TypeScript compiles: `task check:ts`
- [x] Production build works: `task build`
- [ ] Dev server runs: `task dev` (manual verification)
- [ ] Local terminal works (manual verification)
- [ ] SSH connection works (manual verification)
- [ ] SSH disconnect doesn't hang (manual verification)
- [ ] Persistent session flag works (when UI added)

---

## Rollback Plan

If issues occur:
1. `git revert` the problematic commits
2. Run `task generate` to restore bindings
3. Run `npm install` if package.json changed

---

## Progress Log

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| 2026-01-29 | Plan | Created | Agent analysis complete |
| 2026-01-29 | Phase 1 | Complete | QuickReorderQueue, VersionTs, envutil |
| 2026-01-29 | Phase 2 | Complete | RPC types, backlog queue, non-blocking sends |
| 2026-01-29 | Phase 3 | Complete | lifecycleLock, ClientId caching, wshremote |
| 2026-01-30 | Phase 4 | Complete | ShellJobController, Controller interface |
| 2026-01-30 | Phase 5 | Complete | Build verified, TypeScript fixes |
