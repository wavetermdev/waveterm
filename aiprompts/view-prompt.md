# Wave Terminal ViewModel Guide

## Overview

Wave Terminal uses a modular ViewModel system to define interactive blocks. Each block has a **ViewModel**, which manages its metadata, configuration, and state using **Jotai atoms**. The ViewModel also specifies a **React component (ViewComponent)** that renders the block.

### Key Concepts

1. **ViewModel Structure**
   - Implements the `ViewModel` interface.
   - Defines:
     - `viewType`: Unique block type identifier.
     - `viewIcon`, `viewName`, `viewText`: Atoms for UI metadata.
     - `preIconButton`, `endIconButtons`: Atoms for action buttons.
     - `blockBg`: Atom for background styling.
     - `manageConnection`, `noPadding`, `searchAtoms`.
     - `viewComponent`: React component rendering the block.
     - Lifecycle methods like `dispose()`, `giveFocus()`, `keyDownHandler()`.

2. **ViewComponent Structure**
   - A **React function component** implementing `ViewComponentProps<T extends ViewModel>`.
   - Uses `blockId`, `blockRef`, `contentRef`, and `model` as props.
   - Retrieves ViewModel state using Jotai atoms.
   - Returns JSX for rendering.

3. **Header Elements (`HeaderElem[]`)**
   - Can include:
     - **Icons (`IconButtonDecl`)**: Clickable buttons.
     - **Text (`HeaderText`)**: Metadata or status.
     - **Inputs (`HeaderInput`)**: Editable fields.
     - **Menu Buttons (`MenuButton`)**: Dropdowns.

4. **Jotai Atoms for State Management**
   - Use `atom<T>`, `PrimitiveAtom<T>`, `WritableAtom<T>` for dynamic properties.
   - `splitAtom` for managing lists of atoms.
   - Read settings from `globalStore` and override with block metadata.

5. **Metadata vs. Global Config**
   - **Block Metadata (`SetMetaCommand`)**: Each block persists its **own configuration** in its metadata (`blockAtom.meta`).
   - **Global Config (`SetConfigCommand`)**: Provides **default settings** for all blocks, stored in config files.
   - **Cascading Behavior**:
     - Blocks first check their **own metadata** for settings.
     - If no override exists, they **fall back** to global config.
     - Updating a block's setting is done via `SetMetaCommand` (persisted per block).
     - Updating a global setting is done via `SetConfigCommand` (applies globally unless overridden).

6. **Useful Helper Functions**
   - To avoid repetitive boilerplate, use these global utilities from `global.ts`:
     - `useBlockMetaKeyAtom(blockId, key)`: Retrieves and updates block-specific metadata.
     - `useOverrideConfigAtom(blockId, key)`: Reads from global config but allows per-block overrides.
     - `useSettingsKeyAtom(key)`: Accesses global settings efficiently.

7. **Styling**
   - Use TailWind CSS to style components
   - Accent color is: text-accent, for a 50% transparent accent background use bg-accentbg
   - Hover background is: bg-hoverbg
   - Border color is "border", so use border-border
   - Colors are also defined for error, warning, and success (text-error, text-warning, text-sucess)

## Relevant TypeScript Types

