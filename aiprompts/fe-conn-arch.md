# Wave Terminal Frontend Connection Architecture

## Overview

The frontend connection architecture provides a reactive interface for managing and interacting with connections (local, SSH, WSL, S3). It follows a unidirectional data flow pattern where the backend manages connection state, the frontend observes this state through Jotai atoms, and user interactions trigger backend operations via RPC commands.

## Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                            │
│  - ConnectionButton (displays status)                           │
│  - ChangeConnectionBlockModal (connection picker)               │
│  - ConnStatusOverlay (error states)                             │
└─────────────────────────────────────────────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                      Jotai Reactive State                        │
│  - ConnStatusMapAtom (connection statuses)                      │
│  - View Model Atoms (derived connection state)                  │
│  - Block Metadata (connection selection)                        │
└─────────────────────────────────────────────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                         RPC Commands                             │
│  - ConnListCommand (list connections)                           │
│  - ConnEnsureCommand (ensure connected)                         │
│  - ConnConnectCommand/ConnDisconnectCommand                     │
│  - SetMetaCommand (change block connection)                     │
│  - ControllerInputCommand (send data to shell)                  │
└─────────────────────────────────────────────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (see conn-arch.md)                    │
│  - Connection Controllers (SSHConn, WslConn)                    │
│  - Block Controllers (ShellController)                          │
│  - Shell Process Execution                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Connection State Management ([`frontend/app/store/global.ts`](../frontend/app/store/global.ts))

**ConnStatusMapAtom**
```typescript
const ConnStatusMapAtom = atom(new Map<string, PrimitiveAtom<ConnStatus>>())
```

- Global registry of connection status atoms
- One atom per connection (keyed by connection name)
- Backend updates status via wave events
- Frontend components subscribe to individual connection atoms

**getConnStatusAtom()**
```typescript
function getConnStatusAtom(connName: string): PrimitiveAtom<ConnStatus>
```

- Retrieves or creates status atom for a connection
- Returns cached atom if exists
- Creates new atom initialized to default if needed
- Used by view models to track their connection

**ConnStatus Structure**
```typescript
interface ConnStatus {
    status: "init" | "connecting" | "connected" | "disconnected" | "error"
    connection: string           // Connection name
    connected: boolean           // Is currently connected
    activeconnnum: number        // Color assignment number (1-8)
    wshenabled: boolean         // WSH available on this connection
    error?: string              // Error message if status is "error"
    wsherror?: string           // WSH-specific error
}
```

**allConnStatusAtom**
```typescript
const allConnStatusAtom = atom<ConnStatus[]>((get) => {
    const connStatusMap = get(ConnStatusMapAtom)
    const connStatuses = Array.from(connStatusMap.values()).map((atom) => get(atom))
    return connStatuses
})
```

- Provides array of all connection statuses
- Used by connection modal to display all available connections
- Automatically updates when any connection status changes

### 2. Connection Button UI ([`frontend/app/block/blockutil.tsx`](../frontend/app/block/blockutil.tsx))

**ConnectionButton Component**

```typescript
export const ConnectionButton = React.memo(
    React.forwardRef<HTMLDivElement, ConnectionButtonProps>(
        ({ connection, changeConnModalAtom }, ref) => {
            const connStatusAtom = getConnStatusAtom(connection)
            const connStatus = jotai.useAtomValue(connStatusAtom)
            // ... renders connection status with colored icon
        }
    )
)
```

**Responsibilities:**
- Displays connection name and status icon
- Color-codes connections (8 colors, cycling)
- Shows visual states:
  - **Local**: Laptop icon (grey)
  - **Connecting**: Animated dots (yellow/warning)
  - **Connected**: Arrow icon (colored by activeconnnum)
  - **Error**: Slashed arrow icon (red)
  - **Disconnected**: Slashed arrow icon (grey)
- Opens connection modal on click

**Color Assignment:**
```typescript
function computeConnColorNum(connStatus: ConnStatus): number {
    const connColorNum = (connStatus?.activeconnnum ?? 1) % NumActiveConnColors
    return connColorNum == 0 ? NumActiveConnColors : connColorNum
}
```

