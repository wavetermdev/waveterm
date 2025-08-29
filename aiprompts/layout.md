# Wave Terminal Layout System Architecture

The Wave Terminal layout system is a sophisticated tile-based layout engine built with React, TypeScript, and Jotai state management. It provides a flexible, drag-and-drop interface for arranging terminal blocks and other content in complex layouts.

## Overview

The layout system manages a tree of `LayoutNode` objects that represent the hierarchical structure of content. Each node can either be:
- **Leaf node**: Contains actual content (block data)  
- **Container node**: Contains child nodes with a specific flex direction

The system uses CSS Flexbox for positioning but maintains its own tree structure for state management, drag-and-drop operations, and complex layout manipulations.

## Core Architecture

### File Structure

```
frontend/layout/lib/
├── TileLayout.tsx          # Main React component
├── layoutAtom.ts           # Jotai state management  
├── layoutModel.ts          # Core model class
├── layoutModelHooks.ts     # React hooks for integration
├── layoutNode.ts           # Node manipulation functions
├── layoutTree.ts           # Tree operation functions
├── nodeRefMap.ts           # DOM reference tracking
├── types.ts                # Type definitions
├── utils.ts                # Utility functions
└── tilelayout.scss         # Styling
```

## Key Data Structures

### LayoutNode

The fundamental building block of the layout system:

```typescript
interface LayoutNode {
    id: string;                    // Unique identifier
    data?: TabLayoutData;          // Content data (only for leaf nodes)
    children?: LayoutNode[];       // Child nodes (only for containers)
    flexDirection: FlexDirection;  // "row" or "column"
    size: number;                  // Flex size (0-100)
}
```

**Key Rules:**
- Either `data` OR `children` must be defined, never both
- Leaf nodes have `data`, container nodes have `children`
- All nodes have a `flexDirection` that determines layout axis
- `size` represents the relative flex size within the parent

### LayoutTreeState

The complete state of the layout:

```typescript
interface LayoutTreeState {
    rootNode: LayoutNode;                    // Root of the tree
    focusedNodeId?: string;                  // Currently focused node
    magnifiedNodeId?: string;                // Currently magnified node
    leafOrder?: LeafOrderEntry[];            // Computed leaf ordering
    pendingBackendActions: LayoutActionData[]; // Actions from backend
    generation: number;                      // State version number
}
```

**Generation System:**
- Incremented on every state change
- Used for optimistic updates and conflict resolution
- Prevents stale state overwrites

### NodeModel

Runtime model for individual nodes, providing React-friendly state:

```typescript
interface NodeModel {
    additionalProps: Atom<LayoutNodeAdditionalProps>;
    innerRect: Atom<CSSProperties>;
    blockNum: Atom<number>;
    nodeId: string;
    blockId: string;
    isFocused: Atom<boolean>;
    isMagnified: Atom<boolean>;
    isEphemeral: Atom<boolean>;
    toggleMagnify: () => void;
    focusNode: () => void;
    onClose: () => void;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
    // ... additional state and methods
}
```

## Core Classes

### LayoutModel

The central orchestrator that manages the entire layout system:

**Key Responsibilities:**
- Maintains tree state through Jotai atoms
- Processes layout actions (move, resize, insert, delete)
- Computes layout positions and transforms
- Manages drag-and-drop operations
- Handles resize operations
- Provides node models for React components

**State Management:**
```typescript
class LayoutModel {
    treeStateAtom: WritableLayoutTreeStateAtom;  // Persistent state
    leafs: PrimitiveAtom<LayoutNode[]>;          // Computed leaf nodes
    additionalProps: PrimitiveAtom<Record<string, LayoutNodeAdditionalProps>>;
    pendingTreeAction: AtomWithThrottle<LayoutTreeAction>;
    activeDrag: PrimitiveAtom<boolean>;
    // ... many more atoms for different aspects
}
```

**Action Processing:**
The model uses a reducer pattern to process actions:
```typescript
treeReducer(action: LayoutTreeAction) {
    switch (action.type) {
        case LayoutTreeActionType.Move:
            moveNode(this.treeState, action);
            break;
        case LayoutTreeActionType.InsertNode:
            insertNode(this.treeState, action);
            break;
        // ... handle all action types
    }
    this.updateTree(); // Recompute derived state
}
```

