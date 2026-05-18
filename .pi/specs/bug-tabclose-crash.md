# Bug: Crash on Tab Close After SSH Session Exit

**Status:** Fixed (2026-05-14)  
**Priority:** High  
**Date:** 2026-05-13
**Resolution:** Root cause confirmed; redundant goroutine removed from `CloseTab`; `ShellProc.Close()` made idempotent with `sync.Once`; trace logging added.

## Reproduction Steps

1. Connect to SSH from the dropdown
2. Type `exit` in the shell
3. Click the tab 'x' to close the tab
4. → Crash

## Thesis: Root Cause Analysis

### Primary Suspect: Race Condition in `CloseTab` — Double Block Controller Destruction

**Location:** `pkg/service/workspaceservice/workspaceservice.go:218-232`

The `CloseTab` method has a critical design flaw that triggers **concurrent** `DestroyBlockController` calls for each block:

```go
func (svc *WorkspaceService) CloseTab(...) {
    tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
    if err == nil && tab != nil {
        go func() {                                    // ← Goroutine A
            for _, blockId := range tab.BlockIds {
                blockcontroller.DestroyBlockController(blockId)
            }
        }()
    }
    newActiveTabId, err := wcore.DeleteTab(ctx, ...)   // ← Synchronous
    // DeleteTab → DeleteBlock → sendBlockCloseEvent
    // → handleBlockCloseEvent → go DestroyBlockController(blockId)  ← Goroutine B
}
```

Each block gets `DestroyBlockController` called **twice concurrently** — once from the explicit goroutine in `CloseTab` (Goroutine A), and once from the block-close event handler triggered by `DeleteBlock` (Goroutine B).

### How This Leads to a Crash

#### Path 1: `ShellController.Stop` — Double `ShellProc.Close()` on SSH Session

`DestroyBlockController` calls `controller.Stop(true, Status_Done, true)`. For `ShellController`, `Stop` has a **Lock/Unlock/Relock** pattern that creates a race window:

```go
func (sc *ShellController) Stop(graceful bool, newStatus string, destroy bool) {
    sc.Lock.Lock()
    defer sc.Lock.Unlock()

    if sc.ShellProc == nil || sc.ProcStatus == Status_Done || sc.ProcStatus == Status_Init {
        return   // ← Guard check, but...
    }
    sc.ShellProc.Close()            // ← First Close
    if graceful {
        doneCh := sc.ShellProc.DoneCh
        sc.Lock.Unlock()            // ← UNLOCKS here, allowing concurrent Stop to enter
        <-doneCh                    // ← Waits for shell process to finish
        sc.Lock.Lock()             // ← Re-locks after waiting
    }
    sc.ProcStatus = newStatus      // ← Only NOW updated, but second Stop already entered
}
```

**Race sequence:**
1. Goroutine A calls `Stop`, acquires lock, checks `ProcStatus == Status_Running`, calls `ShellProc.Close()`, **unlocks** to wait on `doneCh`
2. Goroutine B calls `Stop`, acquires lock, sees `ShellProc != nil` and `ProcStatus == Status_Running` (not yet updated), calls `ShellProc.Close()` **again**
3. `ShellProc.Close()` calls `Cmd.KillGraceful()` → `SessionWrap.Kill()` → `Tty.Close()` + `Session.Close()`
4. **Double `ssh.Session.Close()`** on a session that may already be closing (after user typed `exit`)
5. **Double `PipePty.Close()`** — closing `os.File` descriptors twice

On a closed/dying SSH session, `Session.Close()` sends a channel close message over a potentially-dead SSH mux. The `x/crypto/ssh` library's `channel.Close()` calls `channel.sendMessage()` which writes to the transport. If the mux loop has already exited and cleaned up, this can cause:
- Panic from writing to a closed/cleaned-up channel
- Panic from `close` on a closed channel (Go runtime panic)
- Data race on mux internals that have been cleaned up

#### Path 2: `ShellProc.Close()` Double Channel Close

`ShellProc.Close()` spawns a goroutine:

```go
func (sp *ShellProc) Close() {
    sp.Cmd.KillGraceful(DefaultGracefulKillWait)
    go func() {
        waitErr := sp.Cmd.Wait()
        sp.SetWaitErrorAndSignalDone(waitErr)
        if runtime.GOOS != "windows" {
            sp.Cmd.Close()
        }
    }()
}
```

