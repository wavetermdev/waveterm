---
name: context-menu
description: Guide for creating and displaying context menus in Wave Terminal. Use when implementing right-click menus, adding context menu items, creating submenus, or handling menu interactions with checkboxes and separators.
---

# Context Menu Quick Reference

This guide provides a quick overview of how to create and display a context menu using our system.

---

## ContextMenuItem Type

Define each menu item using the `ContextMenuItem` type:

```ts
type ContextMenuItem = {
  label?: string;
  type?: "separator" | "normal" | "submenu" | "checkbox" | "radio";
  role?: string; // Electron role (optional)
  click?: () => void; // Callback for item selection (not needed if role is set)
  submenu?: ContextMenuItem[]; // For nested menus
  checked?: boolean; // For checkbox or radio items
  visible?: boolean;
  enabled?: boolean;
  sublabel?: string;
};
```

---

## Import and Show the Menu

Import the context menu module:

```ts
import { ContextMenuModel } from "@/app/store/contextmenu";
```

To display the context menu, call:

```ts
ContextMenuModel.showContextMenu(menu, event);
```

- **menu**: An array of `ContextMenuItem`.
- **event**: The mouse event that triggered the context menu (typically from an onContextMenu handler).

---

## Basic Example

A simple context menu with a separator:

```ts
const menu: ContextMenuItem[] = [
  {
    label: "New File",
    click: () => {
      /* create a new file */
    },
  },
  {
    label: "New Folder",
    click: () => {
      /* create a new folder */
    },
  },
  { type: "separator" },
  {
    label: "Rename",
    click: () => {
      /* rename item */
    },
  },
];

ContextMenuModel.showContextMenu(menu, e);
```

---

## Example with Submenu and Checkboxes

Toggle settings using a submenu with checkbox items:

```ts
const isClearOnStart = true; // Example setting

const menu: ContextMenuItem[] = [
  {
    label: "Clear Output On Restart",
    submenu: [
      {
        label: "On",
        type: "checkbox",
        checked: isClearOnStart,
        click: () => {
          // Set the config to enable clear on restart
        },
      },
      {
        label: "Off",
        type: "checkbox",
        checked: !isClearOnStart,
        click: () => {
          // Set the config to disable clear on restart
        },
      },
    ],
  },
];

ContextMenuModel.showContextMenu(menu, e);
```

---

## Editing a Config File Example

Open a configuration file (e.g., `widgets.json`) in preview mode:

```ts
{
    label: "Edit widgets.json",
    click: () => {
        fireAndForget(async () => {
            const path = `${getApi().getConfigDir()}/widgets.json`;
            const blockDef: BlockDef = {
                meta: { view: "preview", file: path },
            };
            await createBlock(blockDef, false, true);
        });
    },
}
```

---

## Summary

- **Menu Definition**: Use the `ContextMenuItem` type.
- **Actions**: Use `click` for actions; use `submenu` for nested options.
- **Separators**: Use `type: "separator"` to group items.
- **Toggles**: Use `type: "checkbox"` or `"radio"` with the `checked` property.
- **Displaying**: Use `ContextMenuModel.showContextMenu(menu, event)` to render the menu.

## Common Use Cases

### File/Folder Operations
Context menus are commonly used for file operations like creating, renaming, and deleting files or folders.

### Settings Toggles
Use checkbox menu items to toggle settings on and off, with the `checked` property reflecting the current state.

### Nested Options
Use `submenu` to organize related options hierarchically, keeping the top-level menu clean and organized.

### Conditional Items
Use the `visible` and `enabled` properties to dynamically show or disable menu items based on the current state.