```typescript
type ViewComponentProps<T extends ViewModel> = {
  blockId: string;
  blockRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
  model: T;
};

type ViewComponent = React.FC<ViewComponentProps<any>>;

interface ViewModel {
  viewType: string;
  viewIcon?: jotai.Atom<string | IconButtonDecl>;
  viewName?: jotai.Atom<string>;
  viewText?: jotai.Atom<string | HeaderElem[]>;
  preIconButton?: jotai.Atom<IconButtonDecl>;
  endIconButtons?: jotai.Atom<IconButtonDecl[]>;
  blockBg?: jotai.Atom<MetaType>;
  manageConnection?: jotai.Atom<boolean>;
  noPadding?: jotai.Atom<boolean>;
  searchAtoms?: SearchAtoms;
  viewComponent: ViewComponent;
  dispose?: () => void;
  giveFocus?: () => boolean;
  keyDownHandler?: (e: WaveKeyboardEvent) => boolean;
}

interface IconButtonDecl {
  elemtype: "iconbutton";
  icon: string | React.ReactNode;
  click?: (e: React.MouseEvent<any>) => void;
}
type HeaderElem =
  | IconButtonDecl
  | ToggleIconButtonDecl
  | HeaderText
  | HeaderInput
  | HeaderDiv
  | HeaderTextButton
  | ConnectionButton
  | MenuButton;

type IconButtonCommon = {
  icon: string | React.ReactNode;
  iconColor?: string;
  iconSpin?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
  noAction?: boolean;
};

type IconButtonDecl = IconButtonCommon & {
  elemtype: "iconbutton";
  click?: (e: React.MouseEvent<any>) => void;
  longClick?: (e: React.MouseEvent<any>) => void;
};

type ToggleIconButtonDecl = IconButtonCommon & {
  elemtype: "toggleiconbutton";
  active: jotai.WritableAtom<boolean, [boolean], void>;
};

type HeaderTextButton = {
  elemtype: "textbutton";
  text: string;
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent<any>) => void;
};

type HeaderText = {
  elemtype: "text";
  text: string;
  ref?: React.RefObject<HTMLDivElement>;
  className?: string;
  noGrow?: boolean;
  onClick?: (e: React.MouseEvent<any>) => void;
};

type HeaderInput = {
  elemtype: "input";
  value: string;
  className?: string;
  isDisabled?: boolean;
  ref?: React.RefObject<HTMLInputElement>;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
};

type HeaderDiv = {
  elemtype: "div";
  className?: string;
  children: HeaderElem[];
  onMouseOver?: (e: React.MouseEvent<any>) => void;
  onMouseOut?: (e: React.MouseEvent<any>) => void;
  onClick?: (e: React.MouseEvent<any>) => void;
};

type ConnectionButton = {
  elemtype: "connectionbutton";
  icon: string;
  text: string;
  iconColor: string;
  onClick?: (e: React.MouseEvent<any>) => void;
  connected: boolean;
};

type MenuItem = {
  label: string;
  icon?: string | React.ReactNode;
  subItems?: MenuItem[];
  onClick?: (e: React.MouseEvent<any>) => void;
};

type MenuButtonProps = {
  items: MenuItem[];
  className?: string;
  text: string;
  title?: string;
  menuPlacement?: Placement;
};

type MenuButton = {
  elemtype: "menubutton";
} & MenuButtonProps;
```

## Minimal "Hello World" Example

This example defines a simple ViewModel and ViewComponent for a block that displays "Hello, World!".

```typescript
import * as jotai from "jotai";
import React from "react";

class HelloWorldModel implements ViewModel {
    viewType = "helloworld";
    viewIcon = jotai.atom("smile");
    viewName = jotai.atom("Hello World");
    viewText = jotai.atom("A simple greeting block");
    viewComponent = HelloWorldView;
}

const HelloWorldView: ViewComponent<HelloWorldModel> = ({ model }) => {
    return <div style={{ padding: "10px" }}>Hello, World!</div>;
};

export { HelloWorldModel };

```

## Instructions to AI

1. Generate a new **ViewModel** class for a block, following the structure above.
2. Generate a corresponding **ViewComponent**.
3. Use **Jotai atoms** to store all dynamic state.
4. Ensure the ViewModel defines **header elements** (`viewText`, `viewIcon`, `endIconButtons`).
5. Export the view model (to be registered in the BlockRegistry)
6. Use existing metadata patterns for config and settings.

## Other Notes

- The types you see above don't need to be imported, they are global types (custom.d.ts)

**Output Format:**

- TypeScript code defining the **ViewModel**.
- TypeScript code defining the **ViewComponent**.
- Ensure alignment with the patterns in `waveai.tsx`, `preview.tsx`, `sysinfo.tsx`, and `term.tsx`.
