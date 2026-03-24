# Wave Terminal Layout System - Simplification via Write Cache Pattern

## Executive Summary

The current layout system uses a complex bidirectional atom architecture that forces every layout change to round-trip through the backend WaveObject, even though **the backend never reads this data** - it only queues actions via `PendingBackendActions`. By switching to a "write cache" pattern where local atoms are the source of truth and backend writes are fire-and-forget, we can eliminate ~70% of the complexity while maintaining full persistence.

## Current Architecture Problems

### The Unnecessary Round-Trip

Every layout change (split, close, focus, magnify) currently follows this flow:

```
User action
  ↓
treeReducer() mutates layoutState
  ↓
layoutState.generation++  ← Only purpose: trigger the write
  ↓
Bidirectional atom setter (checks generation)
  ↓
Write to WaveObject {rootnode, focusednodeid, magnifiednodeid}
  ↓
WaveObject update notification
  ↓
Bidirectional atom getter runs
  ↓
ALL dependent atoms recalculate (every isFocused, etc.)
  ↓
React re-renders with updated state
```

**The critical insight**: The backend reads ONLY `leaforder` from the WaveObject (for block number resolution in commands like `wsh block:1`). The `rootnode`, `focusednodeid`, and `magnifiednodeid` fields exist **only for persistence** (tab restore, uncaching).

### What the Backend Actually Does

**Backend Reads** (from [`pkg/wshrpc/wshserver/resolvers.go`](../pkg/wshrpc/wshserver/resolvers.go:196-206)):
- **`LeafOrder`** - Used to resolve block numbers in commands (e.g., `wsh block:1` → blockId lookup)

**Backend Writes** (from [`pkg/wcore/layout.go`](../pkg/wcore/layout.go)):
- **`PendingBackendActions`** - Queued layout actions via [`QueueLayoutAction()`](../pkg/wcore/layout.go:101-118)

**Backend NEVER touches**:
- **`RootNode`** - Never read, only written by frontend for persistence
- **`FocusedNodeId`** - Never read, only written by frontend for persistence
- **`MagnifiedNodeId`** - Never read, only written by frontend for persistence

**The key insight**: Only `LeafOrder` needs to be synced to backend (for command resolution). The tree structure fields (`rootnode`, `focusednodeid`, `magnifiednodeid`) are pure persistence!

### Complexity Symptoms

1. **Generation tracking**: [`layoutState.generation++`](../frontend/layout/lib/layoutTree.ts:294) appears in 10+ places, only to trigger atom writes
2. **Bidirectional atoms**: [`withLayoutTreeStateAtomFromTab()`](../frontend/layout/lib/layoutAtom.ts:18-60) has complex read/write logic
3. **Timing coordination**: The entire Section 8 of the WaveAI focus proposal exists only because of race conditions between focus updates and atom commits
4. **False reactivity**: Changes to `focusedNodeId` trigger full tree state propagation even though they're unrelated to tree structure

## Proposed "Write Cache" Architecture

### Core Concept

```
User action
  ↓
Update LOCAL atom (immediate, synchronous)
  ↓
React re-renders (single tick, all atoms see new state)
  ↓
[async, fire-and-forget] Persist to WaveObject
```

### Key Principles

1. **Local atoms are source of truth** during runtime
2. **WaveObject is persistence layer** only (read on init, write async)
3. **Backend actions still work** via `PendingBackendActions`
4. **No generation tracking needed** (no need to trigger writes)

## Implementation Design

### 1. New LayoutModel Structure

