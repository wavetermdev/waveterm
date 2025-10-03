# Wave Terminal Focus System - Layout State Flow

This document explains how focus state changes in the layout system (`layoutState.focusedNodeId`) propagate through the application to update both the visual focus ring and physical DOM focus.

## Overview

When layout operations modify `layoutState.focusedNodeId` (in ~10+ places throughout [`layoutTree.ts`](../frontend/layout/lib/layoutTree.ts)), a carefully orchestrated chain of updates occurs that ultimately results in:
1. **Visual feedback** - The focus ring updates immediately
2. **Physical DOM focus** - The terminal (or other view) receives actual browser focus

This is a "house of cards" architecture that works through reactive atom updates and clever React hooks.

## The Complete Flow

### 1. Setting focusedNodeId in LayoutTree

Throughout [`layoutTree.ts`](../frontend/layout/lib/layoutTree.ts), operations set the focused node:

**Example from insertNode** ([`layoutTree.ts:283-294`](../frontend/layout/lib/layoutTree.ts:283-294)):
```typescript
} else {
    const insertLoc = findNextInsertLocation(layoutState.rootNode, DEFAULT_MAX_CHILDREN);
    addChildAt(insertLoc.node, insertLoc.index, action.node);
    if (action.magnified) {
        layoutState.magnifiedNodeId = action.node.id;
        layoutState.focusedNodeId = action.node.id;  // ← Setting focusedNodeId
    }
}
if (action.focused) {
    layoutState.focusedNodeId = action.node.id;      // ← Or here
}
layoutState.generation++;  // ← CRITICAL: Triggers commit
```

**Other locations that set focusedNodeId:**
- [`layoutTree.ts:288`](../frontend/layout/lib/layoutTree.ts:288) - insertNode (magnified)
- [`layoutTree.ts:292`](../frontend/layout/lib/layoutTree.ts:292) - insertNode (focused)
- [`layoutTree.ts:313`](../frontend/layout/lib/layoutTree.ts:313) - insertNodeAtIndex (magnified)
- [`layoutTree.ts:317`](../frontend/layout/lib/layoutTree.ts:317) - insertNodeAtIndex (focused)
- [`layoutTree.ts:370-371`](../frontend/layout/lib/layoutTree.ts:370-371) - deleteNode (clearing)
- [`layoutTree.ts:402`](../frontend/layout/lib/layoutTree.ts:402) - focusNode action
- [`layoutTree.ts:419`](../frontend/layout/lib/layoutTree.ts:419) - magnifyNodeToggle
- [`layoutTree.ts:427`](../frontend/layout/lib/layoutTree.ts:427) - clearTree (clearing)
- [`layoutTree.ts:454`](../frontend/layout/lib/layoutTree.ts:454) - replaceNode
- [`layoutTree.ts:498`](../frontend/layout/lib/layoutTree.ts:498) - splitHorizontal
- [`layoutTree.ts:540`](../frontend/layout/lib/layoutTree.ts:540) - splitVertical

**The Critical Part:** Every time `focusedNodeId` is set, `generation++` follows. This increment is the signal that triggers the entire propagation chain.

### 2. Generation Increment Commits to WaveObject

The `treeStateAtom` in [`layoutAtom.ts`](../frontend/layout/lib/layoutAtom.ts) is a bidirectional atom that syncs with the backend WaveObject.

**The Write Path** ([`layoutAtom.ts:37-56`](../frontend/layout/lib/layoutAtom.ts:37-56)):
```typescript
(get, set, value) => {
    if (get(generationAtom) < value.generation) {  // ← Check if generation increased
        const stateAtom = getLayoutStateAtomFromTab(tabAtom, get);
        if (!stateAtom) return;
        const waveObjVal = get(stateAtom);
        if (waveObjVal == null) return;
        
        // Write to backend WaveObject
        waveObjVal.rootnode = value.rootNode;
        waveObjVal.magnifiednodeid = value.magnifiedNodeId;
        waveObjVal.focusednodeid = value.focusedNodeId;  // ← focusedNodeId commits here
        waveObjVal.leaforder = value.leafOrder;
        waveObjVal.pendingbackendactions = value?.pendingBackendActions?.length
            ? value.pendingBackendActions
            : undefined;
        set(generationAtom, value.generation);
        set(stateAtom, waveObjVal);  // ← Triggers WaveObject update
    }
}
```

**Without `generation++`, the changes stay local and never propagate!**

### 3. WaveObject Update Triggers Atom Recalculation

When the WaveObject is updated via `set(stateAtom, waveObjVal)`, all atoms that depend on it recalculate.

**The Read Path** ([`layoutAtom.ts:24-35`](../frontend/layout/lib/layoutAtom.ts:24-35)):
```typescript
(get) => {
    const stateAtom = getLayoutStateAtomFromTab(tabAtom, get);
    if (!stateAtom) return;
    const layoutStateData = get(stateAtom);  // ← Reads from WaveObject
    const layoutTreeState: LayoutTreeState = {
        rootNode: layoutStateData?.rootnode,
        focusedNodeId: layoutStateData?.focusednodeid,  // ← Gets new focusedNodeId
        magnifiedNodeId: layoutStateData?.magnifiednodeid,
        pendingBackendActions: layoutStateData?.pendingbackendactions,
        generation: get(generationAtom),
    };
    return layoutTreeState;
}
```

The WaveObject acts as the "source of truth" that drives the reactive chain.

### 4. isFocused Atoms Recalculate

Each block's `NodeModel` has an `isFocused` atom that derives from `treeStateAtom`.

