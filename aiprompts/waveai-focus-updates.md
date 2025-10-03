# Wave Terminal Focus System - Wave AI Integration

## Problem

Wave AI focus handling is fragile compared to blocks:
1. Only watches textarea focus/blur, missing the multi-phase handling that blocks have
2. Selection handling breaks - selecting text causes blur → focus reverts to layout
3. Focus ring flashing - clicking Wave AI briefly shows focus ring on layout
4. Window blur sensitivity - `window.blur()` incorrectly assumes user wants to leave Wave AI
5. No capture phase - missing the immediate visual feedback that blocks get

## Solution Overview

Extend the block focus system pattern to Wave AI:
- Multi-phase handling (capture + click)
- Selection protection
- Focus manager coordination
- View delegation

## Architecture

```mermaid
graph TB
    User[User Interaction]
    FM[Focus Manager]
    Layout[Layout System]
    WaveAI[Wave AI Panel]

    User -->|click/key| FM
    FM -->|node focus| Layout
    FM -->|waveai focus| WaveAI
    Layout -->|request focus back| FM
    WaveAI -->|request focus back| FM

    FM -->|focusType atom| State[Global State]
    Layout -.->|checks| State
    WaveAI -.->|checks| State
```

## Focus Manager Enhancements

**File**: [`frontend/app/store/focusManager.ts`](frontend/app/store/focusManager.ts)

Add selection-aware focus methods:

```typescript
class FocusManager {
  // Existing
  focusType: PrimitiveAtom<"node" | "waveai">;
  blockFocusAtom: Atom<string | null>;

  // NEW: Selection-aware focus checking
  waveAIFocusWithin(): boolean;
  nodeFocusWithin(): boolean;

  // NEW: Protected transitions (check selections first)
  requestNodeFocus(): void;    // from Wave AI → node
  requestWaveAIFocus(): void;  // from node → Wave AI

  // NEW: Get current focus type
  getFocusType(): FocusStrType;

  // ENHANCED: Smart refocus based on focusType
  refocusNode(): void;  // already handles both types

  // NEW: Focus ring coordination
  shouldShowWaveAIFocusRing(): boolean;
  shouldShowNodeFocusRing(blockId: string): boolean;
}
```

## Wave AI Focus Utilities

**New File**: [`frontend/app/aipanel/waveai-focus-utils.ts`](frontend/app/aipanel/waveai-focus-utils.ts)

Similar to [`focusutil.ts`](frontend/util/focusutil.ts) but for Wave AI:

```typescript
// Find if element is within Wave AI panel
export function findWaveAIPanel(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement = element;
  while (current) {
    if (current.hasAttribute("data-waveai-panel")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

// Check if Wave AI panel has focus or selection (like focusedBlockId())
export function waveAIHasFocusWithin(): boolean {
  // Check if activeElement is within Wave AI panel
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    const waveAIPanel = findWaveAIPanel(focused);
    if (waveAIPanel) return true;
  }

  // Check if selection is within Wave AI panel
  const sel = document.getSelection();
  if (sel && sel.anchorNode && sel.rangeCount > 0 && !sel.isCollapsed) {
    let anchor = sel.anchorNode;
    if (anchor instanceof Text) {
      anchor = anchor.parentElement;
    }
    if (anchor instanceof HTMLElement) {
      const waveAIPanel = findWaveAIPanel(anchor);
      if (waveAIPanel) return true;
    }
  }

  return false;
}

// Check if there's an active selection in Wave AI
export function waveAIHasSelection(): boolean {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return false;
  }

  let anchor = sel.anchorNode;
  if (anchor instanceof Text) {
    anchor = anchor.parentElement;
  }
  if (anchor instanceof HTMLElement) {
    return findWaveAIPanel(anchor) != null;
  }

  return false;
}
```

## Wave AI Panel Integration

**File**: [`frontend/app/aipanel/aipanel.tsx`](frontend/app/aipanel/aipanel.tsx)