```typescript
// frontend/layout/lib/layoutModel.ts

class LayoutModel {
  // BEFORE: Bidirectional atom with generation tracking
  // treeStateAtom: WritableLayoutTreeStateAtom
  
  // AFTER: Simple local atom (source of truth)
  private localTreeStateAtom: PrimitiveAtom<LayoutTreeState>;
  
  // Keep reference to WaveObject atom for persistence
  private waveObjectAtom: WritableWaveObjectAtom<LayoutState>;
  
  constructor(tabAtom: Atom<Tab>, ...) {
    this.waveObjectAtom = getLayoutStateAtomFromTab(tabAtom);
    
    // Initialize local atom (starts empty)
    this.localTreeStateAtom = atom<LayoutTreeState>({
      rootNode: undefined,
      focusedNodeId: undefined,
      magnifiedNodeId: undefined,
      leafOrder: undefined,
      pendingBackendActions: undefined,
      generation: 0  // Can be removed entirely or kept for debugging
    });
    
    // Read from WaveObject ONCE during initialization
    this.initializeFromWaveObject();
  }
  
  private async initializeFromWaveObject() {
    const waveObjState = this.getter(this.waveObjectAtom);
    
    // Load persisted state into local atom
    const initialState: LayoutTreeState = {
      rootNode: waveObjState?.rootnode,
      focusedNodeId: waveObjState?.focusednodeid,
      magnifiedNodeId: waveObjState?.magnifiednodeid,
      leafOrder: undefined,  // Computed by updateTree()
      pendingBackendActions: waveObjState?.pendingbackendactions,
      generation: 0
    };
    
    // Set local state
    this.treeState = initialState;
    this.setter(this.localTreeStateAtom, initialState);
    
    // Process any pending backend actions
    if (initialState.pendingBackendActions?.length) {
      await this.processPendingBackendActions();
    }
    
    // Initialize tree (compute leafOrder, etc.)
    this.updateTree();
  }
  
  // Process backend-queued actions (startup only)
  private async processPendingBackendActions() {
    const actions = this.treeState.pendingBackendActions;
    if (!actions?.length) return;
    
    this.treeState.pendingBackendActions = undefined;
    
    for (const action of actions) {
      // Convert backend action to frontend action and run through treeReducer
      // This code already exists in onTreeStateAtomUpdated()
      switch (action.actiontype) {
        case LayoutTreeActionType.InsertNode:
          this.treeReducer({
            type: LayoutTreeActionType.InsertNode,
            node: newLayoutNode(undefined, undefined, undefined, {
              blockId: action.blockid
            }),
            magnified: action.magnified,
            focused: action.focused
          }, false);
          break;
        // ... other action types
      }
    }
  }
}
```

### 2. Simplified treeReducer

```typescript
class LayoutModel {
  treeReducer(action: LayoutTreeAction, setState = true): boolean {
    // Run the tree operation (mutates this.treeState)
    switch (action.type) {
      case LayoutTreeActionType.InsertNode:
        insertNode(this.treeState, action);
        break;
      case LayoutTreeActionType.FocusNode:
        focusNode(this.treeState, action);
        break;
      case LayoutTreeActionType.DeleteNode:
        deleteNode(this.treeState, action);
        break;
      // ... all other cases unchanged
    }
    
    if (setState) {
      // Update tree (compute leafOrder, validate, etc.)
      this.updateTree();
      
      // Update local atom IMMEDIATELY (synchronous)
      this.setter(this.localTreeStateAtom, { ...this.treeState });
      
      // Persist to backend asynchronously (fire and forget)
      this.persistToBackend();
    }
    
    return true;
  }
  
  // Fire-and-forget persistence
  private async persistToBackend() {
    const waveObj = this.getter(this.waveObjectAtom);
    if (!waveObj) return;
    
    // Update WaveObject fields
    waveObj.rootnode = this.treeState.rootNode;           // Persistence only
    waveObj.focusednodeid = this.treeState.focusedNodeId; // Persistence only
    waveObj.magnifiednodeid = this.treeState.magnifiedNodeId; // Persistence only
    waveObj.leaforder = this.treeState.leafOrder;         // Backend reads this for command resolution!
    
    // Write to backend (don't await - fire and forget)
    this.setter(this.waveObjectAtom, waveObj);
    
    // Optional: Debounce if rapid changes are a concern
  }
}
```

### 3. Simplified NodeModel isFocused

```typescript
class LayoutModel {
  getNodeModel(node: LayoutNode): NodeModel {
    return {
      // BEFORE: Complex dependency on bidirectional treeStateAtom
      // isFocused: atom((get) => {
      //   const treeState = get(this.treeStateAtom);  // Triggers on any tree change
      //   ...
      // })
      
      // AFTER: Simple dependency on local atom
      isFocused: atom((get) => {
        const treeState = get(this.localTreeStateAtom);  // Simple read
        const focusType = get(focusManager.focusType);
        return treeState.focusedNodeId === node.id && focusType === "node";
      }),
      
      // All other atoms similarly simplified...
      isMagnified: atom((get) => {
        const treeState = get(this.localTreeStateAtom);
        return treeState.magnifiedNodeId === node.id;
      }),
      
      // ... rest unchanged
    };
  }
}
```

