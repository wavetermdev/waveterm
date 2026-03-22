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

# Wave Terminal

<div align="center">

[English](README.md) | [한국어](README.ko.md)

</div>

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

Wave is an open-source, AI-integrated terminal for macOS, Linux, and Windows. It works with any AI model. Bring your own API keys for OpenAI, Claude, or Gemini, or run local models via Ollama and LM Studio. No accounts required.

Wave also supports durable SSH sessions that survive network interruptions and restarts, with automatic reconnection. Edit remote files with a built-in graphical editor and preview files inline without leaving the terminal.

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## Key Features

- Wave AI - Context-aware terminal assistant that reads your terminal output, analyzes widgets, and performs file operations
- Durable SSH Sessions - Remote terminal sessions survive connection interruptions, network changes, and Wave restarts with automatic reconnection
- Flexible drag & drop interface to organize terminal blocks, editors, web browsers, and AI assistants
- Built-in editor for editing remote files with syntax highlighting and modern editor features
- Rich file preview system for remote files (markdown, images, video, PDFs, CSVs, directories)
- Quick full-screen toggle for any block - expand terminals, editors, and previews for better visibility, then instantly return to multi-block view
- AI chat widget with support for multiple models (OpenAI, Claude, Azure, Perplexity, Ollama)
- Command Blocks for isolating and monitoring individual commands
- One-click remote connections with full terminal and file system access
- Secure secret storage using native system backends - store API keys and credentials locally, access them across SSH sessions
- Rich customization including tab themes, terminal styles, and background images
- Powerful `wsh` command system for managing your workspace from the CLI and sharing data between terminal sessions
- Connected file management with `wsh file` - seamlessly copy and sync files between local and remote SSH hosts

## Wave AI

Wave AI is your context-aware terminal assistant with access to your workspace:

- **Terminal Context**: Reads terminal output and scrollback for debugging and analysis
- **File Operations**: Read, write, and edit files with automatic backups and user approval
- **CLI Integration**: Use `wsh ai` to pipe output or attach files directly from the command line
- **BYOK Support**: Bring your own API keys for OpenAI, Claude, Gemini, Azure, and other providers
- **Local Models**: Run local models with Ollama, LM Studio, and other OpenAI-compatible providers
- **Quick Add Model**: Add AI providers in 3 clicks - kebab menu, pick provider, paste API key
- **Free Beta**: Included AI credits while we refine the experience

Learn more in our [Wave AI documentation](https://docs.waveterm.dev/waveai) and [Wave AI Modes documentation](https://docs.waveterm.dev/waveai-modes).

## MCP Integration

Wave Terminal supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) - giving AI full context of your project without manual configuration.

- **Auto-detect**: Wave finds `.mcp.json` in your terminal's working directory and offers to connect
- **Project Context**: AI automatically gets database schema, application info, and framework documentation
- **AI Tools**: MCP tools are registered as AI tools - the model queries your database, searches docs, and reads logs on its own
- **MCP Client Widget**: Dedicated widget showing server status, available tools, and a live call log with expandable results
- **Any MCP Server**: Works with Laravel Boost, Prisma, Django, or any MCP-compatible server

Add a `.mcp.json` to your project root:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["mcp-server.js"]
    }
  }
}
```

## Web Content Tools

AI can read and analyze web pages directly from Wave's web widget:

- **web_read_text**: Extract clean text from pages by CSS selector
- **web_read_html**: Get raw HTML for structure inspection
- **web_seo_audit**: Full SEO audit - JSON-LD, Open Graph, meta tags, headings, alt text, link statistics
- **AI Reading Animation**: Visual highlight on elements being read by AI
- Pages auto-refresh before reading to ensure fresh content

## Execution Plans

For complex multi-step tasks, AI creates execution plans with progress tracking:

- **Plan Creation**: AI breaks tasks into steps (e.g., audit 10 pages, process multiple files)
- **Step-by-step Execution**: Each step runs independently with clean context
- **Live Progress Panel**: Visual progress bar and expandable step results in the AI panel
- **Persistent**: Plans survive Wave restarts, AI continues from where it left off
- **Dismiss**: Close completed plans with one click

## Session History

AI remembers what you did in previous sessions:

- **Auto-save**: Chat history saved per tab when Wave shuts down
- **Previous Session Banner**: Expandable summary of last session's messages and tool calls
- **session_history Tool**: AI reads previous work context on demand
- **Per-tab**: Each tab maintains its own history independently

## Project Instructions

Wave reads project-specific coding instructions from `WAVE.md`, `CLAUDE.md`, `.cursorrules`, and other convention files:

- **Smart Filtering**: AI requests only relevant sections (e.g., PHP sections when editing .php files)
- **Table of Contents**: First call lists available sections, second call fetches specific ones
- **Multiple Files**: Reads all instruction files found and combines them
- **Token Efficient**: Two-step approach minimizes context usage for smaller models

## Auto-approve for File Reading

AI can read files without asking for approval each time:

- **Session-level Approval**: Approve a directory once, all reads within it are auto-approved
- **Sensitive Path Protection**: ~/.ssh, ~/.aws, .env files are never auto-approved
- **Symlink Safety**: Canonical path resolution prevents bypass via symlinks

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
- Windows 10 or later (x64)
- Linux Kernel 2.6.32 or later (x64), Linux Kernel 3.1 or later (arm64)

## Roadmap

Wave is constantly improving! Our roadmap will be continuously updated with our goals for each release. You can find it [here](./ROADMAP.md).

Want to provide input to our future releases? Connect with us on [Discord](https://discord.gg/XfvZ334gwU) or open a [Feature Request](https://github.com/wavetermdev/waveterm/issues/new/choose)!

## Links

- Homepage &mdash; https://www.waveterm.dev
- Download Page &mdash; https://www.waveterm.dev/download
- Documentation &mdash; https://docs.waveterm.dev
- X &mdash; https://x.com/wavetermdev
- Discord Community &mdash; https://discord.gg/XfvZ334gwU

## Building from Source

See [Building Wave Terminal](BUILD.md).

## Contributing

Wave uses GitHub Issues for issue tracking.

Find more information in our [Contributions Guide](CONTRIBUTING.md), which includes:

- [Ways to contribute](CONTRIBUTING.md#contributing-to-wave-terminal)
- [Contribution guidelines](CONTRIBUTING.md#before-you-start)

### Sponsoring Wave ❤️

If Wave Terminal is useful to you or your company, consider sponsoring development.

Sponsorship helps support the time spent building and maintaining the project.

- https://github.com/sponsors/wavetermdev

## License

Wave Terminal is licensed under the Apache-2.0 License. For more information on our dependencies, see [here](./ACKNOWLEDGEMENTS.md).
