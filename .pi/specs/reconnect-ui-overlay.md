# Reconnect UI Overlay with Retry Transparency (PR #2)

## Problem

When a connection drops, the user experience is poor:

1. **No immediate feedback on disconnect**: The terminal just stops responding. The `disconnected` status is only visible in a small toolbar icon — there's no overlay explaining what happened.
2. **No visibility into retry attempts**: The reconnect scheduler loops in the background, but the user sees nothing — just a frozen terminal. They don't know if retry #1 failed, when retry #2 will happen, or whether the app is even trying.
3. **Stale `stalled` overlay**: The existing `StalledOverlay` only shows after `stalled` is declared (which may still take seconds even with PR #1's faster thresholds). During `disconnected` → `connecting` → retry cycles, there's zero UI feedback.

## Scope

- **In scope**: Rich overlay for `disconnected`, `connecting` (retry), and inter-retry countdown; backend events to feed the UI.
- **Out of scope**: Configurable thresholds (PR #3); changing the monitor/scheduler logic itself (PR #1 handles that).

## Desired User Experience

```
[09:16:43] User switches Wi-Fi
[09:16:45] Overlay appears: "Connection lost — retrying in 5s"
[09:16:46] Countdown: 4… 3… 2… 1…
[09:16:49] Overlay: "Attempt 1 — connecting to user@host…"
[09:16:51] Attempt fails (no route)
[09:16:51] Overlay: "No route to host — retrying in 3s"
[09:16:52] Countdown: 2… 1…
[09:16:54] Overlay: "Attempt 2 — connecting…"
[09:16:56] Wi-Fi ready! Reconnects.
[09:16:57] Overlay vanishes, terminal resumes.
```

Compare to current: blank frozen screen for 30–60 seconds, then sudden reconnect.

## Architecture

### Backend: New Retry State & Events

The backend currently emits `connchange` events with `ConnStatus`. We need additional per-connection retry state and more granular events.

**Option A: Extend `ConnStatus`**
Add fields to `wshrpc.ConnStatus`:
```go
type ConnStatus struct {
    // ... existing fields ...
    ReconnectAttempt     int   `json:"reconnectattempt,omitempty"`
    ReconnectNextAttempt int64 `json:"reconnectnextattempt,omitempty"` // UnixMilli
    ReconnectError       string `json:"reconnecterror,omitempty"`
}
```

**Option B: Separate retry event**
Emit a new `wps.Event_ReconnectAttempt` with attempt details. Simpler, doesn't bloat `ConnStatus`.

Recommendation: **Option A** — the overlay already consumes `ConnStatus`, so extending it is least frontend rework.

**New events to emit from `scheduleConnectionReconnect`:**
- When attempt starts: set `ReconnectAttempt = N`, `ReconnectNextAttempt = 0`, fire `connchange`
- When attempt fails: set `ReconnectError = err.Error()`, `ReconnectNextAttempt = time.Now().Add(interval).UnixMilli()`, fire `connchange`
- When attempt succeeds: clear retry fields, fire `connchange`
- When entering aggressive mode: same pattern, shorter interval

### Frontend: New Overlay States

The current `ConnStatusOverlay` only handles:
- `stalled` → `StalledOverlay` (yellow warning bar)
- `error` / `disconnected` / `connected` → generic overlay

We need a unified overlay that handles the full reconnect lifecycle:

```tsx
// Unified states:
const showDisconnected = connStatus.status === "disconnected" && !connStatus.connected;
const showRetrying     = connStatus.status === "connecting" && connStatus.reconnectattempt > 0;
const showCountdown    = connStatus.reconnectnextattempt > 0 && connStatus.status === "disconnected";
```

**Overlay components:**
1. **`DisconnectedOverlay`** — immediate on disconnect
   - Red/yellow icon
   - "Disconnected from `host`"
   - Error detail (TCP error, connserver error)
   - Reconnect button (manual trigger)
   - If retry is scheduled: "Auto-retrying in `countdown`s"

2. **`RetryingOverlay`** — during an active attempt
   - Spinner icon
   - "Attempt `N` — connecting to `host`…"
   - Cancel button (stop scheduler)

3. **`CountdownOverlay`** — between attempts
   - Timer icon
   - "Last attempt failed: `error`"
   - "Retrying in `countdown`s"
   - Reconnect now button (skip wait)

## Changes

### 1. Backend: `pkg/wshrpc/wshrpctypes.go` — Extend `ConnStatus`

Add optional retry fields:

```go
type ConnStatus struct {
    Status                       string `json:"status"`
    ConnHealthStatus             string `json:"connhealthstatus"`
    WshEnabled                   bool   `json:"wshenabled"`
    Connection                   string `json:"connection"`
    Connected                    bool   `json:"connected"`
    HasConnected                 bool   `json:"hasconnected"`
    ActiveConnNum                int    `json:"activeconnnum"`
    Error                        string `json:"error"`
    WshError                     string `json:"wsherror"`
    NoWshReason                  string `json:"nowshreason"`
    WshVersion                   string `json:"wshversion"`
    LastActivityBeforeStalledTime int64  `json:"lastactivitybeforestalledtime,omitempty"`
    KeepAliveSentTime            int64  `json:"keepalivesenttime,omitempty"`
    // NEW:
    ReconnectAttempt             int    `json:"reconnectattempt,omitempty"`
    ReconnectNextAttempt         int64  `json:"reconnectnextattempt,omitempty"`
    ReconnectError               string `json:"reconnecterror,omitempty"`
}
```

### 2. Backend: `pkg/jobcontroller/jobcontroller.go` — Emit retry state

In `scheduleConnectionReconnect`, before/after each `AttemptReconnect` call, update the connection's retry state and fire events:

```go
func scheduleConnectionReconnect(connName string) {
    // ... existing setup ...
    attempt := 0
    for {
        // ... existing checks ...

        attempt++
        updateRetryState(connName, attempt, 0, "") // active attempt

        ctx, cancelFn := context.WithTimeout(context.Background(), connectTimeout)
        err := conncontroller.AttemptReconnect(ctx, connName)
        cancelFn()

        if err != nil {
            isNetErr := isNetworkUnreachableError(err)
            interval := ConnReconnectInterval
            if aggressiveMode {
                interval = ConnReconnectAggressiveInterval
            }
            nextAttempt := time.Now().Add(interval).UnixMilli()
            updateRetryState(connName, attempt, nextAttempt, err.Error())
            // ... existing logging ...
        } else {
            clearRetryState(connName)
            return
        }

        // ... wait for interval ...
    }
}
```

Add helper functions:

```go
func updateRetryState(connName string, attempt int, nextAttempt int64, errMsg string) {
    connOpts, _ := remote.ParseOpts(connName)
    conn := conncontroller.GetConn(connOpts)
    if conn != nil {
        conn.SetReconnectState(attempt, nextAttempt, errMsg)
        conn.FireConnChangeEvent()
    }
}

func clearRetryState(connName string) {
    connOpts, _ := remote.ParseOpts(connName)
    conn := conncontroller.GetConn(connOpts)
    if conn != nil {
        conn.ClearReconnectState()
        conn.FireConnChangeEvent()
    }
}
```

### 3. Backend: `pkg/remote/conncontroller/conncontroller.go` — Store retry state

Add fields to `SSHConn`:

```go
type SSHConn struct {
    // ... existing fields ...
    ReconnectAttempt     int
    ReconnectNextAttempt int64
    ReconnectError       string
}
```

Add methods:

```go
func (conn *SSHConn) SetReconnectState(attempt int, nextAttempt int64, err string) {
    conn.WithLock(func() {
        conn.ReconnectAttempt = attempt
        conn.ReconnectNextAttempt = nextAttempt
        conn.ReconnectError = err
    })
}

func (conn *SSHConn) ClearReconnectState() {
    conn.WithLock(func() {
        conn.ReconnectAttempt = 0
        conn.ReconnectNextAttempt = 0
        conn.ReconnectError = ""
    })
}
```

Update `DeriveConnStatus()` to include retry fields:

```go
func (conn *SSHConn) DeriveConnStatus() wshrpc.ConnStatus {
    var status wshrpc.ConnStatus
    conn.WithLock(func() {
        status = wshrpc.ConnStatus{
            // ... existing fields ...
            ReconnectAttempt:     conn.ReconnectAttempt,
            ReconnectNextAttempt: conn.ReconnectNextAttempt,
            ReconnectError:       conn.ReconnectError,
        }
    })
    return status
}
```

### 4. Frontend: `frontend/app/block/connstatusoverlay.tsx` — New overlay states

Refactor `ConnStatusOverlay` to handle the full lifecycle:

```tsx
export const ConnStatusOverlay = React.memo(...) => {
    // ... existing setup ...
    const connStatus = jotai.useAtomValue(waveEnv.getConnStatusAtom(connName));

    const showStalled = connStatus.status === "connected" && connStatus.connhealthstatus === "stalled";
    const showDisconnected = connStatus.status === "disconnected" && !connStatus.connected;
    const showRetrying = connStatus.status === "connecting" && connStatus.reconnectattempt > 0;
    const showCountdown = connStatus.reconnectnextattempt > 0 && connStatus.status === "disconnected";

    if (showStalled && !showWshError) {
        return <StalledOverlay ... />;
    }

    if (showRetrying) {
        return <RetryingOverlay connName={connName} attempt={connStatus.reconnectattempt} />;
    }

    if (showCountdown) {
        return <CountdownOverlay
            connName={connName}
            nextAttempt={connStatus.reconnectnextattempt}
            lastError={connStatus.reconnecterror}
            onReconnectNow={handleTryReconnect}
        />;
    }

    if (showDisconnected) {
        return <DisconnectedOverlay
            connName={connName}
            error={connStatus.error}
            onReconnect={handleTryReconnect}
            nextAttempt={connStatus.reconnectnextattempt}
        />;
    }
    // ...
};
```

**New components to implement:**

1. `DisconnectedOverlay` — shows immediately on disconnect, with error detail and optional countdown
2. `RetryingOverlay` — spinner + "Attempt N — connecting…"
3. `CountdownOverlay` — countdown timer that updates every second, shows last error, "Reconnect now" button

The `CountdownOverlay` needs a `useEffect` with `setInterval(1000)` to compute `Math.max(0, nextAttempt - Date.now())`.

### 5. Frontend: `frontend/app/block/connectionbutton.tsx` — Update status icon

Update the toolbar icon logic to show retry states:

```tsx
} else if (connStatus?.status === "connecting" && connStatus?.reconnectattempt > 0) {
    color = "var(--warning-color)";
    iconName = "fa-solid fa-rotate";
    titleText = `Reconnecting to ${connection} (attempt ${connStatus.reconnectattempt})`;
} else if (connStatus?.status === "disconnected" && connStatus?.reconnectnextattempt > 0) {
    color = "var(--grey-text-color)";
    iconName = "fa-solid fa-clock";
    titleText = `Disconnected from ${connection} — retrying soon`;
}
```

### 6. Schema/Types: `frontend/types/gotypes.d.ts` — Update `ConnStatus`

Add the new fields to the TypeScript type definition:

```typescript
interface ConnStatus {
    status: string;
    connhealthstatus: string;
    // ... existing fields ...
    reconnectattempt?: number;
    reconnectnextattempt?: number;
    reconnecterror?: string;
}
```

## Test Plan

| Test | Setup | Expected |
|------|-------|----------|
| Disconnect overlay | Block `client.Close()` for 5s, trigger disconnect | Overlay shows "Disconnected" within 1s (not after 5s) |
| Retry overlay | Start reconnect scheduler | Overlay shows "Attempt 1 — connecting…" during `AttemptReconnect` |
| Countdown overlay | Failed attempt with 5s interval | Overlay shows countdown 5…4…3…2…1… then "Attempt 2" |
| Toolbar icon | Same scenarios | Icon changes from green → warning spinner → grey clock |
| Manual reconnect | Click "Reconnect now" during countdown | Immediate `AttemptReconnect`, skipping countdown |
| Success clears overlay | Reconnect succeeds | Overlay vanishes, terminal resumes |

## Validation Checklist

- [ ] `task build:backend` succeeds
- [ ] `task build:frontend` succeeds
- [ ] `go test ./pkg/remote/conncontroller/...` passes
- [ ] `go test ./pkg/jobcontroller/...` passes
- [ ] Manual test: disconnect, verify overlay sequence (disconnected → countdown → retry → connected)
- [ ] Manual test: verify toolbar icon reflects each state

## Dependencies

- **Requires PR #1**: Fast reconnect with hardcoded thresholds must be merged first, or the overlay will still show 30s+ delays.
- **No dependency on PR #3**: This is purely UI + event plumbing, independent of configurable thresholds.