Add capture phase and selection protection:

```typescript
// ADD: Capture phase handler (like blocks)
const handleFocusCapture = useCallback((event: React.FocusEvent) => {
    console.log("Wave AI focus capture", getElemAsStr(event.target));
    focusManager.requestWaveAIFocus();  // Sets visual state immediately
}, []);

// MODIFY: Click handler with selection protection
const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [tabindex]');

    if (isInteractive) {
        return;
    }

    // NEW: Check for selection protection
    const hasSelection = waveAIHasSelection();
    if (hasSelection) {
        // Just update visual focus, don't move DOM focus
        focusManager.requestWaveAIFocus();
        return;
    }

    // No selection, safe to move DOM focus
    setTimeout(() => {
        if (!waveAIHasSelection()) {  // Double-check after timeout
            model.focusInput();
        }
    }, 0);
};

// Add data attribute and onFocusCapture to the div
<div
    data-waveai-panel="true"
    className={...}
    onFocusCapture={handleFocusCapture}
    onClick={handleClick}
    // ... rest
>
```

## Wave AI Input Focus Handling

**File**: [`frontend/app/aipanel/aipanelinput.tsx`](frontend/app/aipanel/aipanelinput.tsx)

Smart blur handling:

```typescript
// MODIFY: handleFocus - advisory only
const handleFocus = useCallback(() => {
  globalStore.set(atoms.waveAIFocusedAtom, true);
  focusManager.requestWaveAIFocus();
}, []);

// MODIFY: handleBlur - smart about where focus is going
const handleBlur = useCallback((e: React.FocusEvent) => {
  const relatedTarget = e.relatedTarget;

  // Check if focus is moving to another element within Wave AI panel
  if (relatedTarget instanceof HTMLElement) {
    const waveAIPanel = findWaveAIPanel(relatedTarget);
    if (waveAIPanel) {
      // Focus staying within Wave AI, don't revert
      return;
    }
  }

  // Check if there's a selection in Wave AI
  if (waveAIHasSelection()) {
    // Selection exists, don't revert focus
    return;
  }

  // Check if this is a window blur (relatedTarget is null)
  if (relatedTarget === null) {
    // Window is losing focus (e.g., Cmd+Tab), don't change focus state
    return;
  }

  // Focus is truly leaving Wave AI, revert to node focus
  globalStore.set(atoms.waveAIFocusedAtom, false);
  focusManager.requestNodeFocus();
}, []);
```

## Block Focus Integration

**File**: [`frontend/app/block/block.tsx`](frontend/app/block/block.tsx)

**No changes needed in block.tsx** - the block code works perfectly as-is!

**How it works:**

When a block child gets focus (input field, terminal click, tab navigation):

```
1. handleChildFocus fires (capture phase)
     ↓
2. nodeModel.focusNode()
     ↓
3. layoutModel.focusNode(nodeId)
     ↓
4. treeReducer(FocusNodeAction)
     ↓
5. focusManager.requestNodeFocus() (see Layout Focus Coordination section)
     ↓
6. Updates localTreeStateAtom (synchronous)
     ↓
7. isFocused recalculates (sees focusType = "node")
     ↓
8. Two-step effect grants physical DOM focus
```

The focus manager update happens automatically in the treeReducer for all focus-claiming operations.

## Layout Focus Integration

**File**: [`frontend/layout/lib/layoutModel.ts`](frontend/layout/lib/layoutModel.ts)

The `isFocused` atom already checks Wave AI state:

```typescript
isFocused: atom((get) => {
  const treeState = get(this.localTreeStateAtom);
  const isFocused = treeState.focusedNodeId === nodeid;
  const waveAIFocused = get(atoms.waveAIFocusedAtom);
  return isFocused && !waveAIFocused;
});
```

**Update to use focus manager:**