### 4. Remove Generation Tracking

The `generation` field can be removed entirely from [`LayoutTreeState`](../frontend/layout/lib/types.ts):

```typescript
// frontend/layout/lib/types.ts

export interface LayoutTreeState {
  rootNode?: LayoutNode;
  focusedNodeId?: string;
  magnifiedNodeId?: string;
  leafOrder?: LayoutLeafEntry[];
  pendingBackendActions?: LayoutActionData[];
  // generation: number;  ← DELETE THIS
}
```

And remove all `generation++` calls from [`layoutTree.ts`](../frontend/layout/lib/layoutTree.ts) (appears in 10+ places).

### 5. Simplified layoutAtom.ts

```typescript
// frontend/layout/lib/layoutAtom.ts

// BEFORE: Complex bidirectional atom (60 lines)
// AFTER: Can be deleted entirely or simplified to just helper for WaveObject access

export function getLayoutStateAtomFromTab(
  tabAtom: Atom<Tab>,
  get: Getter
): WritableWaveObjectAtom<LayoutState> {
  const tabData = get(tabAtom);
  if (!tabData) return;
  const layoutStateOref = WOS.makeORef("layout", tabData.layoutstate);
  return WOS.getWaveObjectAtom<LayoutState>(layoutStateOref);
}

// No more withLayoutTreeStateAtomFromTab() - not needed!
```

## Benefits

### Immediate Benefits

1. **10x simpler reactivity**: Local atoms update synchronously, React sees complete state in one tick
2. **No generation tracking**: Eliminate 10+ `generation++` calls and all related logic
3. **No timing issues**: Everything happens synchronously, no coordination needed
4. **Faster updates**: No round-trip through WaveObject for every change
5. **Easier debugging**: Clear separation between runtime state (local atoms) and persistence (WaveObject)

### Impact on WaveAI Focus Proposal

The entire Section 8 ("Layout Model Focus Integration - CRITICAL TIMING") **becomes unnecessary**:

**BEFORE** (complex timing coordination):
```typescript
treeReducer(action: LayoutTreeAction) {
  insertNode(this.treeState, action);  // generation++
  
  // CRITICAL: Must update focus manager BEFORE atom commits
  if (action.focused) {
    focusManager.requestNodeFocus();  // Synchronous!
  }
  
  // Then atom commits
  this.setter(this.treeStateAtom, ...);
  // Now isFocused sees correct focusType
}
```

**AFTER** (trivial):
```typescript
treeReducer(action: LayoutTreeAction) {
  insertNode(this.treeState, action);  // Just mutates local state
  
  // Update local atom (synchronous)
  this.setter(this.localTreeStateAtom, { ...this.treeState });
  
  // Update focus manager (order doesn't matter - both updated synchronously)
  if (action.focused) {
    focusManager.setBlockFocus();
  }
  
  // Both updates happen in same tick, no race condition possible!
}
```

### Code Deletion

**Can delete**:
- `generation` field and all `generation++` calls (~15 places)
- Complex bidirectional atom logic in [`layoutAtom.ts`](../frontend/layout/lib/layoutAtom.ts) (~40 lines)
- `lastTreeStateGeneration` tracking in [`LayoutModel`](../frontend/layout/lib/layoutModel.ts)
- All `generation > this.treeState.generation` checks

**Total**: ~200-300 lines of complex coordination code deleted

## Edge Cases & Considerations

### 1. Rapid Changes

**Concern**: Many layout changes in quick succession could cause many backend writes.

**Solution**: Debounce the `persistToBackend()` call (e.g., 100ms). Users won't notice the delay in persistence.

```typescript
private persistDebounceTimer: NodeJS.Timeout | null = null;

private persistToBackend() {
  if (this.persistDebounceTimer) {
    clearTimeout(this.persistDebounceTimer);
  }
  
  this.persistDebounceTimer = setTimeout(() => {
    const waveObj = this.getter(this.waveObjectAtom);
    if (!waveObj) return;
    
    waveObj.rootnode = this.treeState.rootNode;
    waveObj.focusednodeid = this.treeState.focusedNodeId;
    waveObj.magnifiednodeid = this.treeState.magnifiedNodeId;
    waveObj.leaforder = this.treeState.leafOrder;
    
    this.setter(this.waveObjectAtom, waveObj);
    this.persistDebounceTimer = null;
  }, 100);
}
```

