# Configurable Reconnect & Monitor Thresholds (PR #3)

## Problem

PR #1 hardcodes fast thresholds (3s keepalive, 5s auto-disconnect, 5s retry interval) for laptop use. These work well for Wi-Fi switching but may be too aggressive for:

- Slow SSH servers (high latency, old hardware)
- Cellular/satellite connections (intermittent, high jitter)
- Server room workstations (stable wired networks don't need aggressive polling)
- User preference (some users prefer stability over speed)

Hardcoded values also prevent tuning without recompiling the app.

## Scope

- **In scope**: Per-connection configurable thresholds for monitor and scheduler; removal of the `degraded` health status; simplified monitor model.
- **Out of scope**: UI overlay changes (PR #2); changes to the underlying reconnect logic (PR #1).

## Goals

1. Every threshold from PR #1 becomes a `ConnKeywords` field with sensible defaults.
2. The `degraded` health status is removed — the monitor uses a single `good → stalled` transition.
3. The `inputNotifyCh` path is simplified: typing still triggers an immediate keepalive, but no `degraded` state is set.
4. Backward compatibility: missing config values fall back to PR #1's fast defaults.

## New Configurable Fields

### `ConnKeywords` additions (`pkg/wconfig/settingsconfig.go`)

```go
type ConnKeywords struct {
    // ... existing fields ...

    // Keepalive / Stall detection
    ConnKeepaliveIntervalSec       *int `json:"conn:keepaliveinterval,omitempty"`
    ConnStallThresholdSec          *int `json:"conn:stallthreshold,omitempty"`
    ConnAutoDisconnectThresholdSec *int `json:"conn:autodisconnectthreshold,omitempty"`

    // Reconnect scheduler
    ConnReconnectTimeoutSec        *int `json:"conn:reconnecttimeout,omitempty"`
    ConnReconnectIntervalSec       *int `json:"conn:reconnectinterval,omitempty"`
    ConnReconnectAggressiveIntervalSec *int `json:"conn:reconnectaggressiveinterval,omitempty"`

    // Feature flags
    ConnEnableStallAutoDisconnect  *bool `json:"conn:stallautodisconnect,omitempty"`
}
```

### Defaults (used when field is nil)

| Field | PR #1 Default | Rationale |
|-------|---------------|-----------|
| `conn:keepaliveinterval` | 3 | Seconds of inactivity before sending keepalive |
| `conn:stallthreshold` | 3 | Seconds after keepalive before declaring stalled |
| `conn:autodisconnectthreshold` | 5 | Seconds of stall before forcing disconnect |
| `conn:reconnecttimeout` | 5 | Timeout for each `AttemptReconnect` dial |
| `conn:reconnectinterval` | 5 | Seconds between normal reconnect retries |
| `conn:reconnectaggressiveinterval` | 3 | Seconds between aggressive-mode retries |
| `conn:stallautodisconnect` | true | Whether to auto-disconnect on stall at all |

### Example `connections.json`

```json
{
    "user@slow-server": {
        "conn:keepaliveinterval": 10,
        "conn:stallthreshold": 10,
        "conn:autodisconnectthreshold": 30,
        "conn:reconnecttimeout": 30,
        "conn:reconnectinterval": 30
    },
    "user@laptop-target": {
        "conn:keepaliveinterval": 2,
        "conn:stallthreshold": 2,
        "conn:autodisconnectthreshold": 3,
        "conn:reconnectinterval": 3
    }
}
```

## Changes

### 1. `pkg/wconfig/settingsconfig.go` — Add fields

Add the 7 new fields to `ConnKeywords`. Placement: after existing `ConnStall*` fields, before `Display*`.

### 2. `pkg/remote/conncontroller/connmonitor.go` — Read config + remove `degraded`

#### 2a. Config helpers

```go
func (cm *ConnMonitor) getIntConfig(key string, defaultVal int) int {
    connConfig, ok := cm.Conn.getConnectionConfig()
    if !ok {
        return defaultVal
    }
    switch key {
    case "keepaliveinterval":
        if connConfig.ConnKeepaliveIntervalSec != nil && *connConfig.ConnKeepaliveIntervalSec > 0 {
            return *connConfig.ConnKeepaliveIntervalSec
        }
    case "stallthreshold":
        if connConfig.ConnStallThresholdSec != nil && *connConfig.ConnStallThresholdSec > 0 {
            return *connConfig.ConnStallThresholdSec
        }
    case "autodisconnectthreshold":
        if connConfig.ConnAutoDisconnectThresholdSec != nil && *connConfig.ConnAutoDisconnectThresholdSec > 0 {
            return *connConfig.ConnAutoDisconnectThresholdSec
        }
    }
    return defaultVal
}
```

#### 2b. Remove `degraded` state

Delete `LastInputTime`, `isUrgent()`, and the `degraded` status constant. The `inputNotifyCh` path is kept but simplified:

```go
func (cm *ConnMonitor) keepAliveMonitor() {
    ticker := time.NewTicker(cm.getTickerInterval())
    defer ticker.Stop()

    for {
        if cm.Conn.GetClient() != cm.Client {
            return
        }
        select {
        case <-ticker.C:
            cm.checkConnection()

        case <-cm.inputNotifyCh:
            // Immediate keepalive on input, no "degraded" state
            cm.SendKeepAlive()

        case <-cm.ctx.Done():
            return
        }
    }
}
```

Note: `getTickerInterval()` should return `min(keepaliveinterval, 1)` or similar — the ticker must run at least as fast as the keepalive interval.

#### 2c. Use config in `checkConnection()`

```go
func (cm *ConnMonitor) checkConnection() {
    lastActivity := cm.LastActivityTime.Load()
    if lastActivity == 0 {
        return
    }
    timeSinceActivity := time.Now().UnixMilli() - lastActivity

    keepAliveThreshold := int64(cm.getIntConfig("keepaliveinterval", 3)) * 1000
    if timeSinceActivity > keepAliveThreshold {
        cm.SendKeepAlive()
    }

    stalledThreshold := int64(cm.getIntConfig("stallthreshold", 3)) * 1000
    timeSinceKeepAlive := cm.getTimeSinceKeepAlive()
    if timeSinceKeepAlive > stalledThreshold {
        cm.setConnHealthStatus(ConnHealthStatus_Stalled)

        stallStart := cm.StallStartTime.Load()
        now := time.Now().UnixMilli()
        if stallStart == 0 {
            cm.StallStartTime.Store(now)
        } else {
            thresholdMs := int64(cm.getIntConfig("autodisconnectthreshold", 5)) * 1000
            if now-stallStart > thresholdMs {
                cm.disconnectOnStall()
            }
        }
    } else {
        cm.StallStartTime.Store(0)
    }
}
```

#### 2d. Remove `degraded` constant

```go
const (
    ConnHealthStatus_Good    = "good"
    // ConnHealthStatus_Degraded = "degraded"  // REMOVED
    ConnHealthStatus_Stalled = "stalled"
)
```

### 3. `pkg/jobcontroller/jobcontroller.go` — Read scheduler config

Replace hardcoded constants with config-aware lookups. The scheduler gets a reference to `ConnKeywords` via the connection name.

```go
func getReconnectConfig(connName string) (timeout, interval, aggressiveInterval time.Duration) {
    connOpts, err := remote.ParseOpts(connName)
    if err != nil {
        return 5*time.Second, 5*time.Second, 3*time.Second
    }
    conn := conncontroller.MaybeGetConn(connOpts)
    if conn == nil {
        return 5*time.Second, 5*time.Second, 3*time.Second
    }
    // ... read from conn config or defaults ...
}
```

Use these in `scheduleConnectionReconnect` instead of `ConnReconnectInterval`, etc.

### 4. `pkg/remote/conncontroller/conncontroller.go` — Remove `degraded` references

Update `DeriveConnStatus()` and any code that references `ConnHealthStatus_Degraded`.

### 5. Schema & Type Updates

#### `pkg/schema/schema.go` or `schema/connections.json`

Add the new fields to the connections schema so Monaco editor validates them.

#### `frontend/types/gotypes.d.ts`

Add the new fields to the TypeScript `ConnKeywords` type.

### 6. Documentation

#### `docs/docs/connections.mdx`

Add a new "Connection Resilience Settings" subsection:

```markdown
### Connection Resilience

These settings control how aggressively Wave detects and recovers from network interruptions.

| Keyword | Default | Description |
|---------|---------|-------------|
| `conn:keepaliveinterval` | 3 | Seconds of inactivity before sending a keepalive probe. Lower = faster detection, more network traffic. |
| `conn:stallthreshold` | 3 | Seconds after keepalive before declaring the connection `stalled`. |
| `conn:autodisconnectthreshold` | 5 | Seconds of stall before forcing disconnect and starting reconnect. |
| `conn:reconnecttimeout` | 5 | Timeout for each reconnect attempt. |
| `conn:reconnectinterval` | 5 | Seconds between reconnect retries in normal mode. |
| `conn:reconnectaggressiveinterval` | 3 | Seconds between retries when the network appears unreachable. |
| `conn:stallautodisconnect` | true | Whether to auto-disconnect when stalled. Disable if you prefer manual control. |

Example for a high-latency satellite connection:
```json
{
    "user@satellite": {
        "conn:keepaliveinterval": 15,
        "conn:stallthreshold": 15,
        "conn:autodisconnectthreshold": 60,
        "conn:reconnecttimeout": 30,
        "conn:reconnectinterval": 30
    }
}
```
```

## Test Plan

| Test | Setup | Expected |
|------|-------|----------|
| Default values | No config set | Falls back to PR #1 fast defaults (3s/5s/5s) |
| Custom values | Set `conn:keepaliveinterval=10` | Monitor sends keepalive every 10s |
| `degraded` removed | Type during dead network | No `degraded` event; immediate keepalive sent instead |
| Backward compat | Existing `connections.json` without new fields | No error, defaults used |
| UI still works | PR #2 overlay with configurable intervals | Overlay countdown respects `conn:reconnectinterval` |

## Validation Checklist

- [ ] `task build:backend` succeeds
- [ ] `task build:frontend` succeeds
- [ ] `go test ./pkg/remote/conncontroller/...` passes
- [ ] `go test ./pkg/jobcontroller/...` passes
- [ ] Manual test: override one setting, verify behavior changes
- [ ] Manual test: delete all new settings, verify defaults work

## Dependencies

- **Requires PR #1**: Fast reconnect hardcoded thresholds must be in place first — this PR just makes them configurable.
- **No dependency on PR #2**: Configurable thresholds are backend-only; the overlay (PR #2) consumes whatever values are active.