```typescript
isFocused: atom((get) => {
  const treeState = get(this.localTreeStateAtom);
  const isFocused = treeState.focusedNodeId === nodeid;
  const focusType = get(focusManager.focusType);
  return isFocused && focusType === "node";
});
```

This single change coordinates the entire system:
- Layout can set `focusedNodeId` freely
- The reactive chain runs normally
- But `isFocused` returns `false` if focus manager says "waveai"
- Block's two-step effect doesn't run
- Physical DOM focus stays with Wave AI
## Layout Focus Coordination

**File**: [`frontend/layout/lib/layoutModel.ts`](frontend/layout/lib/layoutModel.ts)

**Critical Integration**: When layout operations claim focus, they must update the focus manager synchronously.

```typescript
treeReducer(action: LayoutTreeAction, setState = true): boolean {
  // Process the action (mutates this.treeState)
  switch (action.type) {
    case LayoutTreeActionType.InsertNode:
      insertNode(this.treeState, action);
      // If inserting with focus, claim focus from Wave AI
      if ((action as LayoutTreeInsertNodeAction).focused) {
        focusManager.requestNodeFocus();
      }
      break;
      
    case LayoutTreeActionType.InsertNodeAtIndex:
      insertNodeAtIndex(this.treeState, action);
      if ((action as LayoutTreeInsertNodeAtIndexAction).focused) {
        focusManager.requestNodeFocus();
      }
      break;
      
    case LayoutTreeActionType.FocusNode:
      focusNode(this.treeState, action);
      // Explicit focus change always claims focus
      focusManager.requestNodeFocus();
      break;
      
    case LayoutTreeActionType.MagnifyNodeToggle:
      magnifyNodeToggle(this.treeState, action);
      // Magnifying also focuses the node
      focusManager.requestNodeFocus();
      break;
      
    // ... other cases don't affect focus
  }
  
  if (setState) {
    this.updateTree();
    this.setter(this.localTreeStateAtom, { ...this.treeState });
    this.persistToBackend();
  }
  
  return true;
}
```

**Why This Works:**
1. `focusManager.requestNodeFocus()` updates `focusType` synchronously
2. Called BEFORE atoms commit (still in same function)
3. When `localTreeStateAtom` commits, `isFocused` sees the new `focusType`
4. Both updates happen in same tick → React sees consistent state
5. No race conditions, no flash

**Order of Operations:**
```
Cmd+n pressed
  ↓
treeReducer() executes
  ↓
1. insertNode() mutates layoutState.focusedNodeId
2. focusManager.requestNodeFocus() updates focusType
3. setter(localTreeStateAtom) commits tree state
  ↓
[All synchronous - single call stack]
  ↓
React re-renders with both updates applied
  ↓
isFocused sees: focusedNodeId = newNode AND focusType = "node"
  ↓
Two-step effect grants physical focus
```


## Keyboard Navigation Integration

**File**: [`frontend/app/store/keymodel.ts`](frontend/app/store/keymodel.ts)

Use focus manager instead of direct atom checks:

```typescript
function switchBlockInDirection(tabId: string, direction: NavigateDirection) {
  const layoutModel = getLayoutModelForTabById(tabId);
  const focusType = focusManager.getFocusType();

  if (direction === NavigateDirection.Left) {
    const numBlocks = globalStore.get(layoutModel.numLeafs);
    if (focusType === "waveai") {
      return;
    }
    if (numBlocks === 1) {
      focusManager.requestWaveAIFocus();
      return;
    }
  }

  // For right navigation, switch from Wave AI to blocks
  if (direction === NavigateDirection.Right && focusType === "waveai") {
    focusManager.requestNodeFocus();
    return;
  }

  // Rest of navigation logic...
}
```

## Focus Flow

### Complete Flow (Single Tick, No Flash)