## Layout Actions

The system uses a comprehensive action system for all modifications:

### Action Types

```typescript
enum LayoutTreeActionType {
    ComputeMove = "computemove",      // Preview move operation
    Move = "move",                    // Execute move
    Swap = "swap",                    // Swap two nodes
    ResizeNode = "resize",            // Resize node(s)
    InsertNode = "insert",            // Insert new node
    InsertNodeAtIndex = "insertatindex", // Insert at specific index
    DeleteNode = "delete",            // Remove node
    FocusNode = "focus",              // Change focus
    MagnifyNodeToggle = "magnify",    // Toggle magnification
    SplitHorizontal = "splithorizontal", // Split horizontally
    SplitVertical = "splitvertical",  // Split vertically
    // ... more actions
}
```

### Action Flow

1. **User Interaction** → Action triggered
2. **Action Validation** → Check if operation is valid
3. **Tree Modification** → Update `LayoutTreeState`
4. **State Propagation** → Update Jotai atoms
5. **Layout Computation** → Recalculate positions
6. **React Re-render** → Update UI

### Example: Move Operation

```typescript
// 1. Compute operation during drag
const computeAction: LayoutTreeComputeMoveNodeAction = {
    type: LayoutTreeActionType.ComputeMove,
    nodeId: targetNodeId,
    nodeToMoveId: draggedNodeId,
    direction: DropDirection.Right
};

// 2. Execute on drop
const moveAction: LayoutTreeMoveNodeAction = {
    type: LayoutTreeActionType.Move,
    parentId: newParentId,
    index: insertIndex,
    node: nodeToMove
};
```

## Drag and Drop System

The layout system implements a sophisticated drag-and-drop interface using `react-dnd`.

### Drop Direction Logic

When dragging over a node, the system determines drop direction based on cursor position:

```typescript
enum DropDirection {
    Top = 0, Right = 1, Bottom = 2, Left = 3,
    OuterTop = 4, OuterRight = 5, OuterBottom = 6, OuterLeft = 7,
    Center = 8
}
```

**Drop Zones:**
- **Inner zones** (Top/Right/Bottom/Left): Insert within the target node
- **Outer zones**: Insert in the target's parent
- **Center**: Swap nodes

### Drag Preview

The system generates drag previews by:
1. Rendering content to an off-screen element
2. Converting to PNG using `html-to-image`
3. Using the image as the drag preview

## Resize System

### Resize Handles

Resize handles are dynamically positioned between adjacent nodes:

```typescript
interface ResizeHandleProps {
    id: string;
    parentNodeId: string;
    parentIndex: number;
    centerPx: number;              // Handle position
    transform: CSSProperties;      // CSS positioning
    flexDirection: FlexDirection;  // Handle orientation
}
```

### Resize Operation

1. **Handle Drag Start** → Store resize context
2. **Drag Move** → Compute new sizes based on cursor position
3. **Throttled Updates** → Update node sizes (10ms throttle)
4. **Drag End** → Commit final sizes

## Layout Computation

The system computes absolute positions from the tree structure:

### Process

1. **Tree Walk** → Traverse from root to leaves
2. **Flexbox Simulation** → Calculate container and child sizes
3. **Position Calculation** → Compute absolute positions
4. **Transform Generation** → Create CSS transforms
5. **Handle Positioning** → Place resize handles between nodes

### Key Functions

- [`updateTreeHelper()`](frontend/layout/lib/layoutModel.ts:638) - Main layout computation
- [`computeNodeFromProps()`](frontend/layout/lib/layoutModel.ts:718) - Individual node positioning
- [`setTransform()`](frontend/layout/lib/utils.ts:61) - CSS transform generation

## Node Management

### Node Operations

The [`layoutNode.ts`](frontend/layout/lib/layoutNode.ts) file provides core node manipulation:

```typescript
// Create new node
newLayoutNode(flexDirection?, size?, children?, data?)

// Tree traversal
findNode(node, id)
findParent(node, id)
walkNodes(node, beforeCallback?, afterCallback?)

// Modifications
addChildAt(node, index, ...children)
removeChild(parent, childToRemove)
balanceNode(node) // Optimize tree structure
```

### Tree Balancing

