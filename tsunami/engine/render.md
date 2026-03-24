# Tsunami Rendering Engine

The Tsunami rendering engine implements a React-like component system with virtual DOM reconciliation. It maintains a persistent shadow component tree that efficiently updates in response to new VDom input, similar to React's Fiber architecture.

## Core Architecture

### Two-Phase VDom System

Tsunami uses separate types for different phases of the rendering pipeline:

- **VDomElem**: Input format used by developers (JSX-like elements created with `vdom.H()`)
- **ComponentImpl**: Internal shadow tree that maintains component identity and state across renders
- **RenderedElem**: Output format sent to the frontend with populated WaveIds

This separation mirrors React's approach where JSX elements, Fiber nodes, and DOM operations use different data structures optimized for their specific purposes.

### ComponentImpl: The Shadow Tree

The `ComponentImpl` structure is Tsunami's equivalent to React's Fiber nodes. It maintains a persistent tree that survives between renders, preserving component identity, state, and lifecycle information.

Each ComponentImpl contains:

- **Identity fields**: WaveId (unique identifier), Tag (component type), Key (for reconciliation)
- **State management**: Hooks array for React-like state and effects
- **Content organization**: Exactly one of three mutually exclusive patterns

## Three Component Patterns

The engine organizes components into three distinct patterns, each using different fields in ComponentImpl:

### Pattern 1: Text Components

```go
Text string                    // Text content (Pattern 1: text nodes only)
Children = nil                 // Not used
RenderedComp = nil            // Not used
```

Used for `#text` components that render string content directly. These are the leaf nodes of the component tree.

**Example**: `vdom.H("#text", nil, "Hello World")` creates a ComponentImpl with `Text = "Hello World"`

### Pattern 2: Base/DOM Elements

```go
Text = ""                      // Not used
Children []*ComponentImpl      // Child components (Pattern 2: containers only)
RenderedComp = nil            // Not used
```

Used for HTML elements, fragments, and Wave-specific elements that act as containers. These components render multiple children but don't transform into other component types.

**Example**: `vdom.H("div", nil, child1, child2)` creates a ComponentImpl with `Children = [child1Comp, child2Comp]`

**Base elements include**:

- HTML tags with lowercase first letter (`"div"`, `"span"`, `"button"`)
- Hash-prefixed special elements (`"#fragment"`, `"#text"`)
- Wave-specific elements (`"wave:text"`, `"wave:null"`)

### Pattern 3: Custom Components

```go
Text = ""                      // Not used
Children = nil                 // Not used
RenderedComp *ComponentImpl   // Rendered output (Pattern 3: custom components only)
```

Used for user-defined components that transform into other components through their render functions. These create component chains where custom components render to base elements.

**Example**: A `TodoItem` component renders to a `div`, creating the chain:

```
TodoItem ComponentImpl (Pattern 3)
└── RenderedComp → div ComponentImpl (Pattern 2)
                   └── Children → [text, button, etc.]
```

## Rendering Flow

### 1. Reconciliation and Pattern Routing

The main `render()` function performs React-like reconciliation:

1. **Null handling**: `elem == nil` unmounts the component
2. **Component matching**: Existing components are reused if tag and key match
3. **Pattern routing**: Elements are routed to the appropriate pattern based on tag type

```go
if elem.Tag == vdom.TextTag {
    // Pattern 1: Text Nodes
    r.renderText(elem.Text, comp)
} else if isBaseTag(elem.Tag) {
    // Pattern 2: Base elements
    r.renderSimple(elem, comp, opts)
} else {
    // Pattern 3: Custom components
    r.renderComponent(cfunc, elem, comp, opts)
}
```

### 2. Pattern-Specific Rendering

Each pattern has its own rendering function that manages field usage:

**renderText()**: Simply stores text content, no cleanup needed since text components can't have other patterns.

**renderSimple()**: Clears any existing `RenderedComp` (Pattern 3) and renders children into the `Children` field (Pattern 2).

**renderComponent()**: Clears any existing `Children` (Pattern 2), calls the component function, and renders the result into `RenderedComp` (Pattern 3).

### 3. Component Function Execution

Custom components are Go functions called via reflection:

1. **Props conversion**: The VDomElem props map is converted to the expected Go struct type
2. **Function execution**: The component function is called with context and typed props
3. **Result processing**: Returned elements are converted to VDomElem arrays
4. **Fragment wrapping**: Multiple returned elements are automatically wrapped in fragments

```go
// Single element: renders directly to RenderedComp
// Multiple elements: wrapped in fragment, then rendered to RenderedComp
if len(rtnElemArr) == 1 {
    rtnElem = &rtnElemArr[0]
} else {
    rtnElem = &vdom.VDomElem{Tag: vdom.FragmentTag, Children: rtnElemArr}
}
```