- Backend assigns `activeconnnum` sequentially
- Frontend cycles through 8 CSS color variables
- `var(--conn-icon-color-1)` through `var(--conn-icon-color-8)`

### 3. Connection Selection Modal ([`frontend/app/modals/conntypeahead.tsx`](../frontend/app/modals/conntypeahead.tsx))

**ChangeConnectionBlockModal Component**

**Data Fetching:**
```typescript
useEffect(() => {
    if (!changeConnModalOpen) return
    
    // Fetch available connections
    RpcApi.ConnListCommand(TabRpcClient, { timeout: 2000 })
        .then(setConnList)
    
    RpcApi.WslListCommand(TabRpcClient, { timeout: 2000 })
        .then(setWslList)
    
    RpcApi.ConnListAWSCommand(TabRpcClient, { timeout: 2000 })
        .then(setS3List)
}, [changeConnModalOpen])
```

**Connection Change Handler:**
```typescript
const changeConnection = async (connName: string) => {
    // Update block metadata with new connection
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("block", blockId),
        meta: { 
            connection: connName,
            file: newFile,        // Reset file path for new connection
            "cmd:cwd": null      // Clear working directory
        }
    })
    
    // Ensure connection is established
    await RpcApi.ConnEnsureCommand(TabRpcClient, {
        connname: connName,
        logblockid: blockId
    }, { timeout: 60000 })
}
```

**Suggestion Categories:**
1. **Local Connections**
   - Local machine (`""` or `"local:"`)
   - Git Bash (Windows only: `"local:gitbash"`)
   - WSL distros (`"wsl://Ubuntu"`, etc.)

2. **Remote Connections** (SSH)
   - User-configured SSH connections
   - Format: `"user@host"` or `"user@host:port"`
   - Filtered by `display:hidden` config

3. **S3 Connections** (optional)
   - AWS S3 profiles
   - Format: `"aws:profile-name"`

4. **Actions**
   - Reconnect (if disconnected/error)
   - Disconnect (if connected)
   - Edit Connections (opens config editor)
   - New Connection (creates new SSH config)

**Filtering Logic:**
```typescript
function filterConnections(
    connList: Array<string>,
    connSelected: string,
    fullConfig: FullConfigType,
    filterOutNowsh: boolean
): Array<string> {
    const connectionsConfig = fullConfig.connections
    return connList.filter((conn) => {
        const hidden = connectionsConfig?.[conn]?.["display:hidden"] ?? false
        const wshEnabled = connectionsConfig?.[conn]?.["conn:wshenabled"] ?? true
        return conn.includes(connSelected) && 
               !hidden && 
               (wshEnabled || !filterOutNowsh)
    })
}
```

### 4. Connection Status Overlay ([`frontend/app/block/blockframe.tsx`](../frontend/app/block/blockframe.tsx))

**ConnStatusOverlay Component**

Displays over block content when:
- Connection is disconnected or in error state
- WSH installation/update errors occur
- Not in layout mode (Ctrl+Shift held)
- Connection modal is not open

**Features:**
- Shows connection status text
- Displays error messages (scrollable)
- Reconnect button (for disconnected/error)
- "Always disable wsh" button (for WSH errors)
- Adaptive layout based on width

**Handlers:**
```typescript
// Reconnect to failed connection
const handleTryReconnect = () => {
    RpcApi.ConnConnectCommand(TabRpcClient, {
        host: connName,
        logblockid: nodeModel.blockId
    }, { timeout: 60000 })
}

// Disable WSH for this connection
const handleDisableWsh = async () => {
    await RpcApi.SetConnectionsConfigCommand(TabRpcClient, {
        host: connName,
        metamaptype: { "conn:wshenabled": false }
    })
}
```

### 5. View Model Integration

View models integrate connection state into their reactive data flow:

#### Terminal View Model ([`frontend/app/view/term/term-model.ts`](../frontend/app/view/term/term-model.ts))

