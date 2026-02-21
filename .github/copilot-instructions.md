# Wave Terminal — Copilot Instructions

## Project Rules

Read and follow all guidelines in [`.roo/rules/rules.md`](./.roo/rules/rules.md).

---

## Skill Guides

This project uses a set of "skill" guides — focused how-to documents for common implementation tasks. When your task matches one of the descriptions below, **read the linked SKILL.md file before proceeding** and follow its instructions precisely.

| Skill | Description |
|-------|-------------|
| [add-config](./.kilocode/skills/add-config/SKILL.md) | Guide for adding new configuration settings to Wave Terminal. Use when adding a new setting to the configuration system, implementing a new config key, or adding user-customizable settings. |
| [add-rpc](./.kilocode/skills/add-rpc/SKILL.md) | Guide for adding new RPC calls to Wave Terminal. Use when implementing new RPC commands, adding server-client communication methods, or extending the RPC interface with new functionality. |
| [add-wshcmd](./.kilocode/skills/add-wshcmd/SKILL.md) | Guide for adding new wsh commands to Wave Terminal. Use when implementing new CLI commands, adding command-line functionality, or extending the wsh command interface. |
| [context-menu](./.kilocode/skills/context-menu/SKILL.md) | Guide for creating and displaying context menus in Wave Terminal. Use when implementing right-click menus, adding context menu items, creating submenus, or handling menu interactions with checkboxes and separators. |
| [create-view](./.kilocode/skills/create-view/SKILL.md) | Guide for implementing a new view type in Wave Terminal. Use when creating a new view component, implementing the ViewModel interface, registering a new view type in BlockRegistry, or adding a new content type to display within blocks. |
| [electron-api](./.kilocode/skills/electron-api/SKILL.md) | Guide for adding new Electron APIs to Wave Terminal. Use when implementing new frontend-to-electron communications via preload/IPC. |
| [wps-events](./.kilocode/skills/wps-events/SKILL.md) | Guide for working with Wave Terminal's WPS (Wave PubSub) event system. Use when implementing new event types, publishing events, subscribing to events, or adding asynchronous communication between components. |

> **How skills work:** Each skill is a self-contained guide covering the exact files to edit, patterns to follow, and steps to take for a specific type of task in this codebase. If your task matches a skill's description, open that SKILL.md and treat it as your primary reference for the implementation.
