---
name: electron-api
description: Guide for adding new Electron APIs to Wave Terminal. Use when implementing new frontend-to-electron communications via preload/IPC.
---

# Adding Electron APIs

Electron APIs allow the frontend to call Electron main process functionality directly via IPC.

## Three Files to Edit

1. [`frontend/types/custom.d.ts`](frontend/types/custom.d.ts) - TypeScript [`ElectronApi`](frontend/types/custom.d.ts:82) type
2. [`emain/preload.ts`](emain/preload.ts) - Expose method via `contextBridge`
3. [`emain/emain-ipc.ts`](emain/emain-ipc.ts) - Implement IPC handler

## Three Communication Patterns

1. **Sync** - `ipcRenderer.sendSync()` + `ipcMain.on()` + `event.returnValue = ...`
2. **Async** - `ipcRenderer.invoke()` + `ipcMain.handle()`
3. **Fire-and-forget** - `ipcRenderer.send()` + `ipcMain.on()`

## Example: Async Method

### 1. Define TypeScript Interface

In [`frontend/types/custom.d.ts`](frontend/types/custom.d.ts):

```typescript
type ElectronApi = {
    captureScreenshot: (rect: Electron.Rectangle) => Promise<string>; // capture-screenshot
};
```

### 2. Expose in Preload

In [`emain/preload.ts`](emain/preload.ts):

```typescript
contextBridge.exposeInMainWorld("api", {
    captureScreenshot: (rect: Rectangle) => ipcRenderer.invoke("capture-screenshot", rect),
});
```

### 3. Implement Handler

In [`emain/emain-ipc.ts`](emain/emain-ipc.ts):

```typescript
electron.ipcMain.handle("capture-screenshot", async (event, rect) => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (!tabView) throw new Error("No tab view found");
    const image = await tabView.webContents.capturePage(rect);
    return `data:image/png;base64,${image.toPNG().toString("base64")}`;
});
```

### 4. Call from Frontend

```typescript
import { getApi } from "@/store/global";

const dataUrl = await getApi().captureScreenshot({ x: 0, y: 0, width: 800, height: 600 });
```

## Example: Sync Method

### 1. Define

```typescript
type ElectronApi = {
    getUserName: () => string; // get-user-name
};
```

### 2. Preload

```typescript
getUserName: () => ipcRenderer.sendSync("get-user-name"),
```

### 3. Handler (⚠️ MUST set event.returnValue or browser hangs)

```typescript
electron.ipcMain.on("get-user-name", (event) => {
    event.returnValue = process.env.USER || "unknown";
});
```

### 4. Call

```typescript
import { getApi } from "@/store/global";

const userName = getApi().getUserName(); // blocks until returns
```

## Example: Fire-and-Forget

### 1. Define

```typescript
type ElectronApi = {
    openExternal: (url: string) => void; // open-external
};
```

### 2. Preload

```typescript
openExternal: (url) => ipcRenderer.send("open-external", url),
```

### 3. Handler

```typescript
electron.ipcMain.on("open-external", (event, url) => {
    electron.shell.openExternal(url);
});
```

## Example: Event Listener

### 1. Define

```typescript
type ElectronApi = {
    onZoomFactorChange: (callback: (zoomFactor: number) => void) => void; // zoom-factor-change
};
```

### 2. Preload

```typescript
onZoomFactorChange: (callback) => 
    ipcRenderer.on("zoom-factor-change", (_event, zoomFactor) => callback(zoomFactor)),
```

### 3. Send from Main

```typescript
webContents.send("zoom-factor-change", newZoomFactor);
```

## Quick Reference

**Use Sync when:**
- Getting config/env vars
- Quick lookups, no I/O
- ⚠️ **CRITICAL**: Always set `event.returnValue` or browser hangs

**Use Async when:**
- File operations
- Network requests
- Can fail or take time

**Use Fire-and-forget when:**
- No return value needed
- Triggering actions

**Electron API vs RPC:**
- Electron API: Native OS features, window management, Electron APIs
- RPC: Database, backend logic, remote servers

## Checklist

- [ ] Add to [`ElectronApi`](frontend/types/custom.d.ts:82) in [`custom.d.ts`](frontend/types/custom.d.ts)
- [ ] Include IPC channel name in comment
- [ ] Expose in [`preload.ts`](emain/preload.ts)
- [ ] Implement in [`emain-ipc.ts`](emain/emain-ipc.ts)
- [ ] IPC channel names match exactly
- [ ] **For sync**: Set `event.returnValue` (or browser hangs!)
- [ ] Test end-to-end
