# Wave Terminal Roadmap

This roadmap outlines major upcoming features and improvements for Wave Terminal. As with any roadmap, priorities and timelines may shift as development progresses.

Want input on the roadmap? Join the discussion on [Discord](https://discord.gg/XfvZ334gwU).

Legend: ✅ Done | 🔧 In Progress | 🔷 Planned | 🤞 Stretch Goal

## v0.11.0

Currently in beta, targeting release on 1/24.

- ✅ File/Directory Preview improvements
  - ✅ Reworked fileshare layer running over RPC
  - ✅ Expanded URI types supported by `wsh file ...`
  - ✅ EC-TIME timeout when transferring large files
- ✅ Fixes for reducing 2FA requests on connect
- ✅ WebLinks in the terminal working again
- ✅ Search in Web Views
- ✅ Search in the Terminal
- ✅ Custom init files for widgets and terminal blocks
- ✅ Multi-Input between terminal blocks on the same tab
- ✅ Gemini AI support
- ✅ Various Connection Bugs + Improvements
- ✅ More Connection Config Options

## v0.11.1

Likely to follow v0.11 by 1 week.

- 🔧 Reduce main-line 2FA requests to 1 per connection
- 🔷 Frontend Only Widgets, React + Babel Transpiling in an iframe/webview
- 🔷 Monaco Theming
- 🔧 Remote S3 bucket browsing (directory + files)
- 🔷 Drag & drop between preview blocks
- 🔷 Drag into a preview directory from the native file browser or desktop to copy a file
- 🔷 Wave Apps (Go SDK)
- 🤞 Explore VSCode Extension Compatibility with standalone Monaco Editor (language servers)

## v0.12

- 🔷 Import/Export Tab Layouts and Widgets
- 🔷 log viewer
- 🔷 binary viewer

## Planned (Unscheduled)

- 🔷 Customizable Keybindings
  - 🔷 Launch widgets with custom keybindings
  - 🔷 Re-assign system keybindings
- 🔷 Command Palette
- 🔷 AI Context