```typescript
class TermViewModel implements ViewModel {
    // Connection management flag
    manageConnection = atom((get) => {
        const termMode = get(this.termMode)
        if (termMode == "vdom") return false  // VDOM mode doesn't show conn button
        
        const isCmd = get(this.isCmdController)
        if (isCmd) return false  // Cmd controller doesn't manage connections
        
        return true  // Standard terminals show connection button
    })
    
    // Connection status for this block
    connStatus = atom((get) => {
        const blockData = get(this.blockAtom)
        const connName = blockData?.meta?.connection
        const connAtom = getConnStatusAtom(connName)
        return get(connAtom)
    })
    
    // Filter connections without WSH
    filterOutNowsh = atom(false)
}
```

**End Icon Button Logic:**
```typescript
endIconButtons = atom((get) => {
    const connStatus = get(this.connStatus)
    const shellProcStatus = get(this.shellProcStatus)
    
    // Only show restart button if connected
    if (connStatus?.status != "connected") {
        return []
    }
    
    // Show appropriate icon based on shell state
    if (shellProcStatus == "init") {
        return [{ icon: "play", title: "Click to Start Shell" }]
    } else if (shellProcStatus == "running") {
        return [{ icon: "refresh", title: "Shell Running. Click to Restart" }]
    } else if (shellProcStatus == "done") {
        return [{ icon: "refresh", title: "Shell Exited. Click to Restart" }]
    }
})
```

#### Preview View Model ([`frontend/app/view/preview/preview-model.tsx`](../frontend/app/view/preview/preview-model.tsx))

```typescript
class PreviewModel implements ViewModel {
    // Always manages connection
    manageConnection = atom(true)
    
    // Connection status
    connStatus = atom((get) => {
        const blockData = get(this.blockAtom)
        const connName = blockData?.meta?.connection
        const connAtom = getConnStatusAtom(connName)
        return get(connAtom)
    })
    
    // Filter out connections without WSH (file ops require WSH)
    filterOutNowsh = atom(true)
    
    // Ensure connection before operations
    connection = atom<Promise<string>>(async (get) => {
        const connName = get(this.blockAtom)?.meta?.connection
        try {
            await RpcApi.ConnEnsureCommand(TabRpcClient, {
                connname: connName
            }, { timeout: 60000 })
            globalStore.set(this.connectionError, "")
        } catch (e) {
            globalStore.set(this.connectionError, e as string)
        }
        return connName
    })
}
```

**File Operations Over Connection:**
```typescript
// Reads file from remote/local connection
statFile = atom<Promise<FileInfo>>(async (get) => {
    const fileName = get(this.metaFilePath)
    const path = await this.formatRemoteUri(fileName, get)
    
    return await RpcApi.FileInfoCommand(TabRpcClient, {
        info: { path }
    })
})

fullFile = atom<Promise<FileData>>(async (get) => {
    const fileName = get(this.metaFilePath)
    const path = await this.formatRemoteUri(fileName, get)
    
    return await RpcApi.FileReadCommand(TabRpcClient, {
        info: { path }
    })
})
```

### 6. Block Controller Integration

**View models do NOT directly manage shell processes.** They interact with block controllers via RPC:

**Starting a Shell:**
```typescript
// User clicks restart button in terminal
forceRestartController() {
    // Backend handles connection verification and process startup
    RpcApi.ControllerRestartCommand(TabRpcClient, {
        blockid: this.blockId,
        force: true
    })
}
```

**Sending Input to Shell:**
```typescript
sendDataToController(data: string) {
    const b64data = stringToBase64(data)
    RpcApi.ControllerInputCommand(TabRpcClient, {
        blockid: this.blockId,
        inputdata64: b64data
    })
}
```

**Backend Block Controller Flow:**
1. Frontend calls `ControllerRestartCommand`
2. Backend `ShellController.Run()` starts
3. `CheckConnStatus()` verifies connection is ready
4. If not connected, triggers connection attempt
5. Once connected, `setupAndStartShellProcess()`
6. `getConnUnion()` retrieves appropriate connection (Local/SSH/WSL)
7. `StartLocalShellProc()`, `StartRemoteShellProc()`, or `StartWslShellProc()`
8. Process I/O managed by `manageRunningShellProcess()`

