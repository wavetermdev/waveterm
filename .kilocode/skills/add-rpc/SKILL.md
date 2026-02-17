---
name: add-rpc
description: Guide for adding new RPC calls to Wave Terminal. Use when implementing new RPC commands, adding server-client communication methods, or extending the RPC interface with new functionality.
---

# Adding RPC Calls Guide

## Overview

Wave Terminal uses a WebSocket-based RPC (Remote Procedure Call) system for communication between different components. The RPC system allows the frontend, backend, electron main process, remote servers, and terminal blocks to communicate with each other through well-defined commands.

This guide covers how to add a new RPC command to the system.

## Key Files

- `pkg/wshrpc/wshrpctypes.go` - RPC interface and type definitions
- `pkg/wshrpc/wshserver/wshserver.go` - Main server implementation (most common)
- `emain/emain-wsh.ts` - Electron main process implementation
- `frontend/app/store/tabrpcclient.ts` - Frontend tab implementation
- `pkg/wshrpc/wshremote/wshremote.go` - Remote server implementation
- `frontend/app/view/term/term-wsh.tsx` - Terminal block implementation

## RPC Command Structure

RPC commands in Wave Terminal follow these conventions:

- **Method names** must end with `Command`
- **First parameter** must be `context.Context`
- **Second parameter** (optional) is the command data structure
- **Return values** can be either just an error, or one return value plus an error
- **Streaming commands** return a channel instead of a direct value

## Adding a New RPC Call

### Step 1: Define the Command in the Interface

Add your command to the `WshRpcInterface` in `pkg/wshrpc/wshrpctypes.go`:

```go
type WshRpcInterface interface {
    // ... existing commands ...
    
    // Add your new command
    YourNewCommand(ctx context.Context, data CommandYourNewData) (*YourNewResponse, error)
}
```

**Method Signature Rules:**

- Method name must end with `Command`
- First parameter must be `ctx context.Context`
- Optional second parameter for input data
- Return either `error` or `(ReturnType, error)`
- For streaming, return `chan RespOrErrorUnion[T]`

### Step 2: Define Request and Response Types

If your command needs structured input or output, define types in the same file:

```go
type CommandYourNewData struct {
    FieldOne   string `json:"fieldone"`
    FieldTwo   int    `json:"fieldtwo"`
    SomeId     string `json:"someid"`
}

type YourNewResponse struct {
    ResultField string `json:"resultfield"`
    Success     bool   `json:"success"`
}
```

**Type Naming Conventions:**

- Request types: `Command[Name]Data` (e.g., `CommandGetMetaData`)
- Response types: `[Name]Response` or `Command[Name]RtnData` (e.g., `CommandResolveIdsRtnData`)
- Use `json` struct tags with lowercase field names
- Follow existing patterns in the file for consistency

### Step 3: Generate Bindings

After modifying `pkg/wshrpc/wshrpctypes.go`, run code generation to create TypeScript bindings and Go helper code:

```bash
task generate
```

This command will:
- Generate TypeScript type definitions in `frontend/types/gotypes.d.ts`
- Create RPC client bindings
- Update routing code

**Note:** If generation fails, check that your method signature follows all the rules above.

### Step 4: Implement the Command

Choose where to implement your command based on what it needs to do:

#### A. Main Server Implementation (Most Common)

Implement in `pkg/wshrpc/wshserver/wshserver.go`:

```go
func (ws *WshServer) YourNewCommand(ctx context.Context, data wshrpc.CommandYourNewData) (*wshrpc.YourNewResponse, error) {
    // Validate input
    if data.SomeId == "" {
        return nil, fmt.Errorf("someid is required")
    }
    
    // Implement your logic
    result := doSomething(data)
    
    // Return response
    return &wshrpc.YourNewResponse{
        ResultField: result,
        Success:     true,
    }, nil
}
```

**Use main server when:**
- Accessing the database
- Managing blocks, tabs, or workspaces
- Coordinating between components
- Handling file operations on the main filesystem

#### B. Electron Implementation

Implement in `emain/emain-wsh.ts`:

```typescript
async handle_yournew(rh: RpcResponseHelper, data: CommandYourNewData): Promise<YourNewResponse> {
    // Electron-specific logic
    const result = await electronAPI.doSomething(data);
    
    return {
        resultfield: result,
        success: true,
    };
}
```

