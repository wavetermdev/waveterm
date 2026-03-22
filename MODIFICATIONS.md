# Wove — Modifications from Wave Terminal

Wove is built on the [Wave Terminal](https://github.com/wavetermdev/waveterm) engine (Apache 2.0).
This document lists all modifications and additions made in Wove.

## MCP (Model Context Protocol) Integration
- Full MCP client package (`pkg/mcpclient/`) — JSON-RPC 2.0 over stdio
- Auto-detect `.mcp.json` in terminal CWD with connect banner
- MCP tools registered as AI tools — model queries database, searches docs, reads logs
- MCP auto-context injection (database schema, application info)
- MCP Client widget in sidebar with tools list, call log, and Run button
- MCP Context toggle in AI panel header

## AI Planning System
- Multi-step execution plans with `wave_utils(action='plan_create')`
- Auto-append steps: lint, review against project conventions, write tests, run tests
- Live progress panel with expandable step results
- Plans persist to disk, survive restarts
- Detailed plan steps with file paths, conventions, and acceptance criteria

## Project Intelligence
- Reads WAVE.md, CLAUDE.md, .cursorrules, AGENTS.md automatically
- Project stack injection (tech stack in every request)
- Critical rules auto-extraction (must/always/never patterns)
- Project tree on first message (directory structure)
- Two-step project_instructions tool (table of contents → specific sections)
- Smart filtering by technology (PHP sections for .php files, etc.)

## Web Content Tools
- `web_read_text` — extract clean text by CSS selector
- `web_read_html` — extract innerHTML by CSS selector
- `web_seo_audit` — full SEO audit (JSON-LD, OG, meta, headings, alt text, links)
- `execJs` option for arbitrary JavaScript execution in webview
- Auto-refresh page before reading content
- AI Reading highlight animation on matched elements
- Page title tracking in block metadata

## Session History
- Chat history saved per tab at shutdown
- Previous Session banner in AI panel
- `session_history` tool for AI to read previous work
- Chat-to-tab mapping registry

## Auto-approve File Reading
- Session-level auto-approve for directories
- Sensitive path protection (~/.ssh, ~/.aws, .env)
- Symlink bypass prevention via canonical path resolution

## AI Model Management
- Quick Add Model menu (Claude, GPT, Gemini, MiniMax, Ollama, OpenRouter)
- Inline API key input with secure storage
- 10 built-in BYOK presets with endpoints
- Secret-based preset filtering (hide unconfigured models)
- Ollama connectivity check

## System Prompt Optimization
- "Senior software engineer" role for better code quality
- "Read sibling files before writing" pattern matching
- Self-review after each plan step
- Compressed tool descriptions (~60% fewer tokens)
- Consolidated wave_utils multi-action tool
- English-only code comments enforcement
- Terminal commands reference (grep, find, php -l, pint)

## Quality & Reliability
- Syntax highlighting fix in AI diff viewer (preserved file extensions)
- Language detection from filename (30+ extensions)
- New file diff: empty original, green additions
- Web page title in tab state (catches 500 errors)
- Default AI timeout: 90 seconds (was infinite)
- Default max output tokens: 16K (was 4K)
- Friendly error messages with Retry button
- MCP client: mutex protection, read timeout, graceful shutdown
- RPC handler input validation for WebSelector opts

## Based On
- [Wave Terminal](https://github.com/wavetermdev/waveterm) by Command Line Inc.
- Licensed under Apache License 2.0