## Connection Configuration

### Hierarchical Configuration System

Wave uses a three-level config hierarchy for connections:

1. **Global Settings** (`settings`)
2. **Connection-Level Config** (`connections[connName]`)
3. **Block-Level Overrides** (`block.meta`)

**Override Resolution:**
```typescript
function getOverrideConfigAtom<T>(blockId: string, key: T): Atom<T> {
    return atom((get) => {
        // 1. Check block metadata
        const metaKeyVal = get(getBlockMetaKeyAtom(blockId, key))
        if (metaKeyVal != null) return metaKeyVal
        
        // 2. Check connection config
        const connName = get(getBlockMetaKeyAtom(blockId, "connection"))
        const connConfigKeyVal = get(getConnConfigKeyAtom(connName, key))
        if (connConfigKeyVal != null) return connConfigKeyVal
        
        // 3. Fall back to global settings
        const settingsVal = get(getSettingsKeyAtom(key))
        return settingsVal ?? null
    })
}
```

### Common Connection Settings

**Connection Keywords** (apply to specific connections):
- `conn:wshenabled` - Enable/disable WSH for this connection
- `conn:wshpath` - Custom WSH binary path
- `display:hidden` - Hide connection from selector
- `display:order` - Sort order in connection list
- `term:fontsize` - Font size for terminals on this connection
- `term:theme` - Color theme for terminals on this connection

**Example Usage in View Models:**
```typescript
// Font size with connection override
fontSizeAtom = atom((get) => {
    const blockData = get(this.blockAtom)
    const connName = blockData?.meta?.connection
    const fullConfig = get(atoms.fullConfigAtom)
    
    // Check: block meta > connection config > global settings
    const fontSize = blockData?.meta?.["term:fontsize"] ??
                     fullConfig?.connections?.[connName]?.["term:fontsize"] ??
                     get(getSettingsKeyAtom("term:fontsize")) ??
                     12
    
    return boundNumber(fontSize, 4, 64)
})
```

## RPC Interface

### Connection Management Commands

**ConnListCommand**
```typescript
ConnListCommand(client: RpcClient): Promise<string[]>
```
- Returns list of configured SSH connection names
- Used by connection modal to populate remote connections
- Filters by `display:hidden` config on frontend

**WslListCommand**
```typescript
WslListCommand(client: RpcClient): Promise<string[]>
```
- Returns list of installed WSL distribution names
- Windows only (silently fails on other platforms)
- Connection names formatted as `wsl://[distro]`

**ConnListAWSCommand**
```typescript
ConnListAWSCommand(client: RpcClient): Promise<string[]>
```
- Returns list of AWS profile names from config
- Used for S3 preview connections
- Connection names formatted as `aws:[profile]`

**ConnEnsureCommand**
```typescript
ConnEnsureCommand(
    client: RpcClient,
    data: { connname: string, logblockid?: string }
): Promise<void>
```
- Ensures connection is in "connected" state
- Triggers connection if not already connected
- Waits for connection to complete or timeout
- Used before file operations and by view models

**ConnConnectCommand**
```typescript
ConnConnectCommand(
    client: RpcClient,
    data: { host: string, logblockid?: string }
): Promise<void>
```
- Explicitly connects to specified connection
- Used by "Reconnect" action in overlay
- Returns when connection succeeds or fails

**ConnDisconnectCommand**
```typescript
ConnDisconnectCommand(
    client: RpcClient,
    connName: string
): Promise<void>
```
- Disconnects active connection
- Used by "Disconnect" action in connection modal
- Closes all shells/processes on that connection

**SetMetaCommand**
```typescript
SetMetaCommand(
    client: RpcClient,
    data: {
        oref: string,           // WaveObject reference
        meta: MetaType          // Metadata updates
    }
): Promise<void>
```
- Updates block metadata (including connection)
- Used when changing block's connection
- Triggers backend to switch connection context

