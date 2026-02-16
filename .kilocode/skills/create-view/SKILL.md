---
name: create-view
description: Guide for implementing a new view type in Wave Terminal. Use when creating a new view component, implementing the ViewModel interface, registering a new view type in BlockRegistry, or adding a new content type to display within blocks.
---

# Creating a New View in Wave Terminal

This guide explains how to implement a new view type in Wave Terminal. Views are the core content components displayed within blocks in the terminal interface.

## Architecture Overview

Wave Terminal uses a **Model-View architecture** where:

- **ViewModel** - Contains all state, logic, and UI configuration as Jotai atoms
- **ViewComponent** - Pure React component that renders the UI using the model
- **BlockFrame** - Wraps views with a header, connection management, and standard controls

The separation between model and component ensures:

- Models can update state without React hooks
- Components remain pure and testable
- State is centralized in Jotai atoms for easy access

## ViewModel Interface

Every view must implement the `ViewModel` interface defined in `frontend/types/custom.d.ts`:

```typescript
interface ViewModel {
  // Required: The type identifier for this view (e.g., "term", "web", "preview")
  viewType: string;

  // Required: The React component that renders this view
  viewComponent: ViewComponent<ViewModel>;

  // Optional: Icon shown in block header (FontAwesome icon name or IconButtonDecl)
  viewIcon?: jotai.Atom<string | IconButtonDecl>;

  // Optional: Display name shown in block header (e.g., "Terminal", "Web", "Preview")
  viewName?: jotai.Atom<string>;

  // Optional: Additional header elements (text, buttons, inputs) shown after the name
  viewText?: jotai.Atom<string | HeaderElem[]>;

  // Optional: Icon button shown before the view name in header
  preIconButton?: jotai.Atom<IconButtonDecl>;

  // Optional: Icon buttons shown at the end of the header (before settings/close)
  endIconButtons?: jotai.Atom<IconButtonDecl[]>;

  // Optional: Custom background styling for the block
  blockBg?: jotai.Atom<MetaType>;

  // Optional: If true, completely hides the block header
  noHeader?: jotai.Atom<boolean>;

  // Optional: If true, shows connection picker in header for remote connections
  manageConnection?: jotai.Atom<boolean>;

  // Optional: If true, filters out 'nowsh' connections from connection picker
  filterOutNowsh?: jotai.Atom<boolean>;

  // Optional: If true, removes default padding from content area
  noPadding?: jotai.Atom<boolean>;

  // Optional: Atoms for managing in-block search functionality
  searchAtoms?: SearchAtoms;

  // Optional: Returns whether this is a basic terminal (for multi-input feature)
  isBasicTerm?: (getFn: jotai.Getter) => boolean;

  // Optional: Returns context menu items for the settings dropdown
  getSettingsMenuItems?: () => ContextMenuItem[];

  // Optional: Focuses the view when called, returns true if successful
  giveFocus?: () => boolean;

  // Optional: Handles keyboard events, returns true if handled
  keyDownHandler?: (e: WaveKeyboardEvent) => boolean;

  // Optional: Cleanup when block is closed
  dispose?: () => void;
}
```

### Key Concepts

**Atoms**: All UI-related properties must be Jotai atoms. This enables:

- Reactive updates when state changes
- Access from anywhere via `globalStore.get()`/`globalStore.set()`
- Derived atoms that compute values from other atoms

**ViewComponent**: The React component receives these props:

```typescript
type ViewComponentProps<T extends ViewModel> = {
  blockId: string; // Unique ID for this block
  blockRef: React.RefObject<HTMLDivElement>; // Ref to block container
  contentRef: React.RefObject<HTMLDivElement>; // Ref to content area
  model: T; // Your ViewModel instance
};
```

## Step-by-Step Guide

### 1. Create the View Model Class

Create a new file for your view model (e.g., `frontend/app/view/myview/myview-model.ts`):

