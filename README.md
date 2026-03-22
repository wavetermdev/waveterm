# Wove

**The AI-first terminal for developers who code, not click.**

Built on the [Wave Terminal](https://github.com/wavetermdev/waveterm) engine. Wove adds deep project intelligence, MCP integration, execution planning, and multi-model support — turning your terminal into an AI development environment.

## Why Wove?

| Feature | Standard terminals | Warp | Wove |
|---|---|---|---|
| AI chat in terminal | Some | Yes | Yes |
| AI reads your database schema | No | No | **Yes (MCP)** |
| AI reads project conventions | No | Partial | **Yes (CLAUDE.md, WAVE.md)** |
| AI creates execution plans | No | Basic | **Yes (with auto-tests, lint, review)** |
| SEO audit tool | No | No | **Yes** |
| Session history across restarts | No | No | **Yes** |
| Web page content reading | No | No | **Yes (text, HTML, JS)** |
| Multi-model BYOK | Limited | Limited | **10 presets (3 clicks to add)** |
| Open source | Some | No | **Yes (Apache 2.0)** |

## Key Features

### MCP Integration
Connect to any [Model Context Protocol](https://modelcontextprotocol.io/) server. Wove auto-detects `.mcp.json` in your project and gives AI direct access to your database, documentation, and logs.

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

AI automatically queries your database schema before writing SQL, checks framework docs before suggesting patterns, and reads error logs before debugging.

### AI Planning System
For code tasks, Wove creates detailed execution plans with:
- Concrete file paths and pattern references
- Auto-appended steps: lint, review against project conventions, write tests, run tests
- Live progress panel in the AI sidebar
- Plans survive restarts — pick up where you left off

### Project Intelligence
Wove reads your project's coding conventions (WAVE.md, CLAUDE.md, .cursorrules) and enforces them:
- Tech stack injected into every request (AI knows it's Inertia, not axios)
- Critical rules auto-extracted and always present
- Project structure on first message
- Smart section filtering by technology

### Web Content Tools
AI can navigate, read, and audit web pages:
- **web_read_text** — clean text by CSS selector
- **web_read_html** — raw HTML for structure inspection
- **web_seo_audit** — JSON-LD, Open Graph, meta tags, headings, alt text, links
- Visual highlight animation when AI reads page elements

### Multi-Model Support (BYOK)
Bring your own API keys. Quick Add in 3 clicks:

| Provider | Models |
|---|---|
| Anthropic | Claude Sonnet 4.6, Opus 4.6 |
| OpenAI | GPT-5 Mini, GPT-5.1 |
| Google | Gemini 3.0 Flash, Pro |
| MiniMax | M2.7 |
| Ollama | Any local model |
| OpenRouter | Any model |

### Session History
AI remembers what you did in previous sessions. Chat history persists per tab, with a visual banner showing previous work.

### Auto-approve File Reading
Approve a directory once — AI reads files without asking each time. Sensitive paths (~/.ssh, ~/.aws, .env) are never auto-approved.

## Installation

Wove works on macOS, Linux, and Windows.

### Build from source

```bash
git clone https://github.com/woveterm/wove.git
cd wove
task init
task dev
```

### Requirements
- macOS 11+, Windows 10 1809+, or Linux (glibc-2.28+)
- Node.js 22 LTS
- Go 1.25+

## Configuration

### AI Modes
Configure in `~/.config/woveterm/waveai.json`:
```json
{
  "my-model": {
    "display:name": "My Model",
    "ai:apitype": "anthropic-messages",
    "ai:model": "claude-sonnet-4-6",
    "ai:endpoint": "https://api.anthropic.com/v1/messages",
    "ai:apitokensecretname": "my_api_key",
    "ai:capabilities": ["tools", "images", "pdfs"]
  }
}
```

### Project Instructions
Create `WAVE.md` in your project root:
```markdown
## Project
My App — Laravel 11, Inertia.js, Vue 3

## Conventions
- Always use Form Request classes for validation
- Use Eloquent scopes, not raw queries
- Run vendor/bin/pint after changes
```

## How It Works

```
User message
    |
    v
[Project Stack] -> AI knows: "Laravel + Inertia + Vue"
[Critical Rules] -> AI knows: "must write tests, must use PHPDoc"
[Project Tree] -> AI knows: file structure
[MCP Context] -> AI knows: database schema, app info
[Active Plan] -> AI knows: what step to execute next
    |
    v
AI creates plan -> reads sibling files -> writes code -> reviews -> tests -> lint
```

## Built On

Wove is built on [Wave Terminal](https://github.com/wavetermdev/waveterm) by [Command Line Inc.](https://www.commandline.dev/), licensed under Apache License 2.0.

See [MODIFICATIONS.md](MODIFICATIONS.md) for a complete list of changes from upstream.

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