**SetConnectionsConfigCommand**
```typescript
SetConnectionsConfigCommand(
    client: RpcClient,
    data: {
        host: string,           // Connection name
        metamaptype: any        // Config updates
    }
): Promise<void>
```
- Updates connection-level configuration
- Used to disable WSH (`conn:wshenabled: false`)
- Persists to config file

### File Operations (Connection-Aware)

**FileInfoCommand**
```typescript
FileInfoCommand(
    client: RpcClient,
    data: { info: { path: string } }
): Promise<FileInfo>
```
- Gets file metadata (size, type, permissions, etc.)
- Path format: `[connName]:[filepath]` (e.g., `user@host:~/file.txt`)
- Uses connection's WSH for remote files

**FileReadCommand**
```typescript
FileReadCommand(
    client: RpcClient,
    data: { info: { path: string } }
): Promise<FileData>
```
- Reads file content as base64
- Supports streaming for large files
- Remote files read via connection's WSH

### Controller Commands (Indirect Connection Usage)

**ControllerInputCommand**
```typescript
ControllerInputCommand(
    client: RpcClient,
    data: { blockid: string, inputdata64: string }
): Promise<void>
```
- Sends input to block's controller (shell)
- Controller uses block's connection for execution
- Base64-encoded to handle binary data

**ControllerRestartCommand**
```typescript
ControllerRestartCommand(
    client: RpcClient,
    data: { blockid: string, force?: boolean }
): Promise<void>
```
- Restarts block's controller
- Backend checks connection status before starting
- If not connected, triggers connection first

## Event-Driven Updates

### Wave Event Subscriptions

**Connection Status Updates:**
```typescript
waveEventSubscribe({
    eventType: "connstatus",
    handler: (event) => {
        const status: ConnStatus = event.data
        updateConnStatusAtom(status.connection, status)
    }
})
```
- Backend emits connection status changes
- Frontend updates corresponding atom
- All subscribed components re-render automatically

**Configuration Updates:**
```typescript
waveEventSubscribe({
    eventType: "config",
    handler: (event) => {
        const fullConfig = event.data.fullconfig
        globalStore.set(atoms.fullConfigAtom, fullConfig)
    }
})
```
- Backend watches config files for changes
- Pushes updates to all connected frontends
- Connection configuration changes take effect immediately

## Data Flow Patterns

### Pattern 1: Changing Block Connection

```
User Action: Click connection button → select new connection
                        ↓
          ChangeConnectionBlockModal.changeConnection()
                        ↓
              RpcApi.SetMetaCommand({ connection: newConn })
                        ↓
         Backend updates block metadata → emits waveobj:update
                        ↓
              Frontend WOS updates blockAtom
                        ↓
          View model connStatus atom recomputes
                        ↓
           ConnectionButton re-renders with new connection
                        ↓
         RpcApi.ConnEnsureCommand() ensures connected
                        ↓
        Backend triggers connection if needed
                        ↓
      Backend emits connstatus events as connection progresses
                        ↓
    Frontend updates ConnStatus atom ("connecting" → "connected")
                        ↓
         ConnectionButton shows connecting animation → connected state
```

### Pattern 2: Shell Process Lifecycle

```
User Action: Press Enter in disconnected terminal
                        ↓
    View model detects shellProcStatus == "init" or "done"
                        ↓
          forceRestartController() called
                        ↓
        RpcApi.ControllerRestartCommand()
                        ↓
    Backend ShellController.Run() starts
                        ↓
         CheckConnStatus() verifies connection
                        ↓
        If not connected: trigger connection
                        ↓
   (Frontend shows ConnStatusOverlay with "connecting")
                        ↓
         Connection succeeds → WSH available
                        ↓
       setupAndStartShellProcess()
                        ↓
  StartRemoteShellProc() with connection's SSH client
                        ↓
   Backend emits controllerstatus event
                        ↓
      Frontend updates shellProcStatus atom
                        ↓
  View model endIconButtons recomputes (restart button)
                        ↓
       Terminal ready for input
```

### Pattern 3: File Preview Over Connection

