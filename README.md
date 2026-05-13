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

> **Fork:** This is a fork of [Wave Terminal](https://github.com/wavetermdev/waveterm) optimized for remote development workflows.

# Wave Terminal

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [繁體中文](README.zh-TW.md)

</div>

Wave is an open-source terminal for macOS, Linux, and Windows. No accounts required.

Wave supports durable SSH sessions that survive network interruptions and restarts, with automatic reconnection. Edit remote files with a built-in graphical editor and preview files inline without leaving the terminal.

## Fork Notes

This fork is optimized for remote development workflows with a focus on macOS.

- **No telemetry** — All analytics, telemetry, and cloud data collection have been completely removed; no usage data is sent to external servers
- **Local toolchain** — Go and Task are installed locally (not global), no system dependencies required
- **macOS builds** — CI builds macOS `.dmg` via GitHub Actions (manual trigger)
- **Planned changes** — SSH port forwarding, remove unnecessary AI features, MOSH support, vertical tabs, SSH config as source of truth for connections

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## Key Features

- Durable SSH Sessions - Remote terminal sessions survive connection interruptions, network changes, and Wave restarts with automatic reconnection
- Flexible drag & drop interface to organize terminal blocks, editors, web browsers, and previews
- Built-in editor for editing remote files with syntax highlighting and modern editor features
- Rich file preview system for remote files (markdown, images, video, PDFs, CSVs, directories)
- Quick full-screen toggle for any block - expand terminals, editors, and previews for better visibility, then instantly return to multi-block view
- Command Blocks for isolating and monitoring individual commands
- One-click remote connections with full terminal and file system access
- Secure secret storage using native system backends - store API keys and credentials locally, access them across SSH sessions
- Rich customization including tab themes, terminal styles, and background images
- Powerful `wsh` command system for managing your workspace from the CLI and sharing data between terminal sessions
- Connected file management with `wsh file` - seamlessly copy and sync files between local and remote SSH hosts

## Installation

Wave Terminal works on macOS, Linux, and Windows.

### Minimum requirements

Wave Terminal runs on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 1809 or later (x64)
- Linux based on glibc-2.28 or later (Debian 10, RHEL 8, Ubuntu 20.04, etc.) (arm64, x64)

The WSH helper runs on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 or later (x64)
- Linux Kernel 2.6.32 or later (x64), Linux Kernel 3.1 or later (arm64)

## Building from Source

See [Building Wave Terminal](BUILD.md).

## Contributing

Wave uses GitHub Issues for issue tracking.

Find more information in our [Contributions Guide](CONTRIBUTING.md), which includes:

- [Ways to contribute](CONTRIBUTING.md#contributing-to-wave-terminal)
- [Contribution guidelines](CONTRIBUTING.md#before-you-start)

## License

Wave Terminal is licensed under the Apache-2.0 License. For more information on our dependencies, see [here](./ACKNOWLEDGEMENTS.md).