The system automatically optimizes the tree structure:
- Removes unnecessary intermediate nodes
- Flattens single-child containers
- Ensures valid flex directions

## State Synchronization

### Frontend ↔ Backend Sync

The layout state synchronizes with the backend through:

1. **`layoutAtom.ts`** - Jotai atom that wraps backend state
2. **Generation tracking** - Prevents state conflicts
3. **Pending actions** - Backend-initiated changes
4. **Leaf order** - Frontend-computed ordering sent to backend

### Atom Structure

```typescript
const layoutTreeStateAtom = atom(
    (get) => {
        // Read from backend
        const layoutState = get(backendLayoutStateAtom);
        return transformToTreeState(layoutState);
    },
    (get, set, treeState) => {
        // Write to backend
        if (generationNewer(treeState)) {
            set(backendLayoutStateAtom, transformFromTreeState(treeState));
        }
    }
);
```

## Special Features

### Magnification

Nodes can be magnified to take up the full layout space:
- Magnified nodes appear above others (higher z-index)
- Only one node can be magnified at a time
- Animation smoothly transitions between normal and magnified states

### Ephemeral Nodes

Temporary nodes that aren't part of the persistent tree:
- Used for preview/temporary content
- Automatically cleaned up
- Appear above the normal layout

### Focus Management

- One node can be focused at a time
- Focus affects keyboard navigation
- Integrates with the terminal's block focus system

## Integration Points

### React Integration

**Hooks:**
- [`useTileLayout()`](frontend/layout/lib/layoutModelHooks.ts:51) - Main hook for layout setup
- [`useNodeModel()`](frontend/layout/lib/layoutModelHooks.ts:65) - Get node model for component
- [`useDebouncedNodeInnerRect()`](frontend/layout/lib/layoutModelHooks.ts:69) - Animated positioning

### Content Rendering

The layout system is content-agnostic through render callbacks:

```typescript
interface TileLayoutContents {
    renderContent: (nodeModel: NodeModel) => React.ReactNode;
    renderPreview?: (nodeModel: NodeModel) => React.ReactElement;
    onNodeDelete?: (data: TabLayoutData) => Promise<void>;
}
```

### Performance Optimizations

1. **Memoization** - Extensive use of `React.memo()` and `useMemo()`
2. **Throttling** - Resize and drag operations throttled to 10-50ms
3. **Transform-based positioning** - Uses CSS transforms for performance
4. **Split atoms** - Jotai `splitAtom()` for efficient array updates
5. **Selective re-rendering** - Only affected components re-render

## Common Patterns

### Adding New Actions

1. Define action type in [`types.ts`](frontend/layout/lib/types.ts)
2. Implement handler in [`layoutTree.ts`](frontend/layout/lib/layoutTree.ts)
3. Add case to [`LayoutModel.treeReducer()`](frontend/layout/lib/layoutModel.ts:330)
4. Update generation and call `updateTree()`

### Extending Node Properties

1. Add to `LayoutNodeAdditionalProps` in [`types.ts`](frontend/layout/lib/types.ts)
2. Compute in [`updateTreeHelper()`](frontend/layout/lib/layoutModel.ts:638)
3. Access via `nodeModel.additionalProps`

### Custom Layout Behaviors

Override or extend layout computation by:
1. Modifying [`computeNodeFromProps()`](frontend/layout/lib/layoutModel.ts:718)
2. Adding custom CSS transforms
3. Implementing special handling in action reducers

## Error Handling

The system includes extensive validation:
- Node structure validation
- Action parameter checking
- Tree consistency checks
- Graceful degradation on errors

## Testing

The layout system includes comprehensive tests:
- [`layoutNode.test.ts`](frontend/layout/tests/layoutNode.test.ts) - Node operations
- [`layoutTree.test.ts`](frontend/layout/tests/layoutTree.test.ts) - Tree operations  
- [`utils.test.ts`](frontend/layout/tests/utils.test.ts) - Utility functions

## Debugging

For debugging layout issues:
1. Check `treeState.generation` for state changes
2. Inspect `additionalProps` for computed layout data
3. Use browser dev tools to examine CSS transforms
4. Enable console logging in action reducers

The layout system is complex but well-structured, providing a powerful foundation for Wave Terminal's dynamic layout capabilities.