**Use Electron when:**
- Accessing native OS features
- Managing application windows
- Using Electron APIs (notifications, system tray, etc.)
- Handling encryption/decryption with safeStorage

#### C. Frontend Tab Implementation

Implement in `frontend/app/store/tabrpcclient.ts`:

```typescript
async handle_yournew(rh: RpcResponseHelper, data: CommandYourNewData): Promise<YourNewResponse> {
    // Access frontend state/models
    const layoutModel = getLayoutModelForStaticTab();
    
    // Implement tab-specific logic
    const result = layoutModel.doSomething(data);
    
    return {
        resultfield: result,
        success: true,
    };
}
```

**Use tab client when:**
- Accessing React state or Jotai atoms
- Manipulating UI layout
- Capturing screenshots
- Reading frontend-only data

#### D. Remote Server Implementation

Implement in `pkg/wshrpc/wshremote/wshremote.go`:

```go
func (impl *ServerImpl) RemoteYourNewCommand(ctx context.Context, data wshrpc.CommandRemoteYourNewData) (*wshrpc.YourNewResponse, error) {
    // Remote filesystem or process operations
    result, err := performRemoteOperation(data)
    if err != nil {
        return nil, fmt.Errorf("remote operation failed: %w", err)
    }
    
    return &wshrpc.YourNewResponse{
        ResultField: result,
        Success:     true,
    }, nil
}
```

**Use remote server when:**
- Operating on remote filesystems
- Executing commands on remote hosts
- Managing remote processes
- Convention: prefix command name with `Remote` (e.g., `RemoteGetInfoCommand`)

#### E. Terminal Block Implementation

Implement in `frontend/app/view/term/term-wsh.tsx`:

```typescript
async handle_yournew(rh: RpcResponseHelper, data: CommandYourNewData): Promise<YourNewResponse> {
    // Access terminal-specific data
    const termWrap = this.model.termRef.current;
    
    // Implement terminal logic
    const result = termWrap.doSomething(data);
    
    return {
        resultfield: result,
        success: true,
    };
}
```

**Use terminal client when:**
- Accessing terminal buffer/scrollback
- Managing VDOM contexts
- Reading terminal-specific state
- Interacting with xterm.js

## Complete Example: Adding GetWaveInfo Command

### 1. Define Interface

In `pkg/wshrpc/wshrpctypes.go`:

```go
type WshRpcInterface interface {
    // ... other commands ...
    WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)
}

type WaveInfoData struct {
    Version      string            `json:"version"`
    BuildTime    string            `json:"buildtime"`
    ConfigPath   string            `json:"configpath"`
    DataPath     string            `json:"datapath"`
}
```

### 2. Generate Bindings

```bash
task generate
```

### 3. Implement in Main Server

In `pkg/wshrpc/wshserver/wshserver.go`:

```go
func (ws *WshServer) WaveInfoCommand(ctx context.Context) (*wshrpc.WaveInfoData, error) {
    return &wshrpc.WaveInfoData{
        Version:    wavebase.WaveVersion,
        BuildTime:  wavebase.BuildTime,
        ConfigPath: wavebase.GetConfigDir(),
        DataPath:   wavebase.GetWaveDataDir(),
    }, nil
}
```

### 4. Call from Frontend

```typescript
import { RpcApi } from "@/app/store/wshclientapi";

// Call the RPC
const info = await RpcApi.WaveInfoCommand(TabRpcClient);
console.log("Wave Version:", info.version);
```

## Streaming Commands

For commands that return data progressively, use channels:

### Define Streaming Interface

```go
type WshRpcInterface interface {
    StreamYourDataCommand(ctx context.Context, request YourDataRequest) chan RespOrErrorUnion[YourDataType]
}
```

### Implement Streaming Command

