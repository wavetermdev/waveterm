# Wave Terminal Roadmap

This roadmap outlines major upcoming features and improvements for Wave Terminal. As with any roadmap, priorities and timelines may shift as development progresses.

Want input on the roadmap? Join the discussion on [Discord](https://discord.gg/XfvZ334gwU).

Legend: ✅ Done | 🔧 In Progress | 🔷 Planned | 🤞 Stretch Goal

## Current AI Capabilities

Wave Terminal's AI assistant is already powerful and continues to evolve. Here's what works today:

### AI Provider Support

- ✅ OpenAI (including gpt-5 and gpt-5-mini models)

### Context & Input

- ✅ Widget context integration - AI sees your open terminals, web views, and other widgets
- ✅ Image and document upload - Attach images and files to conversations
- ✅ Local file reading - Read text files and directory listings on local machine
- ✅ Web search - Native web search capability for current information
- ✅ Shell integration awareness - AI understands terminal state (shell, version, OS, etc.)

### Widget Interaction Tools

- ✅ Widget screenshots - Capture visual state of any widget
- ✅ Terminal scrollback access - Read terminal history and output
- ✅ Web navigation - Control browser widgets

## ROADMAP Enhanced AI Capabilities

### AI Configuration & Flexibility

- 🔷 BYOK (Bring Your Own Key) - Use your own API keys for any supported provider
- 🔧 Enhanced provider configuration options

### Expanded Provider Support

Top priorities are Claude (for better coding support), and the OpenAI Completions API which will allow us to interface with
many more local/open models.

- 🔷 Anthropic Claude - Full integration with extended thinking and tool use
- 🔷 OpenAI Completions API - Support for older model formats
- 🤞 Google Gemini - Complete integration
- 🤞 Local AI agents - Run AI models locally on your machine

### Advanced AI Tools

#### File Operations

- 🔧 AI file writing with intelligent diff previews
- 🔧 Rollback support for AI-made changes
- 🔷 Multi-file editing workflows
- 🔷 Safe file modification patterns

#### Terminal Command Execution

- 🔧 Execute commands directly from AI
- 🔧 Intelligent terminal state detection
- 🔧 Command result capture and parsing

### Remote & Advanced Capabilities

- 🔷 Remote file operations - Read and write files on SSH connections
- 🔷 Custom AI-powered widgets (Tsunami framework)
- 🔷 AI Can spawn Wave Blocks
- 🔷 Drag&Drop from Preview Widgets to Wave AI

### Wave AI Widget Builder

- 🔷 Visual builder for creating custom AI-powered widgets
- 🔷 Template library for common AI workflows
- 🔷 Rapid prototyping and iteration tools

## Other Platform & UX Improvements (Non AI)

- 🔷 Import/Export tab layouts and widgets
- 🔧 Enhanced layout actions (splitting, replacing blocks)
- 🔷 Extended drag & drop for files/URLs
- 🔷 Tab templates for quick workspace setup
- 🔷 Advanced keybinding customization
  - 🔷 Widget launch shortcuts
  - 🔷 System keybinding reassignment
- 🔷 Command Palette
- 🔷 Monaco Editor theming
