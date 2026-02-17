---
name: wps-events
description: Guide for working with Wave Terminal's WPS (Wave PubSub) event system. Use when implementing new event types, publishing events, subscribing to events, or adding asynchronous communication between components.
---

# WPS Events Guide

## Overview

WPS (Wave PubSub) is Wave Terminal's publish-subscribe event system that enables different parts of the application to communicate asynchronously. The system uses a broker pattern to route events from publishers to subscribers based on event types and scopes.

## Key Files

- `pkg/wps/wpstypes.go` - Event type constants and data structures
- `pkg/wps/wps.go` - Broker implementation and core logic
- `pkg/wcore/wcore.go` - Example usage patterns

## Event Structure

Events in WPS have the following structure:

```go
type WaveEvent struct {
    Event   string   `json:"event"`      // Event type constant
    Scopes  []string `json:"scopes,omitempty"` // Optional scopes for targeted delivery
    Sender  string   `json:"sender,omitempty"` // Optional sender identifier
    Persist int      `json:"persist,omitempty"` // Number of events to persist in history
    Data    any      `json:"data,omitempty"`    // Event payload
}
```

## Adding a New Event Type

### Step 1: Define the Event Constant

Add your event type constant to `pkg/wps/wpstypes.go`:

```go
const (
    Event_BlockClose       = "blockclose"
    Event_ConnChange       = "connchange"
    // ... other events ...
    Event_YourNewEvent     = "your:newevent"  // Use colon notation for namespacing
)
```

**Naming Convention:**

- Use descriptive PascalCase for the constant name with `Event_` prefix
- Use lowercase with colons for the string value (e.g., "namespace:eventname")
- Group related events with the same namespace prefix

### Step 2: Define Event Data Structure (Optional)

If your event carries structured data, define a type for it:

```go
type YourEventData struct {
    Field1 string `json:"field1"`
    Field2 int    `json:"field2"`
}
```

### Step 3: Expose Type to Frontend (If Needed)

If your event data type isn't already exposed via an RPC call, you need to add it to `pkg/tsgen/tsgen.go` so TypeScript types are generated:

```go
// add extra types to generate here
var ExtraTypes = []any{
    waveobj.ORef{},
    // ... other types ...
    uctypes.RateLimitInfo{},  // Example: already added
    YourEventData{},          // Add your new type here
}
```

Then run code generation:

```bash
task generate
```

This will update `frontend/types/gotypes.d.ts` with TypeScript definitions for your type, ensuring type safety in the frontend when handling these events.

## Publishing Events

### Basic Publishing

To publish an event, use the global broker:

```go
import "github.com/wavetermdev/waveterm/pkg/wps"

wps.Broker.Publish(wps.WaveEvent{
    Event: wps.Event_YourNewEvent,
    Data:  yourData,
})
```

### Publishing with Scopes

Scopes allow targeted event delivery. Subscribers can filter events by scope:

```go
wps.Broker.Publish(wps.WaveEvent{
    Event:  wps.Event_WaveObjUpdate,
    Scopes: []string{oref.String()},  // Target specific object
    Data:   updateData,
})
```

### Publishing in a Goroutine

To avoid blocking the caller, publish events asynchronously:

```go
go func() {
    wps.Broker.Publish(wps.WaveEvent{
        Event: wps.Event_YourNewEvent,
        Data:  data,
    })
}()
```

**When to use goroutines:**

- When publishing from performance-critical code paths
- When the event is informational and doesn't need immediate delivery
- When publishing from code that holds locks (to prevent deadlocks)

### Event Persistence

Events can be persisted in memory for late subscribers:

```go
wps.Broker.Publish(wps.WaveEvent{
    Event:   wps.Event_YourNewEvent,
    Persist: 100,  // Keep last 100 events
    Data:    data,
})
```

## Complete Example: Rate Limit Updates

This example shows how rate limit information is published when AI chat responses include rate limit headers.

### 1. Define the Event Type

In `pkg/wps/wpstypes.go`:

```go
const (
    // ... other events ...
    Event_WaveAIRateLimit  = "waveai:ratelimit"
)
```

### 2. Publish the Event

In `pkg/aiusechat/usechat.go`:

```go
import "github.com/wavetermdev/waveterm/pkg/wps"

func updateRateLimit(info *uctypes.RateLimitInfo) {
    if info == nil {
        return
    }
    rateLimitLock.Lock()
    defer rateLimitLock.Unlock()
    globalRateLimitInfo = info

    // Publish event in goroutine to avoid blocking
    go func() {
        wps.Broker.Publish(wps.WaveEvent{
            Event: wps.Event_WaveAIRateLimit,
            Data:  info,  // RateLimitInfo struct
        })
    }()
}
```

### 3. Subscribe to the Event (Frontend)

In the frontend, subscribe to events via WebSocket:

```typescript
// Subscribe to rate limit updates
const subscription = {
  event: "waveai:ratelimit",
  allscopes: true, // Receive all rate limit events
};
```

## Subscribing to Events

### From Go Code

```go
// Subscribe to all events of a type
wps.Broker.Subscribe(routeId, wps.SubscriptionRequest{
    Event:     wps.Event_YourNewEvent,
    AllScopes: true,
})

// Subscribe to specific scopes
wps.Broker.Subscribe(routeId, wps.SubscriptionRequest{
    Event:  wps.Event_WaveObjUpdate,
    Scopes: []string{"workspace:123"},
})

// Unsubscribe
wps.Broker.Unsubscribe(routeId, wps.Event_YourNewEvent)
```

### Scope Matching

Scopes support wildcard matching:

- `*` matches a single scope segment
- `**` matches multiple scope segments

```go
// Subscribe to all workspace events
wps.Broker.Subscribe(routeId, wps.SubscriptionRequest{
    Event:  wps.Event_WaveObjUpdate,
    Scopes: []string{"workspace:*"},
})
```

## Best Practices

1. **Use Namespaces**: Prefix event names with a namespace (e.g., `waveai:`, `workspace:`, `block:`)

2. **Don't Block**: Use goroutines when publishing from performance-critical code or while holding locks

3. **Type-Safe Data**: Define struct types for event data rather than using maps

4. **Scope Wisely**: Use scopes to limit event delivery and reduce unnecessary processing

5. **Document Events**: Add comments explaining when events are fired and what data they carry

6. **Consider Persistence**: Use `Persist` for events that late subscribers might need (like status updates). This is normally not used. We normally do a live RPC call to get the current value and then subscribe for updates.

## Common Event Patterns

### Status Updates

```go
wps.Broker.Publish(wps.WaveEvent{
    Event:   wps.Event_ControllerStatus,
    Scopes:  []string{blockId},
    Persist: 1,  // Keep only latest status
    Data:    statusData,
})
```

### Object Updates

```go
wps.Broker.Publish(wps.WaveEvent{
    Event:  wps.Event_WaveObjUpdate,
    Scopes: []string{oref.String()},
    Data: waveobj.WaveObjUpdate{
        UpdateType: waveobj.UpdateType_Update,
        OType:      obj.GetOType(),
        OID:        waveobj.GetOID(obj),
        Obj:        obj,
    },
})
```

### Batch Updates

```go
// Helper function for multiple updates
func (b *BrokerType) SendUpdateEvents(updates waveobj.UpdatesRtnType) {
    for _, update := range updates {
        b.Publish(WaveEvent{
            Event:  Event_WaveObjUpdate,
            Scopes: []string{waveobj.MakeORef(update.OType, update.OID).String()},
            Data:   update,
        })
    }
}
```

## Debugging

To debug event flow:

1. Check broker subscription map: `wps.Broker.SubMap`
2. View persisted events: `wps.Broker.ReadEventHistory(eventType, scope, maxItems)`
3. Add logging in publish/subscribe methods
4. Monitor WebSocket traffic in browser dev tools

## Quick Reference

When adding a new event:

- [ ] Add event constant to `pkg/wps/wpstypes.go`
- [ ] Define event data structure (if needed)
- [ ] Add data type to `pkg/tsgen/tsgen.go` for frontend use
- [ ] Run `task generate` to update TypeScript types
- [ ] Publish events using `wps.Broker.Publish()`
- [ ] Use goroutines for non-blocking publish when appropriate
- [ ] Subscribe to events in relevant components