```go
func (ws *WshServer) StreamYourDataCommand(ctx context.Context, request wshrpc.YourDataRequest) chan wshrpc.RespOrErrorUnion[wshrpc.YourDataType] {
    rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.YourDataType])
    
    go func() {
        defer close(rtn)
        defer func() {
            panichandler.PanicHandler("StreamYourDataCommand", recover())
        }()
        
        // Stream data
        for i := 0; i < 10; i++ {
            select {
            case <-ctx.Done():
                return
            default:
                rtn <- wshrpc.RespOrErrorUnion[wshrpc.YourDataType]{
                    Response: wshrpc.YourDataType{
                        Value: i,
                    },
                }
                time.Sleep(100 * time.Millisecond)
            }
        }
    }()
    
    return rtn
}
```

## Best Practices

1. **Validation First**: Always validate input parameters at the start of your implementation

2. **Descriptive Names**: Use clear, action-oriented command names (e.g., `GetFullConfigCommand`, not `ConfigCommand`)

3. **Error Handling**: Return descriptive errors with context:
   ```go
   return nil, fmt.Errorf("error creating block: %w", err)
   ```

4. **Context Awareness**: Respect context cancellation for long-running operations:
   ```go
   select {
   case <-ctx.Done():
       return ctx.Err()
   default:
       // continue
   }
   ```

5. **Consistent Types**: Follow existing naming patterns for request/response types

6. **JSON Tags**: Always use lowercase JSON tags matching frontend conventions

7. **Documentation**: Add comments explaining complex commands or special behaviors

8. **Type Safety**: Leverage TypeScript generation - your types will be checked on both ends

9. **Panic Recovery**: Use `panichandler.PanicHandler` in goroutines to prevent crashes

10. **Route Awareness**: For multi-route scenarios, use `wshutil.GetRpcSourceFromContext(ctx)` to identify callers

## Common Command Patterns

### Simple Query

```go
func (ws *WshServer) GetSomethingCommand(ctx context.Context, id string) (*Something, error) {
    obj, err := wstore.DBGet[*Something](ctx, id)
    if err != nil {
        return nil, fmt.Errorf("error getting something: %w", err)
    }
    return obj, nil
}
```

### Mutation with Updates

```go
func (ws *WshServer) UpdateSomethingCommand(ctx context.Context, data wshrpc.CommandUpdateData) error {
    ctx = waveobj.ContextWithUpdates(ctx)
    
    // Make changes
    err := wstore.UpdateObject(ctx, data.ORef, data.Updates)
    if err != nil {
        return fmt.Errorf("error updating: %w", err)
    }
    
    // Broadcast updates
    updates := waveobj.ContextGetUpdatesRtn(ctx)
    wps.Broker.SendUpdateEvents(updates)
    
    return nil
}
```

### Command with Side Effects

```go
func (ws *WshServer) DoActionCommand(ctx context.Context, data wshrpc.CommandActionData) error {
    // Perform action
    result, err := performAction(data)
    if err != nil {
        return err
    }
    
    // Publish event about the action
    go func() {
        wps.Broker.Publish(wps.WaveEvent{
            Event: wps.Event_ActionComplete,
            Data:  result,
        })
    }()
    
    return nil
}
```

## Troubleshooting

### Command Not Found

- Ensure method name ends with `Command`
- Verify you ran `task generate`
- Check that the interface is in `WshRpcInterface`

### Type Mismatch Errors

- Run `task generate` after changing types
- Ensure JSON tags are lowercase
- Verify TypeScript code is using generated types

### Command Times Out

- Check for blocking operations
- Ensure context is passed through
- Consider using a streaming command for long operations

### Routing Issues

- For remote commands, ensure they're implemented in correct location
- Check route configuration in RpcContext
- Verify authentication for secured routes

## Quick Reference

When adding a new RPC command:

- [ ] Add method to `WshRpcInterface` in `pkg/wshrpc/wshrpctypes.go` (must end with `Command`)
- [ ] Define request/response types with JSON tags (if needed)
- [ ] Run `task generate` to create bindings
- [ ] Implement in appropriate location:
  - [ ] `wshserver.go` for main server (most common)
  - [ ] `emain-wsh.ts` for Electron
  - [ ] `tabrpcclient.ts` for frontend
  - [ ] `wshremote.go` for remote (prefix with `Remote`)
  - [ ] `term-wsh.tsx` for terminal
- [ ] Add input validation
- [ ] Handle errors with context
- [ ] Test the command end-to-end

## Related Documentation

- **WPS Events**: See the `wps-events` skill - Publishing events from RPC commands