When called twice concurrently, `KillGraceful` is called twice, and two goroutines are spawned that both call `Wait()` and `Close()`. While `Wait()` is protected by `sync.Once` and `SetWaitErrorAndSignalDone` is protected by `CloseOnce`, **`KillGraceful` and `Close` are NOT idempotent or protected**.

For `SessionWrap`:
- `KillGraceful` → `Kill()` → `Tty.Close()` + `Session.Close()` — called twice
- `Close()` is a no-op (the `pty.Pty` interface has no `Close` method beyond `ReadWriteCloser`, and `SessionWrap` doesn't implement an explicit `Close()`)

For `CmdWrap` (local shells):
- `KillGraceful` → sends signal, then force-kills after timeout
- `Close()` → `Cmd.Wait()` + pty close — double close on pty

#### Path 3: Durable Shell — Job Termination Race with Block Deletion

For SSH blocks using `DurableShellController` (the default for SSH connections):

When user types `exit`:
1. The remote shell process exits
2. `HandleCmdJobExited` is called → `tryTerminateJobManager` terminates the job manager
3. The output stream reaches EOF → `StreamDone = true`

When user clicks tab X:
- `DestroyBlockController` → `DurableShellController.Stop(true, Status_Done, true)` → `TerminateAndDetachJob(ctx, jobId)`
- But the job may already be terminated/detached
- `DetachJobFromBlock` tries to update the block's `JobId` field via `wstore.DBUpdateFn`
- But the block may already be **deleted from the DB** by `DeleteBlock` (running concurrently in `DeleteTab`)
- This could cause a DB error or panic if the update operates on a non-existent record

#### Path 4: ConnMonitor Keepalive on Closing SSH Client

When the SSH connection is still alive (connserver session persists after shell exit), `ConnMonitor` runs keepalive checks every 5 seconds:

```go
func (cm *ConnMonitor) SendKeepAlive() error {
    client := cm.Client    // ← Stale reference captured at creation time
    if !cm.setKeepAliveInFlight() {
        return nil
    }
    go func() {
        _, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
        // ...
    }()
}
```

If `closeInternal_withlifecyclelock()` is called concurrently:
1. It calls `conn.Monitor.Close()` (cancels context)
2. It calls `client.Close()` (closes SSH client)
3. It sets `conn.Client = nil`

But a keepalive goroutine may have already captured `client := cm.Client` and started `SendRequest` on a closing/closed client. While `x/crypto/ssh` generally handles this gracefully (returning `io.EOF`), if the mux loop has already exited and cleaned up its internal channels, accessing the mux can race.

### Secondary Contributing Factors

1. **`DurableShellController.Stop` has no lock** — Unlike `ShellController.Stop`, concurrent calls can race on the `JobId` field read.

2. **No idempotency guard on `ShellProc.Close()`** — No `sync.Once` or closed-flag prevents double-close.

3. **`ConnMonitor` holds stale `*ssh.Client` reference** — Never updated when client is closed/nilled.

4. **`handleBlockCloseEvent` launches goroutine** — `go DestroyBlockController(blockId)` makes the double-destroy race uncontrolled.

### Most Likely Crash Sequence (SSH + Durable Shell)

1. User types `exit` in SSH shell → shell process on remote exits
2. `HandleCmdJobExited` fires → `tryTerminateJobManager` → job manager terminated
3. User clicks tab X → `CloseTab` called
4. Goroutine A: `DestroyBlockController(blockId)` → `DurableShellController.Stop()` → `TerminateAndDetachJob(jobId)`
5. `DeleteTab` → `DeleteBlock` → `sendBlockCloseEvent`
6. Goroutine B: `handleBlockCloseEvent` → `DestroyBlockController(blockId)` → second `DurableShellController.Stop()` → second `TerminateAndDetachJob(jobId)`
7. First call terminates job and detaches from block (block's `JobId` cleared)
8. Second call tries to detach from already-detached/non-existent block → potential DB error or nil pointer

### Most Likely Crash Sequence (SSH + Non-Durable Shell)

1. User types `exit` in SSH shell → `manageRunningShellProcess` wait loop detects exit → `ProcStatus = Status_Done`
2. User clicks tab X → `CloseTab` called
3. Goroutine A: `DestroyBlockController(blockId)` → `ShellController.Stop(true, Status_Done, true)` → sees `ProcStatus == Status_Done` → returns early (OK)
4. Goroutine B (from `sendBlockCloseEvent`): `DestroyBlockController(blockId)` → controller already deleted from registry → returns early (OK)
5. **But** if the timing is different — tab close happens while `ProcStatus` is still `Status_Running` (shell still exiting):
   - Goroutine A: `Stop` acquires lock, sees Running, calls `ShellProc.Close()`, **unlocks** to wait
   - Goroutine B: `Stop` acquires lock, sees Running (not yet Done), calls `ShellProc.Close()` **again**
   - Double `Session.Close()` → potential panic in SSH library

---

## Logging Additions (Suggested)

### 1. In `CloseTab` — Trace the double-destroy path

**File:** `pkg/service/workspaceservice/workspaceservice.go`

```go
func (svc *WorkspaceService) CloseTab(ctx context.Context, workspaceId string, tabId string, fromElectron bool) (*CloseTabRtnType, waveobj.UpdatesRtnType, error) {
    ctx = waveobj.ContextWithUpdates(ctx)
    tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
    if err == nil && tab != nil {
        log.Printf("[closetab] tab=%s blocks=%v launching async DestroyBlockController goroutine", tabId, tab.BlockIds)
        go func() {
            for _, blockId := range tab.BlockIds {
                log.Printf("[closetab] DestroyBlockController block=%s (from CloseTab goroutine)", blockId)
                blockcontroller.DestroyBlockController(blockId)
            }
        }()
    }
    // ...
}
```

### 2. In `DestroyBlockController` — Detect double-destroy

**File:** `pkg/blockcontroller/blockcontroller.go`

```go
func DestroyBlockController(blockId string) {
    controller := getController(blockId)
    if controller == nil {
        log.Printf("[destroy] block=%s: controller already nil (possible double-destroy)", blockId)
        return
    }
    log.Printf("[destroy] block=%s: stopping controller (type=%T, connName=%s)", blockId, controller, controller.GetConnName())
    controller.Stop(true, Status_Done, true)
    wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
    deleteController(blockId)
    log.Printf("[destroy] block=%s: controller deleted from registry", blockId)
}
```

### 3. In `ShellController.Stop` — Detect concurrent Stop and double-Close

**File:** `pkg/blockcontroller/shellcontroller.go`

```go
func (sc *ShellController) Stop(graceful bool, newStatus string, destroy bool) {
    sc.Lock.Lock()
    defer sc.Lock.Unlock()
    log.Printf("[shellcontroller] Stop block=%s procStatus=%s shellProcNil=%v destroy=%v", sc.BlockId, sc.ProcStatus, sc.ShellProc == nil, destroy)

    if sc.ShellProc == nil || sc.ProcStatus == Status_Done || sc.ProcStatus == Status_Init {
        if newStatus != sc.ProcStatus {
            sc.ProcStatus = newStatus
            sc.sendUpdate_nolock()
        }
        return
    }
    // ...
    sc.ShellProc.Close()
    if graceful {
        doneCh := sc.ShellProc.DoneCh
        sc.Lock.Unlock()            // ← RACE WINDOW STARTS HERE
        log.Printf("[shellcontroller] Stop block=%s waiting on DoneCh (lock released)", sc.BlockId)
        <-doneCh
        sc.Lock.Lock()             // ← RACE WINDOW ENDS HERE
        log.Printf("[shellcontroller] Stop block=%s DoneCh closed (lock reacquired)", sc.BlockId)
    }
    // ...
}
```

### 4. In `DurableShellController.Stop` — Log concurrent access

**File:** `pkg/blockcontroller/durableshellcontroller.go`

```go
func (dsc *DurableShellController) Stop(graceful bool, newStatus string, destroy bool) {
    if !destroy {
        return
    }
    jobId := dsc.getJobId()
    log.Printf("[durableshellcontroller] Stop block=%s jobId=%s destroy=%v", dsc.BlockId, jobId, destroy)
    if jobId == "" {
        return
    }
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    jobcontroller.TerminateAndDetachJob(ctx, jobId)
}
```

### 5. In `ConnMonitor.SendKeepAlive` — Detect stale client reference

**File:** `pkg/remote/conncontroller/connmonitor.go`

```go
func (cm *ConnMonitor) SendKeepAlive() error {
    client := cm.Client
    currentClient := cm.Conn.GetClient()
    if currentClient == nil {
        log.Printf("[connmonitor] SendKeepAlive: conn=%s client is nil (connection closed)", cm.Conn.GetName())
        return nil
    }
    if client != currentClient {
        log.Printf("[connmonitor] SendKeepAlive: conn=%s stale client reference (monitor client != current client)", cm.Conn.GetName())
        return nil
    }
    // ... rest of SendKeepAlive
}
```

### 6. In `handleBlockCloseEvent` — Log the event handling

**File:** `pkg/blockcontroller/blockcontroller.go`

```go
func handleBlockCloseEvent(event *wps.WaveEvent) {
    blockId, ok := event.Data.(string)
    if !ok {
        log.Printf("[blockclose] invalid event data type")
        return
    }
    log.Printf("[blockclose] block=%s: launching DestroyBlockController goroutine from event handler", blockId)
    go DestroyBlockController(blockId)
}
```

**File:** `pkg/jobcontroller/jobcontroller.go`

```go
func handleBlockCloseEvent(event *wps.WaveEvent) {
    // ... existing code ...
    log.Printf("[blockclose-job] block=%s: found %d jobs to terminate", blockId, len(jobIds))
    for _, jobId := range jobIds {
        log.Printf("[blockclose-job] block=%s: terminating job=%s", blockId, jobId)
        TerminateAndDetachJob(ctx, jobId)
    }
}
```

---

## Tests Written

**File:** `pkg/blockcontroller/blockcontroller_test.go`

### Tests Implemented

| Test | What it tests | Result |
|------|--------------|--------|
| `TestShellControllerStopConcurrent/double_stop_does_not_double_kill` | Two concurrent `Stop` calls on a running ShellController — uses slow mock to expose Lock/Unlock/Relock race | **PASS** — but only checks KillGraceful count, not data race |
| `TestShellControllerStopConcurrent/stop_after_proc_done_is_noop` | Stop on a controller with ProcStatus=Done | **PASS** |
| `TestShellControllerStopConcurrent/stop_sets_status_done` | Stop updates ProcStatus correctly | **PASS** |
| `TestDestroyBlockControllerDoubleCall` | Two concurrent `DestroyBlockController` calls for same blockId | **PASS** — second call finds nil controller and returns |
| `TestDestroyBlockControllerDoubleCallDurable` | Same test with DurableShellController | **PASS** |
| `TestDurableShellControllerStopConcurrent/stop_with_empty_jobid_is_noop` | Stop with no jobId | **PASS** |
| `TestDurableShellControllerStopConcurrent/stop_without_destroy_is_noop` | Stop with destroy=false | **PASS** |
| `TestShellControllerStopNilShellProc/nil_proc_updates_status` | Stop with nil ShellProc updates status | **PASS** |
| `TestShellControllerStopNilShellProc/nil_proc_already_done_noop` | Stop when already Done | **PASS** |
| `TestShellControllerStopNilShellProc/nil_proc_init_status` | Stop when Init | **PASS** |
| `TestShellProcDoubleClose/double_close_on_running_proc` | Two concurrent `ShellProc.Close()` calls | **PASS** |
| `TestShellProcDoubleClose/close_then_wait` | Close then second Close after Wait | **PASS** — Wait is protected by sync.Once |
| `TestShellControllerStopRaceWithDoneStatus` | Tab-close Stop racing with shell-exit status update | **PASS** |
| `TestShellControllerStopDoesNotPanicOnClosedSession/closed_session_stop` | Stop on closed SSH session | **PASS** |
| `TestShellControllerStopDoesNotPanicOnClosedSession/concurrent_stop_on_closing_session` | Three concurrent operations: two Stops + shell exit | **PASS** |

### Test Infrastructure

- **`mockConnInterface`**: Fast mock where `Wait()` returns immediately. Good for testing the guard conditions and status updates.
- **`slowMockConnInterface`**: Slow mock where `Wait()` blocks until `KillGraceful` signals it or `waitDone` is closed. Essential for exposing the Lock/Unlock/Relock race in `ShellController.Stop`.
- **`mockClosedConnInterface`**: Mock that returns errors from all operations, simulating a closed SSH session.

### Key Finding from Tests

The `double_stop_does_not_double_kill` test **passes without detecting the double-KillGraceful** in the default case because:
- With the slow mock, `KillGraceful` triggers `Wait()` to complete, and the `DoneCh` is signaled
- The second `Stop` call sees `ProcStatus == Status_Done` (updated after the first Stop completes) and returns early
- **However**, this depends on timing. If the second `Stop` enters during the `Lock.Unlock()` / `<-doneCh` / `Lock.Lock()` window, it WILL call `ShellProc.Close()` again

Running with `go test -race` does not flag a data race in the test because the test's `Stop` calls are serialized by the `ShellController.Lock`. The actual race is a **logical race** (double-close), not a data race detectable by the race detector. The race detector would catch it if two goroutines accessed the same `ShellProc` fields without synchronization, but `ShellProc.Close()` is called under the controller's lock.

**The real danger** is that `ShellProc.Close()` launches a **goroutine** (`go func() { waitErr := sp.Cmd.Wait(); ... }()`), and the second `Close()` launches another goroutine. Both goroutines call `Cmd.Wait()` and `Cmd.Close()` concurrently without synchronization. This IS a data race on the SSH session internals, but it happens inside the `x/crypto/ssh` library, not in waveterm code, so the Go race detector won't flag it directly.

---

## In Flight / Not Yet Done

### Tests Still Needed

1. **`go test -race` on the double-ShellProc.Close goroutine race** — The `ShellProc.Close()` method spawns a goroutine that calls `Cmd.Wait()` and `Cmd.Close()`. Two concurrent `Close()` calls spawn two goroutines that race on SSH session internals. Need a test that directly exercises this goroutine race.

2. **Integration test with real SSH session** — Unit tests can't fully simulate the `x/crypto/ssh` library's behavior when `Session.Close()` is called on a closing session. An integration test with a real SSH connection would catch panics in the SSH library.

3. **`CloseTab` double-destroy integration test** — Test the full `CloseTab` flow: create a tab with blocks, then close it, and verify no double-destroy or panic.

4. **`ConnMonitor` keepalive on stale client test** — Test that `SendKeepAlive` on a closed/nilled client doesn't panic.

5. **`DurableShellController.Stop` concurrent job termination test** — Test two concurrent `TerminateAndDetachJob` calls on the same jobId. This requires setting up the job DB, which is more complex.

### Logging Not Yet Added

The logging additions described above are **designed but not yet implemented** in the source files. They should be added to enable interactive crash reproduction and diagnosis.

### Fix Not Yet Implemented

The fix for the primary root cause (double-destroy in `CloseTab`) should be one of:

**Option A: Remove the redundant goroutine in `CloseTab`**
The explicit `go func() { DestroyBlockController(...) }()` goroutine in `CloseTab` is redundant because `DeleteTab` → `DeleteBlock` → `sendBlockCloseEvent` already triggers controller destruction. Removing it eliminates the double-destroy entirely.

**Option B: Add idempotency to `DestroyBlockController`**
Make `DestroyBlockController` safe for concurrent calls by adding a `destroyed` flag or using `sync.Once`:

```go
func DestroyBlockController(blockId string) {
    // Use sync.Map or a separate set to track in-progress destructions
    if !markDestroyInProgress(blockId) {
        return // already being destroyed
    }
    defer clearDestroyInProgress(blockId)
    controller := getController(blockId)
    if controller == nil {
        return
    }
    controller.Stop(true, Status_Done, true)
    wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
    deleteController(blockId)
}
```

**Option C: Make `ShellProc.Close()` idempotent**
Add a `sync.Once` to `ShellProc.Close()`:

```go
func (sp *ShellProc) Close() {
    sp.closeOnce.Do(func() {
        sp.Cmd.KillGraceful(DefaultGracefulKillWait)
        go func() {
            defer func() {
                panichandler.PanicHandler("ShellProc.Close", recover())
            }()
            waitErr := sp.Cmd.Wait()
            sp.SetWaitErrorAndSignalDone(waitErr)
            if runtime.GOOS != "windows" {
                sp.Cmd.Close()
            }
        }()
    })
}
```

**Recommended approach:** Option A (remove redundant goroutine) + Option C (make ShellProc.Close idempotent) as defense-in-depth. Option A fixes the root cause; Option C protects against any other code path that might call Close twice.

### Interactive Reproduction Needed

The tests above confirm the structural race conditions exist but don't reproduce the actual crash. To confirm the crash:
1. Add the logging additions
2. Build and run waveterm with `task dev`
3. Connect to an SSH server from the dropdown
4. Type `exit` in the shell
5. Click the tab X
6. Check logs for double-destroy patterns and any panic/crash output