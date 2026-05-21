# Spec: System Widgets Follow Terminal Focus

**Date:** 2026-05-20
**Status:** Draft

## Problem

When opening a system widget (Process Viewer, File Browser, etc.), it always defaults to showing information for the local machine, regardless of which terminal has focus. For remote-first workflows, this means users must manually switch the widget's connection after opening it.

**Example:** You're working in a remote SSH terminal, click the Process Viewer widget, and it shows local processes. You then have to change the connection dropdown to see the remote processes you actually care about.

## Solution

When creating a system widget block, inherit the `connection` meta from the currently focused terminal block.

## Scope

### Widgets that should follow focus

| Widget | View Type | Reason |
|--------|-----------|--------|
| Process Viewer | `processviewer` | Shows processes on the focused host |
| File Browser / Preview | `preview` | Shows files at the focused terminal's cwd |

### Widgets that should NOT follow focus (always local)

| Widget | View Type | Reason |
|--------|-----------|--------|
| Settings | `waveconfig` | App configuration is local |
| Secrets | `waveconfig` + `file: "secrets"` | Secret store is local |
| Help | `help` | Static content |
| Tips | `tips` | Static content |
| Tsunami apps | `tsunami` | App-specific, may have own connection logic |

## Current Behavior

### Widget creation paths

1. **Widgets bar** (`widgets.tsx`) — `handleWidgetSelect()` reads `widget.blockdef` from config, calls `env.createBlock(blockDef)`
2. **Terminal context menu** (`term-model.ts`) — e.g., File Browser already reads `blockData?.meta?.connection` and passes it
3. **Keyboard shortcuts** — various, depending on widget
4. **Programmatic** — stickers, other UI elements

### Connection resolution today

In `ProcessViewerViewModel.constructor()`:
```typescript
this.connection = jotai.atom((get) => {
    const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
    if (isBlank(connValue)) {
        return "local";  // <-- always defaults to local
    }
    return connValue;
});
```

### What already works

The File Browser in the terminal context menu already inherits connection:
```typescript
// term-model.ts, line ~900
const connection = blockData?.meta?.connection;
const meta: Record<string, any> = { view: "preview", file: cwd };
if (connection) {
    meta.connection = connection;
}
```

## Proposed Changes

### 1. Helper: get focused block's connection

Add to `frontend/app/store/global.ts`:

```typescript
/**
 * Returns the connection name of the currently focused terminal block,
 * or null if no terminal is focused or it's a local session.
 */
function getFocusedTerminalConnection(): string | null {
    const focusedBlockId = getFocusedBlockId();
    if (!focusedBlockId) return null;
    const blockData = globalStore.get(getBlockAtom(focusedBlockId));
    // Only inherit from terminal blocks
    if (blockData?.meta?.view !== "term" && blockData?.meta?.view !== "splitterm") {
        return null;
    }
    const conn = blockData?.meta?.connection;
    return conn || null;  // null means local session
}
```

### 2. Widget creation: inject connection

Create a helper that wraps `createBlock` for system widgets:

```typescript
/**
 * Creates a block for a system widget, inheriting connection from focused terminal.
 * If @inheritConnection is false, creates block without connection meta.
 */
async function createWidgetBlock(
    blockDef: BlockDef,
    magnified?: boolean,
    ephemeral?: boolean,
    inheritConnection: boolean = true
): Promise<string> {
    if (inheritConnection) {
        const focusedConn = getFocusedTerminalConnection();
        if (focusedConn) {
            blockDef.meta = { ...blockDef.meta, connection: focusedConn };
        }
        // if focusedConn is null, don't set connection (defaults to "local" in widget)
    }
    return createBlock(blockDef, magnified, ephemeral);
}
```

### 3. Update creation sites

| File | Widget | Change |
|------|--------|--------|
| `widgets.tsx` | Process Viewer (from widgets bar) | Use `createWidgetBlock` instead of `env.createBlock` |
| `term-model.ts` | File Browser | Already works, no change needed |
| Any future widget | N/A | Use `createWidgetBlock` with `inheritConnection: true/false` |

### 4. Widget config: declare connection inheritance

Add an optional field to `WidgetConfigType` in the widgets config schema:

```jsonc
{
  "processviewer": {
    "label": "Processes",
    "icon": "microchip",
    "blockdef": { "meta": { "view": "processviewer" } },
    "inheritconnection": true   // <-- new field, default: false
  }
}
```

This way each widget declares whether it should follow focus, rather than hardcoding a list in the code.

## Files to Modify

| File | Change |
|------|--------|
| `frontend/app/store/global.ts` | Add `getFocusedTerminalConnection()`, `createWidgetBlock()` |
| `frontend/app/workspace/widgets.tsx` | Use `createWidgetBlock` in `handleWidgetSelect()` |
| `frontend/app/waveenv/waveenv.ts` | Add `createWidgetBlock` to WaveEnv interface |
| `frontend/app/waveenv/waveenvimpl.ts` | Export `createWidgetBlock` |
| `docs/docs/widgets.json` (or schema) | Add `inheritconnection` field to widget config |

## Test Cases

| Scenario | Expected |
|----------|----------|
| Focus on remote SSH terminal, click Process Viewer | Widget shows remote processes |
| Focus on local terminal, click Process Viewer | Widget shows local processes |
| Focus on Settings widget, click Process Viewer | Widget shows local processes (Settings is not a terminal) |
| Focus on remote terminal, click Settings | Settings opens (no connection meta, stays local) |
| Switch focus between two remote terminals, open Process Viewer each time | Widget follows whichever terminal is focused |
| File Browser from terminal context menu | Already works, verify no regression |

## Out of Scope

- Widget remembers last-used connection per-host (could be a future enhancement)
- Multiple widgets showing different hosts simultaneously (already works, each widget is independent)
- Non-terminal views inheriting connection (e.g., splitting a process viewer)