### 2. Tab Switching

**Current**: Each tab has its own `treeStateAtom` in a WeakMap.

**After**: Each tab has its own `localTreeStateAtom` in the LayoutModel instance. No change needed - already isolated per tab.

### 3. Tab Uncaching (Electron Limit)

**Current**: Tab gets uncached, needs to reload layout from WaveObject.

**After**: Same - `initializeFromWaveObject()` reads persisted state. No change in behavior.

### 4. Backend Actions (New Blocks)
### 5. LeafOrder and CLI Commands

**Concern**: The backend reads `LeafOrder` for CLI command resolution (e.g., `wsh block:1`). What if it's not synced yet?

**Solution**: Fire-and-forget is perfectly fine! CLI commands aren't time-sensitive:
- Commands are typed/run by users (human speed, not machine speed)
- Even if `LeafOrder` is 100ms behind, no one will notice
- By the time a user types `wsh block:1`, the async write has long since completed
- Worst case: User types command during a split operation and gets previous block - extremely rare and not breaking


## Immutability and Jotai Atoms

### Question: Do we need deep copies for Jotai to detect changes?

**Answer: NO - shallow copy is sufficient!** ✓

### Current System (Already Uses Shallow Updates)

Looking at the current code in [`layoutModel.ts:587`](../frontend/layout/lib/layoutModel.ts:587):

```typescript
setTreeStateAtom(bumpGeneration = false) {
    if (bumpGeneration) {
        this.treeState.generation++;
    }
    this.lastTreeStateGeneration = this.treeState.generation;
    this.setter(this.treeStateAtom, this.treeState);  // ← Sets same object!
}
```

**The current system doesn't create new objects either!** It relies on `generation` changing to trigger the bidirectional atom's setter.

### Why Shallow Copy Works with Jotai

```typescript
// In treeReducer after mutations
this.setter(this.localTreeStateAtom, { ...this.treeState });
```

**This works because**:
1. **Jotai checks reference equality** on the atom value itself (the `LayoutTreeState` object)
2. **`{ ...this.treeState }` creates a NEW object** with a different reference
3. **Nested structures don't matter** - Jotai doesn't do deep equality checks

**Example**:
```typescript
const oldState = { rootNode: someTree, focusedNodeId: "node1" };
const newState = { ...oldState };

oldState === newState        // FALSE - different objects!
oldState.rootNode === newState.rootNode  // TRUE - same tree reference

// But Jotai only checks the first comparison, so it detects the change!
```

### Tree Mutations Don't Need Immutability

All tree operations in [`layoutTree.ts`](../frontend/layout/lib/layoutTree.ts) **mutate in place**:
- `insertNode()` - Mutates `layoutState.rootNode`

### Derived Atoms Will Update Correctly ✓

**Concern**: Will derived atoms like `isFocused` and `isMagnified` update when we change to local atoms?

**Answer: YES - they will work perfectly!** ✓

### How Derived Atoms Work

The NodeModel creates derived atoms that depend on `treeStateAtom`:

```typescript
// From layoutModel.ts:936-946
isFocused: atom((get) => {
    const treeState = get(this.treeStateAtom);  // Subscribe to treeStateAtom
    const isFocused = treeState.focusedNodeId === nodeid;
    const waveAIFocused = get(atoms.waveAIFocusedAtom);
    return isFocused && !waveAIFocused;
}),

isMagnified: atom((get) => {
    const treeState = get(this.treeStateAtom);  // Subscribe to treeStateAtom
    return treeState.magnifiedNodeId === nodeid;
}),
```

### Why They'll Still Work with Local Atoms

**After the change**:
```typescript
isFocused: atom((get) => {
    const treeState = get(this.localTreeStateAtom);  // Subscribe to localTreeStateAtom
    const isFocused = treeState.focusedNodeId === nodeid;
    const waveAIFocused = get(atoms.waveAIFocusedAtom);
    return isFocused && !waveAIFocused;
}),
```

