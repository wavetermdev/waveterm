# Block Controller Lifecycle

## Overview

Block controllers manage the execution lifecycle of terminal shells, commands, and other interactive processes. **The frontend drives the controller lifecycle** - the backend is reactive, creating and managing controllers in response to frontend requests.

## Controller States

Controllers have three primary states:
- **`init`** - Controller exists but process is not running
- **`running`** - Process is actively running
- **`done`** - Process has exited

## Architecture Components

### Backend: Controller Registry

Location: [`pkg/blockcontroller/blockcontroller.go`](pkg/blockcontroller/blockcontroller.go)

The backend maintains a **global controller registry** that maps blockIds to controller instances:

```go
var (
    controllerRegistry = make(map[string]Controller)
    registryLock       sync.RWMutex
)
```

Controllers implement the [`Controller` interface](pkg/blockcontroller/blockcontroller.go:64):
- `Start(ctx, blockMeta, rtOpts, force)` - Start the controller process
- `Stop(graceful, newStatus)` - Stop the controller process
- `GetRuntimeStatus()` - Get current runtime status
- `SendInput(input)` - Send input (data, signals, terminal size) to the process

### Frontend: View Model

Location: [`frontend/app/view/term/term-model.ts`](frontend/app/view/term/term-model.ts)

The [`TermViewModel`](frontend/app/view/term/term-model.ts:44) manages the frontend side of a terminal block:

**Key Atoms:**
- `shellProcFullStatus` - Holds the current controller status from backend
- `shellProcStatus` - Derived atom for just the status string ("init", "running", "done")
- `isRestarting` - UI state for restart animation

**Event Subscription:**
The constructor subscribes to controller status events (line 317-324):
```typescript
this.shellProcStatusUnsubFn = waveEventSubscribe({
    eventType: "controllerstatus",
    scope: WOS.makeORef("block", blockId),
    handler: (event) => {
        let bcRTS: BlockControllerRuntimeStatus = event.data;
        this.updateShellProcStatus(bcRTS);
    },
});
```

This creates a **reactive data flow**: backend publishes status updates → frontend receives via WebSocket events → UI updates automatically via Jotai atoms.

## Lifecycle Flow

### 1. Frontend Triggers Controller Creation/Start

**Entry Point:** [`ResyncController()`](pkg/blockcontroller/blockcontroller.go:120) RPC endpoint

The frontend calls this via [`RpcApi.ControllerResyncCommand`](frontend/app/view/term/term-model.ts:661) when:

1. **Manual Restart** - User clicks restart button or presses Enter when process is done
   - Triggered by [`forceRestartController()`](frontend/app/view/term/term-model.ts:652)
   - Passes `forcerestart: true` flag
   - Includes current terminal size (`termsize: { rows, cols }`)

2. **Connection Status Changes** - Connection becomes available/unavailable
   - Monitored by [`TermResyncHandler`](frontend/app/view/term/term.tsx:34) component
   - Watches `connStatus` atom for changes
   - Calls `termRef.current?.resyncController("resync handler")`

3. **Block Meta Changes** - Configuration like controller type or connection changes
   - Happens when block metadata is updated
   - Backend detects changes and triggers resync

### 2. Backend Processes Resync Request

The [`ResyncController()`](pkg/blockcontroller/blockcontroller.go:120) function:

```go
func ResyncController(ctx context.Context, tabId, blockId string, 
                      rtOpts *waveobj.RuntimeOpts, force bool) error
```

**Steps:**

1. **Get Block Data** - Fetch block metadata from database
2. **Determine Controller Type** - Read `controller` meta key ("shell", "cmd", "tsunami")
3. **Check Existing Controller:**
   - If controller type changed → stop old, create new
   - If connection changed (for shell/cmd) → stop and restart
   - If `force=true` → stop existing
4. **Register Controller** - Add to registry (replaces existing if present)
5. **Check if Start Needed** - If status is "init" or "done":
   - For remote connections: verify connection status first
   - Call `controller.Start(ctx, blockMeta, rtOpts, force)`
6. **Publish Status** - Controller publishes runtime status updates

**Important:** Registering a new controller automatically stops any existing controller for that blockId (line 95-98):
```go
if existingController != nil {
    existingController.Stop(false, Status_Done)
    wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
}
```

### 3. Backend Publishes Status Updates

Controllers publish their status via the event system when:
- Process starts
- Process state changes
- Process exits

The status includes:
- `shellprocstatus` - "init", "running", or "done"
- `shellprocconnname` - Connection name being used
- `shellprocexitcode` - Exit code when done
- `version` - Incrementing version number for ordering

### 4. Frontend Receives and Processes Updates

**Status Update Handler** (line 321-323):
```typescript
handler: (event) => {
    let bcRTS: BlockControllerRuntimeStatus = event.data;
    this.updateShellProcStatus(bcRTS);
}
```