**NodeModel Creation** ([`layoutModel.ts:936-941`](../frontend/layout/lib/layoutModel.ts:936-941)):
```typescript
isFocused: atom((get) => {
    const treeState = get(this.treeStateAtom);  // ← Depends on treeStateAtom
    const isFocused = treeState.focusedNodeId === nodeid;  // ← Compare with this node's ID
    const waveAIFocused = get(atoms.waveAIFocusedAtom);
    return isFocused && !waveAIFocused;
})
```

When `treeStateAtom` updates, all `isFocused` atoms recalculate. Only the atom for the node matching `focusedNodeId` returns `true`.

### 5. Visual Focus Ring Updates

React components consume the `isFocused` atom and re-render when it changes.

**Block Component** ([`block.tsx:142`](../frontend/app/block/block.tsx:142)):
```typescript
const isFocused = useAtomValue(nodeModel.isFocused);  // ← Subscribes to isFocused atom
```

The `isFocused` value is passed to child components and CSS classes, causing the focus ring to appear/disappear immediately.

### 6. Physical DOM Focus via Two-Step Effect

This is where it gets clever (and fragile). Physical DOM focus is achieved through a cascade of two `useLayoutEffect` hooks.

**Step 1: isFocused Change Triggers blockClicked** ([`block.tsx:147-149`](../frontend/app/block/block.tsx:147-149)):
```typescript
useLayoutEffect(() => {
    setBlockClicked(isFocused);  // When isFocused changes to true, trigger blockClicked
}, [isFocused]);
```

**Step 2: blockClicked Triggers Physical Focus** ([`block.tsx:151-163`](../frontend/app/block/block.tsx:151-163)):
```typescript
useLayoutEffect(() => {
    if (!blockClicked) {
        return;
    }
    setBlockClicked(false);  // Reset for next time
    const focusWithin = focusedBlockId() == nodeModel.blockId;
    if (!focusWithin) {
        setFocusTarget();  // ← PHYSICAL DOM FOCUS HAPPENS HERE
    }
    if (!isFocused) {
        nodeModel.focusNode();  // Update layout state if needed
    }
}, [blockClicked, isFocused]);
```

**Why two effects?** This separates the visual update (immediate) from the physical focus (coordinated). It also provides a single point where focus granting can be controlled (e.g., skipped if there's a selection).

**Step 3: setFocusTarget Delegates to ViewModel** ([`block.tsx:211-217`](../frontend/app/block/block.tsx:211-217)):
```typescript
const setFocusTarget = useCallback(() => {
    const ok = viewModel?.giveFocus?.();  // Try view-specific focus first
    if (ok) {
        return;
    }
    focusElemRef.current?.focus({ preventScroll: true });  // Fallback to dummy input
}, []);
```

**Step 4: Terminal's giveFocus Grants XTerm Focus** ([`term.tsx:414-427`](../frontend/app/view/term/term.tsx:414-427)):
```typescript
giveFocus(): boolean {
    if (this.searchAtoms && globalStore.get(this.searchAtoms.isOpen)) {
        return true;  // Search panel handles focus
    }
    let termMode = globalStore.get(this.termMode);
    if (termMode == "term") {
        if (this.termRef?.current?.terminal) {
            this.termRef.current.terminal.focus();  // ← XTerm gets actual browser focus
            return true;
        }
    }
    return false;
}
```

## The Complete Chain

```
layoutState.focusedNodeId = nodeId
           ↓
layoutState.generation++
           ↓
treeStateAtom setter (checks generation)
           ↓
WaveObject.focusednodeid = nodeId (commit)
           ↓
WaveObject update notification
           ↓
treeStateAtom getter runs
           ↓
All isFocused atoms recalculate
           ↓
React components re-render
           ↓
┌──────────────────────────┬──────────────────────────┐
│                          │                          │
│   Visual Focus Ring      │   Physical DOM Focus     │
│   (immediate)            │   (coordinated)          │
│                          │                          │
│   CSS updates based on   │   useLayoutEffect #1:    │
│   isFocused value        │   isFocused → blockClicked│
│                          │                          │
│                          │   useLayoutEffect #2:    │
│                          │   blockClicked → setFocusTarget│
│                          │                          │
│                          │   setFocusTarget()       │
│                          │   ↓                      │
│                          │   viewModel.giveFocus()  │
│                          │   ↓                      │
│                          │   terminal.focus()       │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

## User-Initiated Focus

When a user clicks a block, the flow is slightly different (see [`focus.md`](./focus.md) for details):

1. **`onFocusCapture`** fires on mousedown → immediately calls `nodeModel.focusNode()`
2. This updates the layout state (visual focus ring updates)
3. **`onClick`** fires after click → sets `blockClicked = true`
4. The two-step effect chain grants physical DOM focus

This ensures the focus ring updates instantly on mousedown, while physical focus waits until after the click completes (protecting selections).

## Key Takeaways

1. **`generation++` is critical** - Without it, changes never commit to the WaveObject
2. **WaveObject is the hub** - All state flows through the backend WaveObject, enabling persistence and sync
3. **Reactive atoms propagate changes** - Jotai atoms automatically update when dependencies change
4. **Two-step effect for physical focus** - Using `blockClicked` as a trigger separates visual from physical updates
5. **View-specific focus** - Each view type (terminal, editor, etc.) implements its own `giveFocus()` method

## Why This Architecture?

This seemingly complex flow provides several benefits:
- **Persistence**: Changes automatically sync to the backend
- **Consistency**: Single source of truth for focus state
- **Flexibility**: Views can customize focus behavior via `giveFocus()`
- **Performance**: Visual updates are immediate while physical focus is deferred
- **Protection**: The two-step approach allows for conditional focus granting (e.g., preserving selections)

However, it is indeed a "house of cards" - each piece depends on the previous one working correctly. Understanding this flow is crucial for debugging focus-related issues.