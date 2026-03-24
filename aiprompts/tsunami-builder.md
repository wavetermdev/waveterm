# Tsunami AI Builder - V1 Architecture

## Overview

A split-screen builder for creating Tsunami applications: chat interface on left, tabbed preview/code/files on right. Users describe what they want, AI edits the code iteratively.

## UI Layout

### Left Panel

- **💬 Chat** - Conversation with AI

### Right Panel

**Top Section - Tabs:**
- **👁️ Preview** (default) - Live preview of running Tsunami app, updates automatically after successful compilation
- **📝 Code** - Monaco editor for manual edits to app.go
- **📁 Files** - Static assets browser (images, etc)

**Bottom Section - Build Panel (closable):**
- Shows compilation status and output (like VSCode's terminal panel)
- Displays success messages or errors with line numbers
- Auto-runs after AI edits
- For manual Code tab edits: auto-reruns or user clicks build button
- Can be manually closed/reopened by user

### Top Bar

- Current AppTitle (extracted from app.go)
- **Publish** button - Moves draft → published version
- **Revert** button - Copies published → draft (discards draft changes)

## Version Management

**Draft mode**: Auto-saved on every edit, persists when builder closes
**Published version**: What runs in main Wave Terminal, only updates on explicit "Publish"

Flow:

1. Edit in builder (always editing draft)
2. Click "Publish" when ready (copies draft → published)
3. Continue editing draft OR click "Revert" to abandon changes

## Context Structure

Every AI request includes:

```
[System Instructions]
  - General system prompt
  - Full system.md (Tsunami framework guide)

[Conversation History]
  - Recent messages (with prompt caching)

[Current Context] (injected fresh each turn, removed from previous turns)
  - Current app.go content
  - Compilation results (success or errors with line numbers)
  - Static files listing (e.g., "/static/logo.png")
```

**Context cleanup**: Old "current context" blocks are removed from previous messages and replaced with "[OLD CONTEXT REMOVED]" to save tokens. Only the latest app.go + compile results stay in context.

## AI Tools

### edit_appgo (str_replace)

**Primary editing tool**

- `old_str` - Unique string to find in app.go
- `new_str` - Replacement string
- `description` - What this change does

**Backend behavior**:

1. Apply string replacement to app.go
2. Immediately run `go build`
3. Return tool result:
   - ✓ Success: "Edit applied, compilation successful"
   - ✗ Failure: "Edit applied, compilation failed: [error details]"

AI can make multiple edits in one response, getting compile feedback after each.

### create_appgo

**Bootstrap new apps**

- `content` - Full app.go file content
- Only used for initial app creation or total rewrites

Same compilation behavior as str_replace.

### web_search

**Look up APIs, docs, examples**

- Implemented via provider backend (OpenAI/Anthropic)
- AI can research before making edits

### read_file

**Read user-provided documentation**

- `path` - Path to file (e.g., "/docs/api-spec.md")
- User can upload docs/examples for AI to reference

## User Actions (Not AI Tools)

### Manage Static Assets

- Upload via drag & drop into Files tab or file picker
- Delete files from Files tab
- Rename files from Files tab
- Appear in `/static/` directory
- Auto-injected into AI context as available files

### Share Screenshot

- User clicks "📷 Share preview with AI" button
- Captures current preview state
- Attaches to user's next message
- Useful for debugging layout/visual issues

### Manual Code Editing

- User can switch to Code tab
- Edit app.go directly in Monaco editor
- Changes auto-compile
- AI sees manual edits in next chat turn

## Compilation Pipeline

After every code change (AI or user):

```
1. Write app.go to disk
2. Run: go build app.go
3. Show build output in build panel
4. If success:
   - Start/restart app process
   - Update preview iframe
   - Show success message in build panel
5. If failure:
   - Parse error output (line numbers, messages)
   - Show error in build panel (bottom of right side)
   - Inject into AI context for next turn
```

**Auto-retry**: AI can fix its own compilation errors within the same response (up to 3 attempts).

## Error Handling

### Compilation Errors

Shown in build panel at bottom of right side.

Format for AI:

```
COMPILATION FAILED

Error at line 45:
  43 | func(props TodoProps) any {
  44 |     return vdom.H("div", nil
> 45 |         vdom.H("span", nil, "test")
     |         ^ missing closing parenthesis
  46 |     )

Message: expected ')', found 'vdom'
```

### Runtime Errors

- Shown in preview tab (not errors panel)
- User can screenshot and report to AI
- Not auto-injected (v1 simplification)

### Linting (Future)

- Could add custom Tsunami-specific linting
- Would inject warnings alongside compile results
- Not required for v1

## Secrets/Configuration

Apps can declare secrets using Tsunami's ConfigAtom:

```go
var apiKeyAtom = app.ConfigAtom("api_key", "", &app.AtomMeta{
    Desc: "OpenAI API Key",
    Secret: true,
})
```

Builder detects these and shows input fields in UI for user to fill in.

## Conversation Limits

**V1 approach**: No summarization, no smart handling.

When context limit hit: Show message "You've hit the conversation limit. Click 'Start Fresh' to continue editing this app in a new chat."

Starting fresh uses current app.go as the beginning state.

## Token Optimization

- System.md + early messages benefit from prompt caching
- Only pay per-turn for: current app.go + new messages
- Old context blocks removed to prevent bloat
- Estimated: 10-20k tokens per turn (very manageable)

## Example Flow

```
User: "Create a counter app"
AI: [calls create_appgo with full counter app]
Backend: ✓ Compiled successfully
Preview: Shows counter app

User: "Add a reset button"
AI: [calls str_replace to add reset button]
Backend: ✓ Compiled successfully
Preview: Updates with reset button

User: "Make buttons bigger"
AI: [calls str_replace to update button classes]
Backend: ✓ Compiled successfully
Preview: Updates with larger buttons

User: [switches to Code tab, tweaks color manually]
Backend: ✓ Compiled successfully
Preview: Updates

User: "Add a chart showing count over time"
AI: [calls web_search for "go charting library"]
AI: [calls str_replace to add chart]
Backend: ✗ Compilation failed - missing import
AI: [calls str_replace to add import]
Backend: ✓ Compiled successfully
Preview: Shows chart
```

## Out of Scope (V1)

- Version history / snapshots
- Multiple files / project structure
- Collaboration / sharing
- Advanced linting
- Runtime error auto-injection
- Conversation summarization
- Component-specific editing tools

These can be added in v2+ based on user feedback.

## Success Criteria

- User can create functional Tsunami app through chat in <5 minutes
- AI successfully fixes its own compilation errors 80%+ of the time
- Iteration cycle (message → edit → preview) takes <10 seconds
- Users can publish working apps to Wave Terminal
- Draft state persists across sessions