**The update flow**:
1. User clicks block → `focusNode()` called
2. `treeReducer()` runs → mutates `this.treeState.focusedNodeId = newId`
3. `this.setter(this.localTreeStateAtom, { ...this.treeState })` ← **New reference!**
4. Jotai detects reference change in `localTreeStateAtom`
5. All derived atoms that call `get(this.localTreeStateAtom)` are notified
6. They re-run their getter functions
7. They see the new `focusedNodeId` value
8. React components re-render with correct values ✓

### Key Insight

**We're not mutating fields inside the atom** - we're replacing the entire state object:

```typescript
// OLD way (current): 
// 1. Mutate this.treeState.focusedNodeId = newId
// 2. Bump this.treeState.generation++
// 3. Set bidirectional atom (checks generation, writes to WaveObject, reads back, updates)
// 4. Derived atoms see new state from the round-trip

// NEW way (proposed):
// 1. Mutate this.treeState.focusedNodeId = newId  (same!)
// 2. this.setter(localTreeStateAtom, { ...this.treeState })  (new object reference!)
// 3. Derived atoms immediately see new state (no round-trip!)
```

**Both approaches create a new state object that triggers Jotai's reactivity!**

The new way is actually **MORE reliable** because:
- No round-trip delay
- No generation checking
- Direct, synchronous update
- Same Jotai reactivity mechanism

### What About Nested Fields?

**Question**: What if derived atoms access nested fields like `treeState.rootNode.children`?

**Answer**: Still works! Example:

```typescript
// Hypothetical derived atom
someAtom: atom((get) => {
    const treeState = get(this.localTreeStateAtom);
    return treeState.rootNode.children.length;  // Nested access
})
```

