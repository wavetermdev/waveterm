<p align="center">
  <a href="https://www.waveterm.dev">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="./assets/wave-dark.png">
		<source media="(prefers-color-scheme: light)" srcset="./assets/wave-light.png">
		<img alt="Wave Terminal Logo" src="./assets/wave-light.png" width="240">
	</picture>
  </a>
  <br/>
</p>

# Wave Terminal (Sawka Fork)

> **This is a personal fork of [Wave Terminal](https://github.com/wavetermdev/waveterm)** with experimental features and customizations. For the official version, visit the [upstream repository](https://github.com/wavetermdev/waveterm).

---

## Fork Changes

This fork includes the following modifications from upstream (~50 files changed, ~8000 lines added):

### Tab Base Directory System (Major Feature)

A complete project-centric workflow system for tabs:

- **VS Code-Style Tab Bar** - Colored tab backgrounds based on directory context
- **Breadcrumb Navigation** - Full path breadcrumbs below tab bar for quick navigation
- **Smart Auto-Detection** - OSC 7 integration automatically detects working directory from terminal
- **Directory Locking** - Lock base directory to prevent auto-detection changes
- **Tab Presets** - Save and apply tab configurations via presets (`tabvar@project-name`)
- **Tab Color Picker** - 8-color palette for manual tab coloring via context menu
- **Terminal Status Indicators** - Visual status for running/finished/stopped commands

**New Files:**
- `frontend/app/store/tab-model.ts` - Tab state management
- `frontend/app/store/tab-basedir-validator.ts` - Path validation
- `frontend/app/store/tab-basedir-validation-hook.ts` - React hook for validation
- `frontend/app/tab/tab-menu.ts` - Reusable preset menu builder
- `frontend/util/pathutil.ts` - Cross-platform path utilities
- `frontend/util/presetutil.ts` - Preset validation and sanitization
- `docs/docs/tabs.mdx` - Full documentation

### Backend Security & Validation

Comprehensive metadata validation to prevent injection attacks:

- **Path Validation** - Validates all path fields (traversal attacks, length limits)
- **URL Validation** - Validates URL fields with scheme restrictions
- **String Sanitization** - Length limits and content validation
- **Optimistic Locking** - Version-based concurrency control for metadata updates
- **Race Condition Fixes** - TOCTOU vulnerability prevention in OSC 7 updates

**New Files:**
- `pkg/waveobj/validators.go` - 935-line validation framework
- `pkg/wconfig/defaultconfig/presets/tabvars.json` - Default tab presets
- `schema/tabvarspresets.json` - JSON schema for presets

### Terminal Improvements

- **xterm.js 6.1.0 Upgrade** - Updated from 5.5.0 to 6.1.0-beta.106
  - Enables DEC mode 2026 (Synchronized Output) for proper TUI animations
  - Fixes npm progress bars, htop, and spinner animations scrolling issues
  - Uses public `terminal.dimensions` API (no more private API hacks)
  - New DomScrollableElement scrollbar with custom styling
- **Font Ligatures Support** - Enable programming ligatures with `"term:ligatures": true`
  - Works with ligature fonts like Fira Code, JetBrains Mono, Cascadia Code
  - Uses `@xterm/addon-ligatures` for native font discovery in Electron
  - See screenshot: `assets/ligatures-demo.png`
- **OSC 7 Debouncing** - 300ms debounce for rapid directory changes
- **Memory Leak Prevention** - Cleanup handlers for tab close events

### PowerShell Improvements

- **Profile Loading** - User's PowerShell profile (`$PROFILE`) is now sourced automatically
  - Wave launches with `-NoProfile` for clean environment, then sources your profile
  - Custom aliases, functions, and prompt customizations now work

### Electron IPC Additions

- `showOpenDialog` - Native directory picker for setting tab base directory
- `showWorkspaceAppMenu` - Workspace menu from breadcrumb bar

### Windows Build & Runtime Fixes

- **PowerShell 7 Requirement** - All build commands use `pwsh -NoProfile`
- **Shell Launch Fix** - Runtime shells use `-NoProfile` flag
- **Build Prerequisites** - Updated BUILD.md with PowerShell 7 requirement

### Syncing with Upstream

This fork is periodically rebased on upstream main:

```bash
git fetch upstream
git checkout sawka-main
git rebase upstream/main
git push origin sawka-main --force-with-lease
```

---

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

Wave is an open-source terminal that combines traditional terminal features with graphical capabilities like file previews, web browsing, and AI assistance. It runs on MacOS, Linux, and Windows.

Modern development involves constantly switching between terminals and browsers - checking documentation, previewing files, monitoring systems, and using AI tools. Wave brings these graphical tools directly into the terminal, letting you control them from the command line. This means you can stay in your terminal workflow while still having access to the visual interfaces you need.

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## Key Features

- Flexible drag & drop interface to organize terminal blocks, editors, web browsers, and AI assistants
- Built-in editor for seamlessly editing remote files with syntax highlighting and modern editor features
- Rich file preview system for remote files (markdown, images, video, PDFs, CSVs, directories)
- Quick full-screen toggle for any block - expand terminals, editors, and previews for better visibility, then instantly return to multi-block view
- Wave AI - Context-aware terminal assistant that reads your terminal output, analyzes widgets, and performs file operations
- AI chat widget with support for multiple models (OpenAI, Claude, Azure, Perplexity, Ollama)
- Command Blocks for isolating and monitoring individual commands with auto-close options
- One-click remote connections with full terminal and file system access
- Secure secret storage using native system backends - store API keys and credentials locally, access them across SSH sessions
- Rich customization including tab themes, terminal styles, and background images
- Powerful `wsh` command system for managing your workspace from the CLI and sharing data between terminal sessions
- Connected file management with `wsh file` - seamlessly copy and sync files between local, remote SSH hosts, Wave filesystem, and S3

## Wave AI

Wave AI is your context-aware terminal assistant with access to your workspace:

- **Terminal Context**: Reads terminal output and scrollback for debugging and analysis
- **File Operations**: Read, write, and edit files with automatic backups and user approval
- **CLI Integration**: Use `wsh ai` to pipe output or attach files directly from the command line
- **Free Beta**: Included AI credits while we refine the experience
- **Coming Soon**: Command execution (with approval), local model support, and alternate AI providers (BYOK)

Learn more in our [Wave AI documentation](https://docs.waveterm.dev/waveai).

## Installation

Wave Terminal works on macOS, Linux, and Windows.

Platform-specific installation instructions can be found [here](https://docs.waveterm.dev/gettingstarted).

You can also install Wave Terminal directly from: [www.waveterm.dev/download](https://www.waveterm.dev/download).

### Minimum requirements

Wave Terminal runs on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 1809 or later (x64)
- Linux based on glibc-2.28 or later (Debian 10, RHEL 8, Ubuntu 20.04, etc.) (arm64, x64)

The WSH helper runs on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 or later (arm64, x64)
- Linux Kernel 2.6.32 or later (x64), Linux Kernel 3.1 or later (arm64)

## Roadmap

Wave is constantly improving! Our roadmap will be continuously updated with our goals for each release. You can find it [here](./ROADMAP.md).

Want to provide input to our future releases? Connect with us on [Discord](https://discord.gg/XfvZ334gwU) or open a [Feature Request](https://github.com/wavetermdev/waveterm/issues/new/choose)!

## Links

- Homepage &mdash; https://www.waveterm.dev
- Download Page &mdash; https://www.waveterm.dev/download
- Documentation &mdash; https://docs.waveterm.dev
- Legacy Documentation &mdash; https://legacydocs.waveterm.dev
- Blog &mdash; https://blog.waveterm.dev
- X &mdash; https://x.com/wavetermdev
- Discord Community &mdash; https://discord.gg/XfvZ334gwU

## Building from Source

See [Building Wave Terminal](BUILD.md).

## Contributing

Wave uses GitHub Issues for issue tracking.

Find more information in our [Contributions Guide](CONTRIBUTING.md), which includes:

- [Ways to contribute](CONTRIBUTING.md#contributing-to-wave-terminal)
- [Contribution guidelines](CONTRIBUTING.md#before-you-start)

## License

Wave Terminal is licensed under the Apache-2.0 License. For more information on our dependencies, see [here](./ACKNOWLEDGEMENTS.md).
