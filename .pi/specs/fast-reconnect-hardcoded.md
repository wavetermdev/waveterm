# Fast Reconnect — Hardcoded Thresholds (PR #1)

## Problem

When a laptop switches Wi-Fi networks or sleeps/resumes, Wave Terminal takes 30–60 seconds to detect the disconnection and reconnect. The root causes are:

1. **Slow stall detection**: The keepalive monitor waits 10 seconds of inactivity before sending a probe, then 10 more seconds before declaring `stalled`.
2. **Slow auto-disconnect**: Even after `stalled` is declared, it takes 30 seconds (default) before forcing a disconnect.
3. **Slow reconnect scheduler**: The first reconnect attempt uses a 30-second timeout, and subsequent retries wait 30 seconds between attempts.
4. **Deadlock risk**: `Close()` and `Connect()` can deadlock on `lifecycleLock` when a fast reconnect is attempted after system resume.
5. **Event timing bug**: The disconnect `connchange` event was fired after `closeInternal()` returned, so if `client.Close()` blocked on dead TCP, the frontend never learned the connection was down.

## Scope

- **In scope**: Tighten all hardcoded thresholds to laptop-appropriate values; fix the lifecycle lock deadlock; fix the deferred disconnect event.
- **Out of scope**: UI overlay changes (PR #2); configurable thresholds (PR #3); removing the `degraded` health status.

## Current Architecture

```
ConnMonitor (5s ticker)
    ├─ checkConnection() every 5s
    │   ├─ SendKeepAlive() if >10s inactivity (1s if "urgent")
    │   └─ set stalled if keepalive unanswered >10s (>5s urgent)
    ├─ inputNotifyCh branch
    │   └─ set degraded after 1s if no echo
    └─ auto-disconnect if stalled >30s

waitForDisconnect() goroutine
    └─ client.Wait() blocks on dead TCP → natural disconnect

conn.Close()
    ├─ set Status = Disconnected
    ├─ FireConnChangeEvent()        ← BUG: was deferred after closeInternal
    └─ closeInternal_withlifecyclelock()
        └─ client.Close() / listener.Close() / controller.Close()

jobcontroller
    ├─ onConnectionDown() → scheduleConnectionReconnect()
    │   └─ loop: AttemptReconnect(timeout=30s), wait 30s, retry
    └─ HandleSystemResume() → conn.Close() + AttemptReconnect()
        └─ DEADLOCK: Close() holds lifecycleLock, Connect() needs it
```

## Changes

### 1. `pkg/remote/conncontroller/conncontroller.go` — Event before blocking close

#### 1a. `Close()` and `waitForDisconnect()`

Move `FireConnChangeEvent()` to fire **immediately** after setting `Status = Disconnected` and `ConnHealthStatus = Good`, before calling `closeInternal_withlifecyclelock()`.

```go
func (conn *SSHConn) Close() {
    conn.WithLock(func() {
        if conn.Status == Status_Connecting {
            conn.cancelConnectCtx()
        }
        if conn.Status == Status_Connected || conn.Status == Status_Connecting {
            conn.Status = Status_Disconnected
        }
        conn.ConnHealthStatus = ConnHealthStatus_Good
    })
    // FIRE EVENT FIRST — so UI and jobcontroller react even if cleanup blocks
    conn.FireConnChangeEvent()
    conn.closeInternal_withlifecyclelock()
}
```

Same pattern in `waitForDisconnect()`:

```go
func (conn *SSHConn) waitForDisconnect(client *ssh.Client, listener net.Listener, controller *genconn.ConnController) {
    // ... wait for error ...
    conn.WithLock(func() {
        if conn.Client == client {
            conn.Status = Status_Disconnected
            conn.ConnHealthStatus = ConnHealthStatus_Good
        }
    })
    conn.FireConnChangeEvent()  // ← moved BEFORE closeInternal
    conn.closeInternal_withlifecyclelock()
}
```

#### 1b. `closeInternal_withlifecyclelock()` — Run blocking cleanup in goroutine

To prevent the deadlock where `HandleSystemResume` calls `Close()` then spawns a reconnect goroutine that calls `Connect()`, which also needs `lifecycleLock`:

```go
func (conn *SSHConn) closeInternal_withlifecyclelock() {
    conn.lifecycleLock.Lock()
    defer conn.lifecycleLock.Unlock()

    // Capture old references under conn.lock, nil them immediately
    // so Connect() sees clean state and can proceed without waiting
    var oldClient *ssh.Client
    var oldListener net.Listener
    var oldController *genconn.ConnController
    conn.WithLock(func() {
        oldClient = conn.Client
        oldListener = conn.Listener
        oldController = conn.ConnController
        conn.Client = nil
        conn.Monitor = nil
        conn.Listener = nil
        conn.ConnController = nil
    })

    // Run the actual blocking Close() calls in a background goroutine
    // This frees lifecycleLock immediately for Connect() / HandleSystemResume
    go func() {
        if oldListener != nil {
            oldListener.Close()
        }
        if oldController != nil {
            oldController.Close()
        }
        if oldClient != nil {
            oldClient.Close()
        }
    }()
}
```

### 2. `pkg/remote/conncontroller/connmonitor.go` — Tighten thresholds

Change hardcoded constants to laptop-appropriate values:

| Constant | Current | New | Rationale |
|----------|---------|-----|-----------|
| `keepAliveThreshold` (normal) | 10000 (10s) | **3000 (3s)** | Detect dead network faster |
| `keepAliveThreshold` (urgent) | 1000 (1s) | **1000 (1s)** | Keep — typing already triggers fast path |
| `stalledThreshold` (normal) | 10000 (10s) | **3000 (3s)** | Declare stall after 3s no response |
| `stalledThreshold` (urgent) | 5000 (5s) | **2000 (2s)** | Faster when user is actively typing |
| `getStallDisconnectThresholdMs()` default | 30000 (30s) | **5000 (5s)** | Disconnect 5s after stall, don't wait for TCP |
| `ticker interval` | 5 * time.Second | **3 * time.Second** | Check more frequently |

```go
// In checkConnection():
keepAliveThreshold := int64(3000)
if urgent {
    keepAliveThreshold = 1000
}

stalledThreshold := int64(3000)
if urgent {
    stalledThreshold = 2000
}

// In keepAliveMonitor():
ticker := time.NewTicker(3 * time.Second)

// In getStallDisconnectThresholdMs():
return 5000 // 5s default
```

### 3. `pkg/jobcontroller/jobcontroller.go` — Tighten scheduler

Change hardcoded constants:

| Constant | Current | New | Rationale |
|----------|---------|-----|-----------|
| `ConnReconnectInterval` | 30s | **5s** | Retry every 5s instead of 30s |
| `ConnReconnectMaxDuration` | 5m | **5m** | Keep — don't retry forever |
| `ConnReconnectAggressiveInterval` | 5s | **3s** | Even faster when network is known down |
| `ConnReconnectAggressiveDuration` | 2m | **2m** | Keep |
| First attempt `connectTimeout` | 30s | **5s** | Don't block 30s on first attempt |
| Aggressive `connectTimeout` | 8s | **5s** | Consistent 5s timeout |

```go
const ConnReconnectInterval           = 5 * time.Second
const ConnReconnectAggressiveInterval = 3 * time.Second

// In scheduleConnectionReconnect:
connectTimeout := 5 * time.Second
if aggressiveMode {
    connectTimeout = 5 * time.Second
}
```

#### Add `context deadline exceeded` to `isNetworkUnreachableError`

```go
func isNetworkUnreachableError(err error) bool {
    // ... existing patterns ...
    if strings.Contains(s, "context deadline exceeded") {
        return true
    }
    return false
}
```

This ensures that ANY timeout (including the 5s context deadline) triggers aggressive mode.

### 4. `pkg/remote/sshclient.go` — Dial timing diagnostics (optional, temporary)

Add lightweight timing logs to `connectInternal()` for validating the fix in real-world testing:

```go
startDial := time.Now()
// ... dial ...
log.Printf("[conndebug] dial %s: %v", addr, time.Since(startDial))

startHandshake := time.Now()
// ... ssh handshake ...
log.Printf("[conndebug] ssh handshake %s: %v", addr, time.Since(startHandshake))
```

These can be removed or downgraded after validation.

## Test Plan

| Test | Setup | Expected |
|------|-------|----------|
| Disconnect event fires before cleanup | Unit test: mock `client.Close()` that blocks 10s | `FireConnChangeEvent` fires immediately, status shows `disconnected` within 1s |
| No lifecycleLock deadlock | Unit test: call `Close()` then `Connect()` from same goroutine | `Connect()` proceeds without blocking on `lifecycleLock` |
| Fast stall detection | Unit test: simulate no keepalive response | `stalled` declared within 3s of keepalive sent |
| Fast auto-disconnect | Unit test: simulate stall persists | `disconnectOnStall` fires within 5s of stall |
| Fast reconnect | Unit test: mock `AttemptReconnect` failure with network error | Aggressive mode triggers after first failure, retries every 3s |
| Real Wi-Fi switch (manual) | Build app, switch SSIDs, observe logs | Total disconnect-to-reconnect < 15s |

## Validation Checklist

- [ ] `task build:backend` succeeds
- [ ] `go test ./pkg/remote/conncontroller/...` passes
- [ ] `go test ./pkg/jobcontroller/...` passes
- [ ] Manual test: switch Wi-Fi, verify reconnect in < 15s
- [ ] Manual test: system sleep/resume, verify no deadlock/popup

## Notes

- All changes are **hardcoded constants** — no new config fields, no schema changes, no frontend changes.
- The `degraded` health status and `inputNotifyCh` path are **left untouched** — simplified in PR #3.
- Diagnostic logging in `sshclient.go` and `jobcontroller.go` is **temporary** for validation and can be removed after confirming behavior.