```
User Action: Open preview block with file path
                        ↓
     PreviewModel initialized with file path
                        ↓
         connection atom ensures connection
                        ↓
     RpcApi.ConnEnsureCommand(connName)
                        ↓
  Backend establishes connection if needed
                        ↓
  (Frontend shows ConnStatusOverlay if connecting)
                        ↓
         Connection ready
                        ↓
     statFile atom triggers FileInfoCommand
                        ↓
      Backend routes to connection's WSH
                        ↓
     WSH executes stat on remote file
                        ↓
        FileInfo returned to frontend
                        ↓
   PreviewModel determines if text/binary/streaming
                        ↓
    fullFile atom triggers FileReadCommand
                        ↓
      Backend streams file via WSH
                        ↓
     File content displayed in preview
```

## Connection Types and Behaviors

### Local Connection

**Connection Names:**
- `""` (empty string)
- `"local"`
- `"local:"`
- `"local:gitbash"` (Windows only)

**Frontend Behavior:**
- No connection modal interaction needed
- ConnectionButton shows laptop icon (grey)
- No ConnStatusOverlay shown (always "connected")
- File paths used directly without connection prefix
- Shell processes spawn locally via `os/exec`

**View Model Configuration:**
```typescript
connName = "" // or "local" or "local:gitbash"
connStatus = {
    status: "connected",
    connection: "",
    connected: true,
    activeconnnum: 0,  // No color assignment
    wshenabled: true   // Local WSH always available
}
```

### SSH Connection

**Connection Names:**
- Format: `"user@host"`, `"user@host:port"`, or config name
- Examples: `"ubuntu@192.168.1.10"`, `"myserver"`, `"deploy@prod:2222"`

**Frontend Behavior:**
- ConnectionButton shows arrow icon with color
- Color cycles through 8 colors based on `activeconnnum`
- ConnStatusOverlay shown during connecting/error states
- File paths prefixed with connection: `user@host:~/file.txt`
- Modal allows reconnect/disconnect actions

**Connection States:**
```typescript
// Connecting
connStatus = {
    status: "connecting",
    connection: "user@host",
    connected: false,
    activeconnnum: 3,
    wshenabled: false  // Not yet determined
}

// Connected with WSH
connStatus = {
    status: "connected", 
    connection: "user@host",
    connected: true,
    activeconnnum: 3,
    wshenabled: true
}

// Connected without WSH
connStatus = {
    status: "connected",
    connection: "user@host",
    connected: true,
    activeconnnum: 3,
    wshenabled: false,
    wsherror: "wsh installation failed: permission denied"
}

// Error
connStatus = {
    status: "error",
    connection: "user@host",
    connected: false,
    activeconnnum: 3,
    wshenabled: false,
    error: "ssh: connection refused"
}
```

**WSH Errors:**
- Shown in ConnStatusOverlay
- "always disable wsh" button sets `conn:wshenabled: false`
- Terminal still works without WSH (limited features)
- Preview requires WSH (shows error if unavailable)

### WSL Connection

**Connection Names:**
- Format: `"wsl://[distro]"`
- Examples: `"wsl://Ubuntu"`, `"wsl://Debian"`, `"wsl://Ubuntu-20.04"`

**Frontend Behavior:**
- Similar to SSH (colored arrow icon)
- Listed under "Local" section in modal
- No authentication prompts
- File paths: `wsl://Ubuntu:~/file.txt`

**Backend Differences:**
- Uses `wsl.exe` instead of SSH
- No network overhead
- Predetermined domain socket path
- Simpler error handling

### S3 Connection (Preview Only)

**Connection Names:**
- Format: `"aws:[profile]"`
- Examples: `"aws:default"`, `"aws:production"`

**Frontend Behavior:**
- Database icon (accent color)
- Only available in Preview view
- No shell/terminal support
- File paths: `aws:profile:/bucket/key`

**View Model Settings:**
```typescript
// Terminal: S3 not shown
showS3 = atom(false)

// Preview: S3 shown
showS3 = atom(true)
```

## Error Handling

### Connection Errors