```
User presses Cmd+n
  ↓
treeReducer() called
  ↓
1. insertNode(focused: true) - SYNCHRONOUS
   - layoutState.focusedNodeId = newNode
  ↓
2. setter(localTreeStateAtom, { ...treeState }) - SYNCHRONOUS
   - Atom updated immediately
  ↓
3. persistToBackend() - ASYNC (fire-and-forget)
  ↓
[All in same tick - no intermediate renders]
  ↓
React re-renders (batched update)
  ↓
isFocused recalculates:
  - get(localTreeStateAtom) → focusedNodeId = newNode ✓
  - get(focusType) → checks current focus type
  - Returns TRUE if focusType === "node"
  ↓
useLayoutEffect #1: setBlockClicked(true)
  ↓
useLayoutEffect #2: setFocusTarget()
  ↓
Physical DOM focus granted ✓
```

**Why there's no flash:**
- Local atoms update synchronously
- React batches the updates
- Everything sees consistent state in one render

## Edge Cases

### 1. Window Blur (⌘+Tab to other app)
- Textarea loses focus, triggers `handleBlur`
- `relatedTarget` is null → detected as window blur
- Focus state preserved

### 2. Selection in Wave AI
- User selects text
- Clicks elsewhere in Wave AI
- `waveAIHasSelection()` returns true
- Only visual focus updates, no DOM focus change
- Selection preserved

### 3. Copy/Paste Context Menu
- Right-click causes blur
- `relatedTarget` within Wave AI panel
- `handleBlur` detects this, doesn't revert focus

### 4. Modal Dialogs
- Modal opens, steals focus
- Modal closes → `globalRefocus()`
- Focus manager restores correct focus based on `focusType`

## Implementation Steps

### 1. Focus Manager Foundation
- Implement enhanced `focusManager.ts` with new methods
- Create `waveai-focus-utils.ts` with selection utilities
- Add data attributes to Wave AI panel

### 2. Wave AI Integration
- Add `onFocusCapture` to Wave AI panel
- Update `handleBlur` with selection protection
- Update `handleClick` with selection awareness

### 3. Layout Integration
- Update `isFocused` atom to check focus manager
- Update keyboard navigation to use focus manager
- Update global refocus utilities

### 4. Testing
- Test all transitions and edge cases
- Verify selection protection works
- Confirm no focus ring flashing

## Files to Create/Modify

### New Files
- `frontend/app/aipanel/waveai-focus-utils.ts` - Focus utilities for Wave AI

### Modified Files
- [`frontend/app/store/focusManager.ts`](frontend/app/store/focusManager.ts) - Enhanced with new methods
- [`frontend/app/aipanel/aipanel.tsx`](frontend/app/aipanel/aipanel.tsx) - Add capture phase, improve click handler
- [`frontend/app/aipanel/aipanelinput.tsx`](frontend/app/aipanel/aipanelinput.tsx) - Smart blur handling
- [`frontend/layout/lib/layoutModel.ts`](frontend/layout/lib/layoutModel.ts) - Update isFocused atom AND add focus manager calls in treeReducer
- [`frontend/app/store/keymodel.ts`](frontend/app/store/keymodel.ts) - Use focus manager for navigation

## Testing Checklist

- [ ] Select text in Wave AI, click elsewhere in Wave AI → selection preserved
- [ ] Click Wave AI panel (not input) → focus moves to Wave AI
- [ ] Click block while in Wave AI (no selection) → focus moves to block
- [ ] Press Left arrow in single block → Wave AI focused
- [ ] Press Right arrow in Wave AI → block focused
- [ ] Window blur (⌘+Tab) → focus state preserved
- [ ] Open context menu in Wave AI → doesn't lose focus
- [ ] Modal opens/closes → focus restores correctly

## Benefits

1. **Selection protection** - Wave AI selections preserved like blocks
2. **No focus flash** - Capture phase provides immediate visual feedback
3. **Robust blur handling** - Smart detection of where focus is going
4. **Unified model** - Single source of truth simplifies reasoning
5. **Simple reactivity** - Everything updates synchronously in one tick
6. **No timing issues** - Local atoms eliminate race conditions