```typescript
import { BlockNodeModel } from "@/app/block/blocktypes";
import { WOS, globalStore, useBlockAtom } from "@/store/global";
import * as jotai from "jotai";
import { MyView } from "./myview";

export class MyViewModel implements ViewModel {
  viewType: string;
  blockId: string;
  nodeModel: BlockNodeModel;
  blockAtom: jotai.Atom<Block>;

  // Define your atoms (simple field initializers)
  viewIcon = jotai.atom<string>("circle");
  viewName = jotai.atom<string>("My View");
  noPadding = jotai.atom<boolean>(true);

  // Derived atom (created in constructor)
  viewText!: jotai.Atom<HeaderElem[]>;

  constructor(blockId: string, nodeModel: BlockNodeModel) {
    this.viewType = "myview";
    this.blockId = blockId;
    this.nodeModel = nodeModel;
    this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);

    // Create derived atoms that depend on block data or other atoms
    this.viewText = jotai.atom((get) => {
      const blockData = get(this.blockAtom);
      const rtn: HeaderElem[] = [];

      // Add header buttons/text based on state
      rtn.push({
        elemtype: "iconbutton",
        icon: "refresh",
        title: "Refresh",
        click: () => this.refresh(),
      });

      return rtn;
    });
  }

  get viewComponent(): ViewComponent {
    return MyView;
  }

  refresh() {
    // Update state using globalStore
    // Never use React hooks in model methods
    console.log("refreshing...");
  }

  giveFocus(): boolean {
    // Focus your view component
    return true;
  }

  dispose() {
    // Cleanup resources (unsubscribe from events, etc.)
  }
}
```

### 2. Create the View Component

Create your React component (e.g., `frontend/app/view/myview/myview.tsx`):

```typescript
import { ViewComponentProps } from "@/app/block/blocktypes";
import { MyViewModel } from "./myview-model";
import { useAtomValue } from "jotai";
import "./myview.scss";

export const MyView: React.FC<ViewComponentProps<MyViewModel>> = ({
    blockId,
    model,
    contentRef
}) => {
    // Use atoms from the model (these are React hooks - call at top level!)
    const blockData = useAtomValue(model.blockAtom);

    return (
        <div className="myview-container" ref={contentRef}>
            <div>Block ID: {blockId}</div>
            <div>View: {model.viewType}</div>
            {/* Your view content here */}
        </div>
    );
};
```

### 3. Register the View

Add your view to the `BlockRegistry` in `frontend/app/block/block.tsx`:

```typescript
const BlockRegistry: Map<string, ViewModelClass> = new Map();
BlockRegistry.set("term", TermViewModel);
BlockRegistry.set("preview", PreviewModel);
BlockRegistry.set("web", WebViewModel);
// ... existing registrations ...
BlockRegistry.set("myview", MyViewModel); // Add your view here
```

The registry key (e.g., `"myview"`) becomes the view type used in block metadata.

### 4. Create Blocks with Your View

Users can create blocks with your view type:

- Via CLI: `wsh view myview`
- Via RPC: Use the block's `meta.view` field set to `"myview"`

## Real-World Examples

### Example 1: Terminal View (`term-model.ts`)

The terminal view demonstrates:

- **Connection management** via `manageConnection` atom
- **Dynamic header buttons** showing shell status (play/restart)
- **Mode switching** between terminal and vdom views
- **Custom keyboard handling** for terminal-specific shortcuts
- **Focus management** to focus the xterm.js instance
- **Shell integration status** showing AI capability indicators

Key features:

```typescript
this.manageConnection = jotai.atom((get) => {
  const termMode = get(this.termMode);
  if (termMode == "vdom") return false;
  return true; // Show connection picker for regular terminal mode
});

this.endIconButtons = jotai.atom((get) => {
  const shellProcStatus = get(this.shellProcStatus);
  const buttons: IconButtonDecl[] = [];

  if (shellProcStatus == "running") {
    buttons.push({
      elemtype: "iconbutton",
      icon: "refresh",
      title: "Restart Shell",
      click: this.forceRestartController.bind(this),
    });
  }
  return buttons;
});
```

### Example 2: Web View (`webview.tsx`)

The web view shows:

- **Complex header controls** (back/forward/home/URL input)
- **State management** for loading, URL, and navigation
- **Event handling** for webview navigation events
- **Custom styling** with `noPadding` for full-bleed content
- **Media controls** showing play/pause/mute when media is active

Key features:

```typescript
this.viewText = jotai.atom((get) => {
  const url = get(this.url);
  const rtn: HeaderElem[] = [];

  // Navigation buttons
  rtn.push({
    elemtype: "iconbutton",
    icon: "chevron-left",
    click: this.handleBack.bind(this),
    disabled: this.shouldDisableBackButton(),
  });

  // URL input with nested controls
  rtn.push({
    elemtype: "div",
    className: "block-frame-div-url",
    children: [
      {
        elemtype: "input",
        value: url,
        onChange: this.handleUrlChange.bind(this),
        onKeyDown: this.handleKeyDown.bind(this),
      },
      {
        elemtype: "iconbutton",
        icon: "rotate-right",
        click: this.handleRefresh.bind(this),
      },
    ],
  });

  return rtn;
});
```

## Header Elements (`HeaderElem`)

The `viewText` atom can return an array of these element types:

```typescript
// Icon button
{
    elemtype: "iconbutton",
    icon: "refresh",
    title: "Tooltip text",
    click: () => { /* handler */ },
    disabled?: boolean,
    iconColor?: string,
    iconSpin?: boolean,
    noAction?: boolean,  // Shows icon but no click action
}

// Text element
{
    elemtype: "text",
    text: "Display text",
    className?: string,
    noGrow?: boolean,
    ref?: React.RefObject<HTMLElement>,
    onClick?: (e: React.MouseEvent) => void,
}

// Text button
{
    elemtype: "textbutton",
    text: "Button text",
    className?: string,
    title: "Tooltip",
    onClick: (e: React.MouseEvent) => void,
}

// Input field
{
    elemtype: "input",
    value: string,
    className?: string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void,
    onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void,
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void,
    ref?: React.RefObject<HTMLInputElement>,
}

// Container with children
{
    elemtype: "div",
    className?: string,
    children: HeaderElem[],
    onMouseOver?: (e: React.MouseEvent) => void,
    onMouseOut?: (e: React.MouseEvent) => void,
}

// Menu button (dropdown)
{
    elemtype: "menubutton",
    // ... MenuButtonProps ...
}
```

## Best Practices

### Jotai Model Pattern

Follow these rules for Jotai atoms in models:

1. **Simple atoms as field initializers**:

   ```typescript
   viewIcon = jotai.atom<string>("circle");
   noPadding = jotai.atom<boolean>(true);
   ```

2. **Derived atoms in constructor** (need dependency on other atoms):

   ```typescript
   constructor(blockId: string, nodeModel: BlockNodeModel) {
       this.viewText = jotai.atom((get) => {
           const blockData = get(this.blockAtom);
           return [/* computed based on blockData */];
       });
   }
   ```

3. **Models never use React hooks** - Use `globalStore.get()`/`set()`:

   ```typescript
   refresh() {
       const currentData = globalStore.get(this.blockAtom);
       globalStore.set(this.dataAtom, newData);
   }
   ```

4. **Components use hooks for atoms**:
   ```typescript
   const data = useAtomValue(model.dataAtom);
   const [value, setValue] = useAtom(model.valueAtom);
   ```

### State Management

- All view state should live in atoms on the model
- Use `useBlockAtom()` helper for block-scoped atoms that persist
- Use `globalStore` for imperative access outside React components
- Subscribe to Wave events using `waveEventSubscribe()`

### Styling

- Create a `.scss` file for your view styles
- Use Tailwind utilities where possible (v4)
- Add `noPadding: atom(true)` for full-bleed content
- Use `blockBg` atom to customize block background

### Focus Management

Implement `giveFocus()` to focus your view when:

- Block gains focus via keyboard navigation
- User clicks the block
- Return `true` if successfully focused, `false` otherwise

### Keyboard Handling

Implement `keyDownHandler(e: WaveKeyboardEvent)` for:

- View-specific keyboard shortcuts
- Return `true` if event was handled (prevents propagation)
- Use `keyutil.checkKeyPressed(waveEvent, "Cmd:K")` for shortcut checks

### Cleanup

Implement `dispose()` to:

- Unsubscribe from Wave events
- Unregister routes/handlers
- Clear timers/intervals
- Release resources

### Connection Management

For views that need remote connections:

```typescript
this.manageConnection = jotai.atom(true); // Show connection picker
this.filterOutNowsh = jotai.atom(true); // Hide nowsh connections
```

Access connection status:

```typescript
const connStatus = jotai.atom((get) => {
  const blockData = get(this.blockAtom);
  const connName = blockData?.meta?.connection;
  return get(getConnStatusAtom(connName));
});
```

## Common Patterns

### Reading Block Metadata

```typescript
import { getBlockMetaKeyAtom } from "@/store/global";

// In constructor:
this.someFlag = getBlockMetaKeyAtom(blockId, "myview:flag");

// In component:
const flag = useAtomValue(model.someFlag);
```

### Configuration Overrides

Wave has a hierarchical config system (global → connection → block):

```typescript
import { getOverrideConfigAtom } from "@/store/global";

this.settingAtom = jotai.atom((get) => {
  // Checks block meta, then connection config, then global settings
  return get(getOverrideConfigAtom(this.blockId, "myview:setting")) ?? defaultValue;
});
```

### Updating Block Metadata

```typescript
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";

await RpcApi.SetMetaCommand(TabRpcClient, {
  oref: WOS.makeORef("block", this.blockId),
  meta: { "myview:key": value },
});
```

## Additional Resources

- `frontend/app/block/blockframe-header.tsx` - Block header rendering
- `frontend/app/view/term/term-model.ts` - Complex view example
- `frontend/app/view/webview/webview.tsx` - Navigation UI example
- `frontend/types/custom.d.ts` - Type definitions
