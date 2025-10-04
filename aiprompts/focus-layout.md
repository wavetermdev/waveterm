# Wave Terminal Focus System - Layout State Flow

This document explains how focus state changes in the layout system propagate through the application to update both the visual focus ring and physical DOM focus.

## Overview

When layout operations modify focus state, a straightforward chain of updates occurs:
1. **Visual feedback** - The focus ring updates immediately
2. **Physical DOM focus** - The terminal (or other view) receives actual browser focus

The system uses local atoms as the source of truth with async persistence to the backend.

## The Flow

### 1. Setting Focus in Layout Operations

Throughout [`layoutTree.ts`](../frontend/layout/lib/layoutTree.ts), operations directly mutate `layoutState.focusedNodeId`:

```typescript
// Example from insertNode
if (action.magnified) {
    layoutState.magnifiedNodeId = action.node.id;
    layoutState.focusedNodeId = action.node.id;
}
if (action.focused) {
    layoutState.focusedNodeId = action.node.id;
}
```

This happens in ~10 places: insertNode, insertNodeAtIndex, deleteNode, focusNode, magnifyNodeToggle, etc.

### 2. Committing to Local Atom

The [`LayoutModel.treeReducer()`](../frontend/layout/lib/layoutModel.ts:547) commits changes:

```typescript
treeReducer(action: LayoutTreeAction, setState = true): boolean {
    // Mutate tree state
    focusNode(this.treeState, action);
    
    if (setState) {
        this.updateTree();  // Compute leafOrder, etc.
        this.setter(this.localTreeStateAtom, { ...this.treeState });  // Sync update
        this.persistToBackend();  // Async persistence
    }
}
```

The key is `{ ...this.treeState }` creates a new object reference, triggering Jotai reactivity.

### 3. Derived Atoms Recalculate

Each block's `NodeModel` has an `isFocused` atom:

```typescript
isFocused: atom((get) => {
    const treeState = get(this.localTreeStateAtom);
    const isFocused = treeState.focusedNodeId === nodeid;
    const waveAIFocused = get(atoms.waveAIFocusedAtom);
    return isFocused && !waveAIFocused;
})
```

When `localTreeStateAtom` updates, all `isFocused` atoms recalculate. Only the matching node returns `true`.

### 4. React Components Re-render

**Visual Focus Ring** - Components subscribe to `isFocused`:

```typescript
const isFocused = useAtomValue(nodeModel.isFocused);
```

CSS classes update immediately, showing the focus ring.

**Physical DOM Focus** - Two-step effect chain:

```typescript
// Step 1: isFocused → blockClicked
useLayoutEffect(() => {
    setBlockClicked(isFocused);
}, [isFocused]);

// Step 2: blockClicked → physical focus
useLayoutEffect(() => {
    if (!blockClicked) return;
    setBlockClicked(false);
    const focusWithin = focusedBlockId() == nodeModel.blockId;
    if (!focusWithin) {
        setFocusTarget();  // Calls viewModel.giveFocus()
    }
}, [blockClicked, isFocused]);
```

The terminal's `giveFocus()` method grants actual browser focus:

```typescript
giveFocus(): boolean {
    if (termMode == "term" && this.termRef?.current?.terminal) {
        this.termRef.current.terminal.focus();
        return true;
    }
    return false;
}
```

### 5. Background Persistence

While the UI updates synchronously, persistence happens asynchronously:

```typescript
private persistToBackend() {
    // Debounced (100ms) to avoid excessive writes
    setTimeout(() => {
        waveObj.rootnode = this.treeState.rootNode;
        waveObj.focusednodeid = this.treeState.focusedNodeId;
        waveObj.magnifiednodeid = this.treeState.magnifiedNodeId;
        waveObj.leaforder = this.treeState.leafOrder;
        this.setter(this.waveObjectAtom, waveObj);
    }, 100);
}
```

The WaveObject is used purely for persistence (tab restore, uncaching).

## The Complete Chain

```
User action
    ↓
layoutState.focusedNodeId = nodeId
    ↓
setter(localTreeStateAtom, { ...treeState })
    ↓
isFocused atoms recalculate
    ↓
React re-renders
    ↓
┌────────────────────┬────────────────────┐
│ Visual Ring        │ Physical Focus     │
│ (immediate CSS)    │ (2-step effect)    │
└────────────────────┴────────────────────┘
    ↓
persistToBackend() (async, debounced)
```

## Key Points

1. **Local atoms** - `localTreeStateAtom` is the source of truth during runtime
2. **Synchronous updates** - UI changes happen immediately in one React tick
3. **Async persistence** - Backend writes are fire-and-forget with debouncing
4. **Two-step focus** - Separates visual (instant) from physical (coordinated) DOM focus
5. **View delegation** - Each view implements `giveFocus()` for custom focus behavior

## User-Initiated Focus

When a user clicks a block:

1. **`onFocusCapture`** (mousedown) → calls `nodeModel.focusNode()` → visual focus ring appears
2. **`onClick`** → sets `blockClicked = true` → two-step effect chain → physical DOM focus

This ensures visual feedback is instant while protecting selections.

## Backend Actions

On initialization or backend updates, queued actions are processed:

```typescript
if (initialState.pendingBackendActions?.length) {
    fireAndForget(() => this.processPendingBackendActions());
}
```

Backend can queue layout operations (create blocks, etc.) via `PendingBackendActions`.