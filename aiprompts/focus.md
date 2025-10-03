# Wave Terminal Focus System

This document explains how the focus system works in Wave Terminal, particularly for terminal blocks.

## Overview

Wave Terminal uses a multi-layered focus system that coordinates between:
- **Layout Focus State**: Jotai atoms tracking which block is focused (`nodeModel.isFocused`)
- **Visual Focus Ring**: CSS styling showing the focused block
- **DOM Focus**: Actual browser focus on interactive elements
- **View-Specific Focus**: Custom focus handling by view models (e.g., XTerm terminal focus)

## Focus Flow on Block Click

When you click on a terminal block, this sequence occurs:

### 1. Click Handler Setup
[`frontend/app/block/block.tsx:219-223`](frontend/app/block/block.tsx:219-223)

```typescript
const blockModel: BlockComponentModel2 = {
    onClick: setBlockClickedTrue,
    onFocusCapture: handleChildFocus,
    blockRef: blockRef,
};
```

### 2. Click Triggers State Change
[`frontend/app/block/block.tsx:165-167`](frontend/app/block/block.tsx:165-167)

When clicked, `setBlockClickedTrue` sets the `blockClicked` state to true.

### 3. useLayoutEffect Responds
[`frontend/app/block/block.tsx:151-163`](frontend/app/block/block.tsx:151-163)

```typescript
useLayoutEffect(() => {
    if (!blockClicked) {
        return;
    }
    setBlockClicked(false);
    const focusWithin = focusedBlockId() == nodeModel.blockId;
    if (!focusWithin) {
        setFocusTarget();
    }
    if (!isFocused) {
        nodeModel.focusNode();
    }
}, [blockClicked, isFocused]);
```

### 4. Focus Target Decision
[`frontend/app/block/block.tsx:211-217`](frontend/app/block/block.tsx:211-217)

```typescript
const setFocusTarget = useCallback(() => {
    const ok = viewModel?.giveFocus?.();
    if (ok) {
        return;
    }
    focusElemRef.current?.focus({ preventScroll: true });
}, []);
```

The `setFocusTarget` function:
1. First attempts to call the view model's `giveFocus()` method
2. If that succeeds (returns true), we're done
3. Otherwise, falls back to focusing a dummy input element

### 5. Terminal-Specific Focus
[`frontend/app/view/term/term.tsx:414-427`](frontend/app/view/term/term.tsx:414-427)

```typescript
giveFocus(): boolean {
    if (this.searchAtoms && globalStore.get(this.searchAtoms.isOpen)) {
        return true;
    }
    let termMode = globalStore.get(this.termMode);
    if (termMode == "term") {
        if (this.termRef?.current?.terminal) {
            this.termRef.current.terminal.focus();
            return true;
        }
    }
    return false;
}
```

The terminal's `giveFocus()` calls XTerm's `terminal.focus()` to grant actual DOM focus.

## Selection Protection

A critical feature is that text selections are preserved when clicking within the same block.

### The Protection Mechanism
[`frontend/app/block/block.tsx:156-158`](frontend/app/block/block.tsx:156-158)

```typescript
const focusWithin = focusedBlockId() == nodeModel.blockId;
if (!focusWithin) {
    setFocusTarget();
}
```

The key is [`focusedBlockId()`](frontend/util/focusutil.ts:48-70) which checks:

1. **Active Element**: Is there a focused DOM element within this block?
2. **Selection**: Is there a text selection within this block?

```typescript
export function focusedBlockId(): string {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
        const blockId = findBlockId(focused);
        if (blockId) {
            return blockId;
        }
    }
    const sel = document.getSelection();
    if (sel && sel.anchorNode && sel.rangeCount > 0 && !sel.isCollapsed) {
        let anchor = sel.anchorNode;
        if (anchor instanceof Text) {
            anchor = anchor.parentElement;
        }
        if (anchor instanceof HTMLElement) {
            const blockId = findBlockId(anchor);
            if (blockId) {
                return blockId;
            }
        }
    }
    return null;
}
```

**When making a text selection within a block:**
- `focusWithin` returns true (selection exists in the block)
- `setFocusTarget()` is **skipped**
- Selection is preserved
- Only `nodeModel.focusNode()` is called to update layout state

## Visual Focus vs DOM Focus

There's an important separation between visual focus (the focus ring) and actual DOM focus.

### Visual Focus (Immediate)
[`frontend/app/block/block.tsx:200-209`](frontend/app/block/block.tsx:200-209)

```typescript
const handleChildFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement, Element>) => {
        if (!isFocused) {
            nodeModel.focusNode();  // Updates layout state immediately
        }
    },
    [isFocused]
);
```

This `onFocusCapture` handler fires on **mousedown** (capture phase), immediately updating the visual focus ring.

### DOM Focus (On Click Complete)

The actual DOM focus via `giveFocus()` only happens after click completion, through the onClick → useLayoutEffect path.

### Selection Example: Two Terminals

When making a selection in terminal 2 while terminal 1 is focused:

1. **Mousedown** → `onFocusCapture` fires → `nodeModel.focusNode()` updates focus ring
   - Terminal 2 now shows the focus ring
   - Layout state updated
2. **Drag** → Selection is made in terminal 2
3. **Mouseup** → Selection completes
4. **Click handler** → `onClick` fires → `setBlockClickedTrue` → triggers useLayoutEffect
5. **useLayoutEffect** → Checks `focusWithin` (now true because selection exists)
6. **Protected** → Skips `setFocusTarget()`, preserving the selection

**Result:** Focus ring updates immediately, but DOM focus is only granted after the selection is made, and is protected by the `focusWithin` check.

## Terminal-Specific Focus Events

The terminal view has three useEffects that call `giveFocus()`:

### 1. Search Close
[`frontend/app/view/term/term.tsx:970-974`](frontend/app/view/term/term.tsx:970-974)

When the search panel closes, focus returns to the terminal.

### 2. Terminal Recreation
[`frontend/app/view/term/term.tsx:1035-1038`](frontend/app/view/term/term.tsx:1035-1038)

When a terminal is recreated while focused (e.g., settings change), focus is restored.

### 3. Mode Switch
[`frontend/app/view/term/term.tsx:1046-1052`](frontend/app/view/term/term.tsx:1046-1052)

When switching from vdom mode back to term mode, the terminal receives focus.

## Key Components

### Block Component
[`frontend/app/block/block.tsx`](frontend/app/block/block.tsx)
- Manages the BlockFull component
- Handles click and focus capture events
- Coordinates between layout focus and DOM focus

### BlockNodeModel
[`frontend/app/block/blocktypes.ts:7-12`](frontend/app/block/blocktypes.ts:7-12)
```typescript
export interface BlockNodeModel {
    blockId: string;
    isFocused: Atom<boolean>;
    onClose: () => void;
    focusNode: () => void;
}
```

### ViewModel Interface
View models can implement `giveFocus(): boolean` to handle focus in a view-specific way.

### Focus Utilities
[`frontend/util/focusutil.ts`](frontend/util/focusutil.ts)
- `focusedBlockId()`: Determines which block has focus or selection
- `hasSelection()`: Checks if there's an active text selection
- `findBlockId()`: Traverses DOM to find containing block

## Summary

The focus system elegantly separates concerns:
- **Visual feedback** updates immediately on mousedown
- **DOM focus** is deferred until after user interaction completes
- **Selections are protected** by checking focus state before granting focus
- **View-specific focus** is delegated to view models via `giveFocus()`

This design allows for responsive UI (immediate focus ring updates) while preventing disruption of user interactions like text selection.