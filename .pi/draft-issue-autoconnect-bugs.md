# Bug: Durable session auto-reconnect unreliable — cooldown set before connection check, connStates race condition

## Symptom

Durable SSH sessions sometimes stay disconnected after the SSH connection is restored, while other times they auto-reconnect correctly. The behavior is inconsistent.

## Root Cause Analysis

The auto-reconnect system has two paths:

1. **Route-level** (`Event_RouteDown` on `job:<jobId>`): Fires when the job stream drops. Triggers `attemptAutoReconnect` after a 1s delay, with a 30s cooldown per job.
2. **Connection-level** (`Event_ConnChange`): Fires when the SSH connection state changes. When connection comes up, `onConnectionUp` reconnects all running jobs on that connection.

Both paths converge on `ReconnectJob()`. Neither is specific to durable vs standard — but **only durable sessions create jobs**, so only durable sessions have auto-reconnect. Standard sessions always require manual reconnect.

## Bug #1: Route-level cooldown fires before connection check (High impact)

In `pkg/jobcontroller/jobcontroller.go`:

```go
func handleRouteEvent(event *wps.WaveEvent, newStatus string) {
    // ...
    if shouldAttemptAutoReconnect(jobId) {   // sets cooldown timestamp HERE
        go attemptAutoReconnect(jobId, job.Connection)
    }
}

func attemptAutoReconnect(jobId string, connName string) {
    time.Sleep(AutoReconnectDelay)  // 1s delay
    isConnected, err := conncontroller.IsConnected(connName)
    if err != nil || !isConnected {
        return  // cooldown already set, but reconnect never happened
    }
    // ... actual reconnect
}
```

The 30s cooldown (`lastAutoReconnectAttempt.Set(jobId, now)`) is set in `shouldAttemptAutoReconnect` **before** `attemptAutoReconnect` checks if the connection is actually up. If the connection is down, the reconnect is skipped but the cooldown has already been consumed.

**Scenario**: SSH drops → job route goes down → cooldown set → 1s delay → connection still down → skip. Connection comes back 5s later → `onConnectionUp` tries `ReconnectJob` → may hit singleflight cache or other timing issues → job stays disconnected.

**Fix**: Move `lastAutoReconnectAttempt.Set(jobId, time.Now().Unix())` into `attemptAutoReconnect`, only after the connection check passes.

## Bug #2: connStates reconciliation race with buffered channel (Medium impact)

In `reconcileAllConns()` / `reconcileConn()`:

- `reconcileAllConns` scans `connStates.m`, sets `cs.reconciling = true`, spawns `go reconcileConn()`, releases lock
- `reconcileConn` does the work, then sets `cs.processed = targetState` and signals `reconcileCh` (buffer size 1)
- If `Event_ConnChange` fires rapidly (e.g., `disconnected` → `connected` → `disconnected`), `cs.actual` is updated by the event handler while the worker is mid-processing
- After worker sets `cs.processed`, it may match the new `cs.actual` — causing the next reconcile pass to skip with `cs.actual == cs.processed`
- The buffered `reconcileCh` (size 1) can also drop signals if multiple events fire before the worker drains it

**Scenario**: Connection flaps quickly — reconcile worker misses a state transition — `onConnectionUp` never fires — jobs never reconnect.

**Fix**: Pass the target state to the goroutine (already done), and have the goroutine do a fresh reconcile check after completing, rather than relying on the buffered channel signal. Or use an unbuffered channel with a dedicated worker loop.

## Bug #3: singleflight in ReconnectJob can cache transient failures (Low impact, timing-dependent)

`ReconnectJob` uses `reconnectGroup.Do(jobId, ...)` (singleflight). If route-level `attemptAutoReconnect` calls `ReconnectJob` concurrently with connection-level `onConnectionUp` calling `ReconnectJob` for the same jobId, they share the same result. If the route-level call runs first and fails (connection down), the connection-level call gets the cached failure.

This only affects very tight timing windows (< 10s context timeout), but is worth noting.

## Files involved

