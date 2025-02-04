# Wave Terminal Roadmap

This roadmap outlines major upcoming features and improvements for Wave Terminal. As with any roadmap, priorities and timelines may shift as development progresses.

Want input on the roadmap? Join the discussion on [Discord](https://discord.gg/XfvZ334gwU).

Legend: ✅ Done | 🔧 In Progress | 🔷 Planned | 🤞 Stretch Goal

## v0.11.0

Released on 1/25/25

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

Targeting 1/31/25

- 🔧 Reduce main-line 2FA requests to 1 per connection
- 🔧 Remote S3 bucket browsing (directory + files)
- 🔷 Drag & drop between preview blocks
- 🔷 Drag into/out of a preview block from native file explorer
- 🔷 Wave Apps (Go SDK)
- 🔷 JSON schema support (basic)
- 🤞 Frontend Only Widgets, React + Babel Transpiling in an iframe/webview

## v0.12

Targeting mid-February.

- 🔷 Import/Export Tab Layouts and Widgets
- 🔷 log viewer
- 🔷 binary viewer
- 🔷 New layout actions (splitting, replacing blocks)
- 🔷 Rewrite of window/tab system
- 🔷 Minimized / Non-Visible blocks
- 🔷 Custom keybindings to quickly switch / invoke built-in and custom widgets
- 🔷 More Drag & Drop support of files/URLs to create blocks
- 🔷 Tab Templates

## Planned (Unscheduled)

- 🔷 Customizable Keybindings
  - 🔷 Launch widgets with custom keybindings
  - 🔷 Re-assign system keybindings
- 🔷 Command Palette
- 🔷 AI Context
- 🔷 Monaco Theming
- 🔷 File system watching for Preview
- 🔷 File system watching for drag and drop
- 🤞 Explore VSCode Extension Compatibility with standalone Monaco Editor (language servers)
- 🤞 VSCode File Icons in Preview
