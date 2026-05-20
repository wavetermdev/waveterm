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

## Notes

- These bugs affect **durable sessions only** — standard SSH sessions have no auto-reconnect machinery
- The `DurableDetachedContent` flyover tells users "Wave will automatically reconnect when the connection is restored" — but this is unreliable due to these bugs
- No existing tests cover `jobcontroller.go` reconnect paths