## Key-Based Reconciliation

The children reconciliation system implements React's key-matching logic:

### ChildKey Structure

```go
type ChildKey struct {
    Tag string  // Component type must match
    Idx int     // Position index for non-keyed elements
    Key string  // Explicit key for keyed elements
}
```

### Matching Rules

1. **Keyed elements**: Match by tag + key, position ignored

   - `<div key="a">` only matches `<div key="a">`
   - Position changes don't break identity

2. **Non-keyed elements**: Match by tag + position

   - `<div>` at position 0 only matches `<div>` at position 0
   - Moving elements breaks identity and causes remount

3. **Key transitions**: Keyed and non-keyed elements never match
   - `<div>` → `<div key="hello">` causes remount
   - Adding/removing keys breaks component identity

### Reconciliation Algorithm

```go
// Build map of existing children by ChildKey
for idx, child := range curChildren {
    if child.Key != "" {
        curCM[ChildKey{Tag: child.Tag, Idx: 0, Key: child.Key}] = child
    } else {
        curCM[ChildKey{Tag: child.Tag, Idx: idx, Key: ""}] = child
    }
}

// Match new elements against existing map
for idx, elem := range elems {
    elemKey := getElemKey(&elem)
    if elemKey != "" {
        curChild = curCM[ChildKey{Tag: elem.Tag, Idx: 0, Key: elemKey}]
    } else {
        curChild = curCM[ChildKey{Tag: elem.Tag, Idx: idx, Key: ""}]
    }
    // Reuse existing component or create new one
}
```

## Component Lifecycle

### Mounting

New components are created with:

- Unique WaveId for tracking
- Tag and Key for reconciliation
- Registration in global ComponentMap
- Empty pattern fields (populated during rendering)

### Unmounting

The unmounting process ensures complete cleanup:

1. **Hook cleanup**: All hook `UnmountFn` callbacks are executed
2. **Pattern-specific cleanup**:
   - Pattern 3: Recursively unmount `RenderedComp`
   - Pattern 2: Recursively unmount all `Children`
   - Pattern 1: No child cleanup needed
3. **Global cleanup**: Remove from ComponentMap and dependency tracking

This prevents memory leaks and ensures proper lifecycle management.

### Component vs Rendered Content Lifecycle

A key distinction in Tsunami (matching React) is that component mounting/unmounting is separate from what they render:

- **Component returns `nil`**: Component stays mounted (keeps state/hooks), but `RenderedComp` becomes `nil`
- **Component returns content again**: Component reuses existing identity, new content gets mounted

This preserves component state across rendering/not-rendering cycles.

## Output Generation

The shadow tree gets converted to frontend-ready format through `MakeRendered()`:

1. **Component chain following**: For Pattern 3 components, follow `RenderedComp` until reaching a base element
2. **Base element conversion**: Convert Pattern 1/2 components to RenderedElem with WaveIds
3. **Null component filtering**: Components with `RenderedComp == nil` don't appear in output

Only base elements (Pattern 1/2) appear in the final output - custom components (Pattern 3) are invisible, having transformed into base elements.

## React Similarities and Differences

### Similarities

- **Reconciliation**: Same key-based matching and component reuse logic
- **Hooks**: Same lifecycle patterns with cleanup functions
- **Component identity**: Persistent component instances across renders
- **Null rendering**: Components can render nothing while staying mounted

### Key Differences

- **Server-side**: Runs entirely in Go backend, sends VDom to frontend
- **Component chaining**: Pattern 3 allows direct component-to-component rendering via `RenderedComp`
- **Explicit patterns**: Three mutually exclusive patterns vs React's more flexible structure
- **Type separation**: Clear separation between input VDom, shadow tree, and output types

### Performance Optimizations

The three-pattern system provides significant optimizations:

- **Base element efficiency**: HTML elements use `Children` directly without intermediate transformation nodes
- **Component chain efficiency**: Custom components chain via `RenderedComp` without wrapper overhead
- **Memory efficiency**: Each pattern only allocates fields it actually uses

This avoids React's issue where every element creates wrapper nodes, leading to shorter traversal paths and fewer allocations.

## Pattern Transition Rules

Components never transition between patterns - they maintain their pattern for their entire lifecycle:

- **Tag determines pattern**: `#text` → Pattern 1, base tags → Pattern 2, custom tags → Pattern 3
- **Tag changes cause remount**: Different tag = different component = complete unmount/remount
- **Pattern fields are exclusive**: Only one pattern's fields are populated per component

This ensures clean memory management and predictable behavior - no cross-pattern cleanup is needed within individual render functions.