**Authentication Failures:**
- Backend prompts for credentials via `userinput` events
- Frontend shows UserInputModal
- User enters password/passphrase
- Connection retries automatically

**Network Errors:**
- ConnStatus.status becomes "error"
- ConnStatus.error contains message
- ConnStatusOverlay displays error
- "Reconnect" button triggers `ConnConnectCommand`

**WSH Installation Errors:**
- ConnStatus.wsherror contains message
- ConnStatusOverlay shows separate WSH error section
- Options:
  - Dismiss error (temporary)
  - "always disable wsh" (permanent config change)

### View Model Error Handling

**Terminal View:**
```typescript
// Shell won't start if connection failed
endIconButtons = atom((get) => {
    const connStatus = get(this.connStatus)
    if (connStatus?.status != "connected") {
        return []  // Hide restart button
    }
    // ... show restart button
})

// ConnStatusOverlay blocks terminal interaction
```

**Preview View:**
```typescript
// File operations return errors
errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg>

statFile = atom(async (get) => {
    try {
        const fileInfo = await RpcApi.FileInfoCommand(...)
        return fileInfo
    } catch (e) {
        globalStore.set(this.errorMsgAtom, {
            status: "File Read Failed",
            text: `${e}`
        })
        throw e
    }
})

// Error displayed in preview content area
```

## Best Practices

### For View Model Authors

1. **Use Connection Atoms:**
   ```typescript
   connStatus = atom((get) => {
       const blockData = get(this.blockAtom)
       const connName = blockData?.meta?.connection
       return get(getConnStatusAtom(connName))
   })
   ```

2. **Check Connection Before Operations:**
   ```typescript
   if (connStatus?.status != "connected") {
       return // Don't attempt operation
   }
   ```

3. **Use ConnEnsureCommand for File Ops:**
   ```typescript
   await RpcApi.ConnEnsureCommand(TabRpcClient, {
       connname: connName,
       logblockid: blockId  // For better logging
   }, { timeout: 60000 })
   ```

4. **Set manageConnection Appropriately:**
   ```typescript
   // Show connection button for views that need connections
   manageConnection = atom(true)
   
   // Hide for views that don't use connections
   manageConnection = atom(false)
   ```

5. **Use filterOutNowsh for WSH Requirements:**
   ```typescript
   // Filter connections without WSH (file ops, etc.)
   filterOutNowsh = atom(true)
   
   // Allow all connections (basic shell)
   filterOutNowsh = atom(false)
   ```

### For RPC Command Usage

1. **Always Handle Errors:**
   ```typescript
   try {
       await RpcApi.ConnConnectCommand(...)
   } catch (e) {
       console.error("Connection failed:", e)
       // Update UI to show error
   }
   ```

2. **Use Appropriate Timeouts:**
   ```typescript
   // Connection operations: longer timeout
   { timeout: 60000 }  // 60 seconds
   
   // List operations: shorter timeout
   { timeout: 2000 }   // 2 seconds
   ```

3. **Batch Related Operations:**
   ```typescript
   // Good: Single SetMetaCommand with all changes
   await RpcApi.SetMetaCommand(TabRpcClient, {
       oref: blockRef,
       meta: {
           connection: newConn,
           file: newPath,
           "cmd:cwd": null
       }
   })
   
   // Bad: Multiple SetMetaCommand calls
   ```

## Summary

The frontend connection architecture is **reactive and declarative**:

1. **Backend owns connection state** - All connection management happens in Go
2. **Frontend observes state** - Jotai atoms mirror backend state
3. **User actions trigger backend** - RPC commands initiate backend operations
4. **Events flow back to frontend** - Backend pushes updates via wave events
5. **View models isolate concerns** - Each view manages its own connection needs
6. **Block controllers bridge the gap** - Backend controllers use connections for process execution

This architecture ensures:
- **Consistency** - Single source of truth (backend)
- **Reactivity** - UI updates automatically with state changes
- **Separation** - Frontend doesn't manage connection lifecycle
- **Flexibility** - Views can easily add connection support
- **Robustness** - Errors handled at appropriate layers