**Status Update Logic** (line 430-438):
```typescript
updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
    if (fullStatus == null) return;
    const curStatus = globalStore.get(this.shellProcFullStatus);
    // Only update if newer version
    if (curStatus == null || curStatus.version < fullStatus.version) {
        globalStore.set(this.shellProcFullStatus, fullStatus);
    }
}
```

The version check ensures out-of-order events don't cause issues.

### 5. UI Updates Reactively

The UI reacts to status changes through Jotai atoms:

**Header Buttons** (line 263-306):
- Show "Play" icon when status is "init"
- Show "Refresh" icon when status is "running" or "done"
- Display exit code/status icons for cmd controller

**Restart Behavior** (line 631-635 in term.tsx via term-model.ts):
```typescript
const shellProcStatus = globalStore.get(this.shellProcStatus);
if ((shellProcStatus == "done" || shellProcStatus == "init") && 
    keyutil.checkKeyPressed(waveEvent, "Enter")) {
    this.forceRestartController();
    return false;
}
```

Pressing Enter when the process is done/init triggers a restart.

## Input Flow

**Frontend → Backend:**

When user types in terminal, data flows through [`sendDataToController()`](frontend/app/view/term/term-model.ts:408):
```typescript
sendDataToController(data: string) {
    const b64data = stringToBase64(data);
    RpcApi.ControllerInputCommand(TabRpcClient, { 
        blockid: this.blockId, 
        inputdata64: b64data 
    });
}
```

This calls the backend [`SendInput()`](pkg/blockcontroller/blockcontroller.go:260) function which forwards to the controller's `SendInput()` method.

The [`BlockInputUnion`](pkg/blockcontroller/blockcontroller.go:48) supports three types of input:
- `inputdata` - Raw terminal input bytes
- `signame` - Signal names (e.g., "SIGTERM", "SIGINT")
- `termsize` - Terminal size changes (rows/cols)

## Key Design Principles

### 1. Frontend-Driven Architecture

The frontend has full control over controller lifecycle:
- **Creates** controllers by calling ResyncController
- **Restarts** controllers via forcerestart flag
- **Monitors** status via event subscriptions
- **Sends input** via ControllerInput RPC

The backend is stateless and reactive - it doesn't make lifecycle decisions autonomously.

### 2. Idempotent Resync

`ResyncController()` is idempotent - calling it multiple times with the same state is safe:
- If controller exists and is running with correct type/connection → no-op
- If configuration changed → replaces controller
- If force flag set → always restarts

This makes it safe to call on various triggers (connection change, focus, etc.).

### 3. Versioned Status Updates

Status includes a monotonically increasing version number:
- Frontend can process events out-of-order
- Only applies updates with newer versions
- Prevents race conditions from concurrent updates

### 4. Automatic Cleanup

When a controller is replaced:
- Old controller is automatically stopped
- Runtime info is cleaned up
- Registry entry is updated atomically

The `registerController()` function handles this automatically (line 84-99).

## Common Patterns

### Restarting a Controller

```typescript
// In term-model.ts
forceRestartController() {
    this.triggerRestartAtom();  // UI feedback
    const termsize = {
        rows: this.termRef.current?.terminal?.rows,
        cols: this.termRef.current?.terminal?.cols,
    };
    RpcApi.ControllerResyncCommand(TabRpcClient, {
        tabid: globalStore.get(atoms.staticTabId),
        blockid: this.blockId,
        forcerestart: true,
        rtopts: { termsize: termsize },
    });
}
```

### Handling Connection Changes

```typescript
// In term.tsx - TermResyncHandler component
React.useEffect(() => {
    const isConnected = connStatus?.status == "connected";
    const wasConnected = lastConnStatus?.status == "connected";
    if (isConnected == wasConnected && curConnName == lastConnName) {
        return;  // No change
    }
    model.termRef.current?.resyncController("resync handler");
    setLastConnStatus(connStatus);
}, [connStatus]);
```

### Monitoring Status

```typescript
// Status is automatically available via atom
const shellProcStatus = jotai.useAtomValue(model.shellProcStatus);

// Use in UI
if (shellProcStatus == "running") {
    // Show running state
} else if (shellProcStatus == "done") {
    // Show restart button
}
```

## Summary

The block controller lifecycle is **frontend-driven and event-reactive**:

1. **Frontend triggers** controller creation/restart via `ControllerResyncCommand` RPC
2. **Backend processes** the request in `ResyncController()`, creating/starting controllers as needed
3. **Backend publishes** status updates via WebSocket events
4. **Frontend receives** status updates and updates Jotai atoms
5. **UI reacts** automatically to atom changes via React components

This architecture gives the frontend full control over when processes start/stop while keeping the backend focused on process management. The event-based status updates create a clean separation of concerns and enable real-time UI updates without polling.