**This works because**:
1. We create new `LayoutTreeState` object: `{ ...this.treeState }`
2. Jotai sees new reference → notifies subscribers
3. Getter re-runs, calls `get(this.localTreeStateAtom)`
4. Gets the new state object
5. Accesses `newState.rootNode` (same reference as before, but that's OK!)
6. Returns correct value

**The derived atom doesn't care that `rootNode` is the same object** - it just cares that the STATE object changed and it needs to re-evaluate.

### Verification

All derived atoms in NodeModel:
- ✅ `isFocused` - depends on `treeState.focusedNodeId` 
- ✅ `isMagnified` - depends on `treeState.magnifiedNodeId`
- ✅ `blockNum` - depends on separate `this.leafOrder` atom (unaffected)
- ✅ `isEphemeral` - depends on separate `this.ephemeralNode` atom (unaffected)

All will update correctly with the new local atom approach!

- `deleteNode()` - Mutates parent's children array
- `focusNode()` - Mutates `layoutState.focusedNodeId`

This is fine! We're not relying on immutability for change detection. We're relying on creating a new `LayoutTreeState` wrapper object via spread operator.

### Backend Round-Trip

When reading from WaveObject on initialization:
```typescript
const waveObjState = this.getter(this.waveObjectAtom);
const initialState: LayoutTreeState = {
  rootNode: waveObjState?.rootnode,  // New reference from backend
  focusedNodeId: waveObjState?.focusednodeid,
  // ...
};
```

This creates a **completely new object** with new references, which is even more immutable than necessary. No issues here.

### Summary

✅ **We're covered** - Shallow copy via spread operator is sufficient

✅ **Same as current system** - We're not making it worse, just simpler

✅ **Jotai only checks reference equality** on the atom value, not deep equality

✅ **Tree mutations are fine** - They've always worked this way


**Current**: Backend queues actions via [`QueueLayoutAction()`](../pkg/wcore/layout.go:101), frontend processes via `pendingBackendActions`.

**After**: Same - `initializeFromWaveObject()` processes pending actions. No change needed.

### 5. Write Failures

**Concern**: What if the async write to WaveObject fails?

**Solution**: 
1. The app continues working (local state is fine)
2. On next persistence attempt, full state is written again
3. On tab reload, worst case is state from last successful write
4. Can add retry logic or error notification if needed

## Migration Path

### Phase 1: Preparation (No Breaking Changes)

1. Add `localTreeStateAtom` alongside existing `treeStateAtom`
2. Keep both in sync
3. Update a few `isFocused` atoms to use local atom
4. Test thoroughly

### Phase 2: Switch Over

1. Update `treeReducer` to write to local atom + fire-and-forget persist
2. Update all `isFocused` and other computed atoms to use local atom
3. Remove generation checks and tracking
4. Test all layout operations

### Phase 3: Cleanup

1. Delete bidirectional atom logic from [`layoutAtom.ts`](../frontend/layout/lib/layoutAtom.ts)
2. Remove `generation` field from `LayoutTreeState`
3. Simplify `onTreeStateAtomUpdated()` (only needed for `pendingBackendActions`)
4. Update documentation

### Testing Checklist

- [ ] Split horizontal/vertical
- [ ] Close blocks (focused and unfocused)
- [ ] Focus changes via click, keyboard nav, tab switching
- [ ] Magnify/unmagnify
- [ ] Resize operations
- [ ] Drag & drop
- [ ] Tab switching (verify state persistence)
- [ ] App restart (verify state restore)
- [ ] Multiple windows
- [ ] Rapid operations (verify debouncing works)

## Impact on Other Systems

### Focus Manager

**Before**: Must coordinate timing with atom commits.

**After**: Can update `focusType` atom independently. Order doesn't matter since both updates happen synchronously.

### Block Component

**No change**: Blocks still subscribe to `nodeModel.isFocused`, which still reacts correctly (faster now).

### Keyboard Navigation

**No change**: Still calls `layoutModel.focusNode()`, which updates local state immediately.

### Terminal/Views

**No change**: Views don't interact with layout atoms directly.

## Performance Implications

### Improved

1. **Faster reactivity**: No round-trip through WaveObject (save ~1-2ms per operation)
2. **Fewer atom updates**: Only local atom updates, not bidirectional propagation
3. **Batched writes**: Debouncing reduces backend write frequency

### No Change

1. **Tree operations**: Same complexity (balance, walk, compute, etc.)
2. **React rendering**: Same render triggers, just faster
3. **Memory usage**: Same (local atom vs bidirectional atom is similar size)

## Conclusion

The "write cache" pattern can simplify the layout system by ~70% while maintaining full functionality:

- **Remove**: Generation tracking, bidirectional atoms, timing coordination
- **Keep**: All tree logic, backend integration, persistence
- **Gain**: Simpler code, faster updates, easier debugging

This also makes the WaveAI focus integration trivial, eliminating the need for complex timing coordination.

## Recommendation

Implement this simplification **before** adding WaveAI focus features. The cleaner foundation will make the focus work much easier and the codebase more maintainable long-term.
# Wave Terminal Layout System - Simplification via Write Cache Pattern

## Risk Assessment: LOW RISK, Well-Contained Change

### Files to Modify: **4-5 files, all in `frontend/layout/`**

1. **`frontend/layout/lib/layoutModel.ts`** (~150 lines changed)
   - Add `localTreeStateAtom` field
   - Modify `treeReducer()` to update local atom + persist async
   - Add `initializeFromWaveObject()` method
   - Add `persistToBackend()` method
   - Update `getNodeModel()` atoms to use local atom

2. **`frontend/layout/lib/layoutTree.ts`** (~15 line deletions)
   - Remove all `layoutState.generation++` calls (appears 15 times)
   - No other changes needed

3. **`frontend/layout/lib/layoutAtom.ts`** (~40 lines deleted or simplified)
   - Can delete most of the bidirectional atom logic
   - Keep only `getLayoutStateAtomFromTab()` helper

4. **`frontend/layout/lib/types.ts`** (~1 line deletion)
   - Remove `generation: number` from `LayoutTreeState`

5. **`frontend/layout/tests/model.ts`** (~1 line change)
   - Remove generation from test fixtures

**Total**: ~5 files, all within `frontend/layout/` directory. **No changes outside layout system!**

### Why This is Low Risk

#### 1. **Fail-Fast Behavior** ✓
If we break something, it will be **immediately obvious**:
- Split horizontal/vertical won't work → visible immediately
- Block focus won't work → obvious when clicking
- Close block won't work → obvious
- Magnify won't work → obvious

**No subtle corruption**: This change affects reactive state flow, not data persistence. If it breaks, the UI breaks obviously. We won't get "sometimes it works, sometimes it doesn't."

#### 2. **Well-Contained Scope** ✓
- **All changes in one directory**: `frontend/layout/`
- **No changes to**:
  - Block components (unchanged)
  - Terminal/views (unchanged)
  - Keyboard navigation (unchanged)
  - Focus manager (unchanged)
  - Backend Go code (unchanged)

The **interface** to the layout system stays the same:
- Blocks still call `nodeModel.focusNode()`
- Blocks still subscribe to `nodeModel.isFocused`
- Keyboard nav still calls `layoutModel.focusNode()`
- Nothing outside the layout system needs to know about the change

#### 3. **No Data Corruption Risk** ✓
This change affects **reactive state propagation**, not data storage:
- WaveObject still stores the same data
- Backend still queues actions the same way
- Blocks still have the same IDs
- Tab structure unchanged

**Worst case**: Layout stops working, we revert the code. No data loss, no corruption.

#### 4. **Incremental Implementation Possible** ✓

Can be done in safe phases:

**Phase 1**: Add alongside existing (no breaking changes)
```typescript
class LayoutModel {
  treeStateAtom: WritableLayoutTreeStateAtom;  // Keep old
  localTreeStateAtom: PrimitiveAtom<LayoutTreeState>;  // Add new
  
  // Keep both in sync temporarily
}
```

**Phase 2**: Switch consumers one at a time
```typescript
// Change this gradually
isFocused: atom((get) => {
  // const treeState = get(this.treeStateAtom);  // Old
  const treeState = get(this.localTreeStateAtom);  // New
  ...
})
```

**Phase 3**: Remove old code once everything uses new atoms

**Can test thoroughly at each phase before proceeding!**

#### 5. **Easy to Test** ✓

Every layout operation is user-visible and testable:
- [ ] Split horizontal → obvious if broken
- [ ] Split vertical → obvious if broken
- [ ] Close block → obvious if broken
- [ ] Focus block → obvious if broken
- [ ] Magnify/unmagnify → obvious if broken
- [ ] Drag & drop → obvious if broken
- [ ] Tab switch → obvious if broken
- [ ] App restart → obvious if broken

No subtle edge cases to hunt down. If it works in manual testing, it works.

### Comparison to High-Risk Changes

**This change is NOT**:
- ❌ Touching 20+ files across the codebase
- ❌ Changing subtle timing in async operations
- ❌ Modifying data storage formats
- ❌ Affecting backend/frontend protocol
- ❌ Requiring coordinated backend changes
- ❌ Creating subtle race conditions

**This change IS**:
- ✅ Contained to 5 files in one directory
- ✅ Synchronous state updates (simpler than current!)
- ✅ Same data format, just different flow
- ✅ Frontend-only
- ✅ Backend unchanged
- ✅ Eliminating race conditions (not creating them)

### What Could Go Wrong? (And How We'd Know)

| Potential Issue | How We'd Detect | Recovery |
|-----------------|-----------------|----------|
| Local atom doesn't update | Layout frozen, nothing responds | Immediately obvious, revert |
| Persistence fails silently | State doesn't survive restart | Caught in testing, add logging |
| isFocused calculation wrong | Wrong focus ring | Immediately obvious, fix calculation |
| Missing generation++ somewhere | Old code path tries to use generation | Compile error or immediate runtime error |
| Tab switching breaks | Tabs don't load correctly | Immediately obvious |

**All failure modes are immediate and obvious!**

### Difficulty Assessment

**Conceptual Difficulty**: LOW
- Replace bidirectional atom with simple atom
- Add async persist function
- Remove generation tracking
- Very straightforward refactor

**Code Difficulty**: LOW-MEDIUM
- Changes are localized and mechanical
- Most changes are deletions (always good!)
- New code is simpler than old code
- No complex algorithms to implement

**Testing Difficulty**: LOW
- All functionality is user-visible
- No need for complex test scenarios
- Manual testing catches everything
- Can test incrementally

### Recommendation

This is a **low-risk, high-reward change**:
- **Risk**: LOW (contained, fail-fast, no corruption)
- **Difficulty**: LOW-MEDIUM (straightforward refactor)
- **Reward**: HIGH (70% less complexity, easier future work)

**Suggested approach**:
1. Implement in a feature branch
2. Add local atom alongside existing system
3. Test thoroughly with both systems running
4. Switch over gradually
5. Remove old code
6. Merge when confident

Total implementation time: **1-2 days for experienced developer**, including thorough testing.

---