| File | Relevant functions |
|------|--------------------|
| `pkg/jobcontroller/jobcontroller.go` | `handleRouteEvent`, `shouldAttemptAutoReconnect`, `attemptAutoReconnect`, `reconcileAllConns`, `reconcileConn`, `onConnectionUp`, `ReconnectJob` |
| `pkg/remote/conncontroller/conncontroller.go` | `waitForDisconnect`, `Connect`, `FireConnChangeEvent` |

## Missing Detection Mechanisms

Beyond the bugs above, several reconnection triggers are missing entirely:

### Missing #1: System sleep/wake does nothing

`emain/emain.ts` listens for `powerMonitor.on("resume")` and calls `NotifySystemResumeCommand`, which is a **stub that just logs and returns nil**. No reconnect is attempted.

**Fix**: Have `NotifySystemResumeCommand` trigger reconnect for all disconnected durable jobs.

### Missing #2: No network-online detection

There is no monitoring of network connectivity state. The system relies entirely on TCP-level failure detection (SSH connection drops), which can be slow:
- TCP keepalive may not be enabled or may have very long timeouts
- Silent packet loss (asymmetric routing, firewall drop) may not trigger TCP timeout for minutes
- Network interface comes back up but no event triggers reconnect attempt

**Fix**: Add periodic network-online check (e.g., every 30s) when durable jobs are in disconnected state. When network comes back up, trigger reconnect attempt.

### Missing #3: No SSH/TCP keepalive configuration

SSH connections may not have aggressive keepalive settings, meaning a "zombie" connection (network dropped but TCP hasn't detected it) can persist for a long time. The connection appears "up" in `connStates` but is actually dead.

**Fix**: Configure `ClientAliveInterval` and `ClientAliveCountMax` on SSH connections to detect dead connections faster.

## Edge Cases

| Case | Scenario | Current behavior | Desired behavior |
|------|----------|------------------|------------------|
| **Job manager died** | `wsh jobmanager` process crashed on remote | Reconnect attempts fail repeatedly | Detect this case, mark job as "dead" instead of retrying |
| **User manually disconnects** | Click "Disconnect" in UI | May trigger auto-reconnect | Respect explicit disconnect vs network failure |
| **Multiple jobs, one connection** | SSH drops, 5 durable jobs on that host | Connection-level reconnect handles, but timing matters | Reconnect jobs in parallel after SSH is back, per-job backoff |
| **Reconnect during active typing** | User typing when network drops, comes back | Keystrokes lost, terminal may be inconsistent | Buffer keystrokes or show clear "reconnecting" state |
| **Connection flapping** | Network rapidly up/down | Each flap triggers reconnect, may hit cooldown | Exponential backoff with jitter |

## Priority

**P0 — Fix existing bugs:**
- Bug #1: Cooldown consumed before connection check (High impact)
- Bug #2: Channel buffer drops rapid state changes (Medium impact)
- Bug #3: singleflight caches transient failures (Low impact, timing-dependent)

**P1 — Add missing detection:**
- Wire up `NotifySystemResumeCommand` to trigger reconnect on system wake
- Add network-online polling when jobs are disconnected
- Enable SSH keepalive on connections for faster dead-connection detection

**P2 — Edge cases:**
- Detect job manager death vs route drop
- Respect manual disconnect (don't auto-reconnect)
- Reconnect state indicator in UI

## Files involved

| File | Relevant functions |
|------|--------------------|
| `pkg/jobcontroller/jobcontroller.go` | `handleRouteEvent`, `shouldAttemptAutoReconnect`, `attemptAutoReconnect`, `reconcileAllConns`, `reconcileConn`, `onConnectionUp`, `ReconnectJob` |
| `pkg/remote/conncontroller/conncontroller.go` | `waitForDisconnect`, `Connect`, `FireConnChangeEvent` |
| `emain/emain.ts` | `powerMonitor.on("resume")` — currently calls stub |
| `pkg/wshrpc/wshserver/wshserver.go` | `NotifySystemResumeCommand` — currently no-op |

## Notes

- These bugs affect **durable sessions only** — standard SSH sessions have no auto-reconnect machinery
- The `DurableDetachedContent` flyover tells users "Wave will automatically reconnect when the connection is restored" — but this is unreliable due to these bugs
- No existing tests cover `jobcontroller.go` reconnect paths
