# WaveTerm Fork - AI Assistant Context

**Project:** Wave Terminal (Fork)
**Original Repo:** https://github.com/wavetermdev/waveterm
**Fork Owner:** a5af
**Fork URL:** https://github.com/a5af/waveterm
**Purpose:** UI customization - horizontal widget bar instead of vertical sidebar

---

## Project Overview

This is a fork of WaveTerm, an open-source terminal that combines traditional terminal features with graphical capabilities. The fork implements a specific UI customization to improve screen real estate usage.

### Key Modification

**Horizontal Widget Bar Implementation**
- **Status:** ✅ Complete (October 5, 2025)
- **Branch:** `feature/horizontal-widget-bar`
- **Commit:** e21b8e1a
- **Documentation:** See `UI_CUSTOMIZATION_SUMMARY.md` for complete details

**What Changed:**
- Moved widgets from vertical right sidebar to horizontal bar in tab bar
- Reclaimed ~48px of horizontal space for full-width terminal content
- All widget functionality preserved (context menu, help widgets, tooltips)
- Simplified widget layout (removed responsive modes)

---

## Build System

WaveTerm uses **Task** (modern Make alternative) for builds:

```bash
# Initialize dependencies (first time only)
task init

# Development mode (Hot Module Reload)
task dev

# Production build
task build
task package
```

### Prerequisites

- **Node.js 22 LTS** - Required
- **Go** - Backend language
- **Task** - Build runner (https://taskfile.dev/)
- **Zig** - For static CGO linking (Linux/Windows)
- **zip** - For packaging (Linux)

See `BUILD.md` for complete installation instructions.

---

## Project Structure

```
waveterm/
├── frontend/           # React/TypeScript frontend
│   ├── app/
│   │   ├── tab/
│   │   │   ├── tabbar.tsx       # Modified: Added WidgetBar
│   │   │   └── widgetbar.tsx    # Created: Horizontal widget bar
│   │   └── workspace/
│   │       ├── workspace.tsx    # Modified: Removed vertical Widgets
│   │       └── widgets.tsx      # Original (no longer used)
├── pkg/                # Go backend
├── aiprompts/          # AI architecture documentation
├── BUILD.md            # Build instructions
└── UI_CUSTOMIZATION_SUMMARY.md  # Customization documentation
```

---

## Important Files

### Modified Files (Customization)
- `frontend/app/tab/widgetbar.tsx` - **Created** - Horizontal widget implementation
- `frontend/app/tab/tabbar.tsx` - **Modified** - Integrated WidgetBar
- `frontend/app/workspace/workspace.tsx` - **Modified** - Removed vertical sidebar

### Configuration
- `~/.config/waveterm/widgets.json` - Widget definitions and configuration
- `~/.waveterm-dev/waveapp.log` - Development logs

### Architecture Documentation
- `aiprompts/` - Contains architecture docs for AI features
- `BUILD_VERIFICATION.md` - Build testing procedures
- `CONTRIBUTING.md` - Contribution guidelines

---

## Widget Configuration

Widgets are configured in `~/.config/waveterm/widgets.json`:

```json
{
  "browser": {
    "icon": "browser",
    "label": "web",
    "color": "#58C142",
    "blockdef": {
      "meta": {
        "view": "web"
      }
    },
    "display:order": 1,
    "display:hidden": false
  }
}
```

**Widget Properties:**
- `icon` - FontAwesome icon name
- `label` - Display text
- `color` - Hex color for icon
- `blockdef` - Block definition for widget creation
- `display:order` - Sort order (lower = leftmost)
- `display:hidden` - Hide widget if true

---

## Testing Instructions

### Visual Testing Checklist
- [ ] Widgets appear horizontally in tab bar (far right)
- [ ] Right-click widgets → "Edit widgets.json" works
- [ ] Right-click widgets → "Show Help Widgets" toggle works
- [ ] Help and Tips widgets display (if enabled)
- [ ] Terminal content is full width (no right sidebar)
- [ ] All widgets clickable and functional
- [ ] Widget tooltips display on hover

### Build Testing
```bash
# Clean build
task clean
task init
task dev

# Package test
task package
# Artifacts in make/ directory
```

---

## Known Limitations

### Current Implementation
- No overflow menu for many widgets (horizontal space assumed sufficient)
- No responsive breakpoints (simplified from original)
- Single widget mode (icon + label, no compact modes)

### Original Features Removed
- Responsive modes (normal/compact/supercompact)
- Vertical scrolling for many widgets
- Auto-collapse on window resize

**Rationale:** Horizontal space is less constrained than vertical, so responsive complexity was unnecessary for initial implementation.

### Future Enhancements
- Add overflow menu if >10 widgets configured
- Add responsive breakpoints for very small screens
- Add drag-to-reorder functionality
- Add animation for widget clicks
- Add "collapse all widgets" button

---

## Development Workflow

### Making Changes
1. Create feature branch from `feature/horizontal-widget-bar`
2. Make changes to frontend code
3. Test with `task dev` (hot reload)
4. Build with `task build` and `task package`
5. Commit with descriptive message
6. Push to fork

### Debugging

**Frontend Logs:**
- Chrome DevTools: `Cmd+Option+I` (macOS) or `Ctrl+Option+I` (Linux/Windows)
- Console tab shows React/TypeScript errors

**Backend Logs:**
- Location: `~/.waveterm-dev/waveapp.log`
- Contains both Node.js and Go backend logs

### Common Issues

**Build Fails:**
- `task: command not found` → Install Task runner
- Module not found → Run `task init` again
- Build errors → Check Node.js version (must be 22 LTS)

**Widgets Not Showing:**
- Check `widgets.json` exists and is valid JSON
- Verify `display:hidden` is false
- Check `widget:showhelp` setting for help widgets

---

## Contributing Upstream

### If Submitting PR to Original WaveTerm Repo

**Include:**
1. Screenshots showing before/after layout
2. Reference to `UI_CUSTOMIZATION_SUMMARY.md`
3. Test results on macOS, Linux, Windows
4. Widget configuration examples
5. Discussion of trade-offs (removed responsive modes)

**Potential Concerns:**
- Breaking change for users expecting vertical sidebar
- May want settings toggle for vertical vs horizontal
- Accessibility considerations for horizontal layout
- Mobile/small screen behavior

**Mitigation:**
- Keep original `widgets.tsx` file for fallback
- Add configuration option: `widget:layout: "horizontal" | "vertical"`
- Document migration path for existing users

---

## License & Attribution

**Original Project:**
- WaveTerm by Command Line Inc.
- License: Apache-2.0
- Copyright: See `ACKNOWLEDGEMENTS.md`

**This Fork:**
- Same Apache-2.0 license
- Modification: Horizontal widget bar layout
- Attribution required for derived works

**Commit Attribution:**
```
🤖 Generated with Claude Code (https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## AI Assistant Guidelines

### When Working on This Project

**DO:**
- Read `UI_CUSTOMIZATION_SUMMARY.md` for complete context
- Use `task` commands (not npm scripts directly)
- Test changes with `task dev` before committing
- Follow TypeScript/React best practices
- Preserve all widget functionality when modifying
- Check frontend and backend logs for errors

**DON'T:**
- Don't modify original `widgets.tsx` (kept for reference)
- Don't change widget configuration schema without testing
- Don't break context menu functionality
- Don't remove help widget support
- Don't assume npm scripts work (use Task)

### File Modification Priority

**High Risk (Test Thoroughly):**
- `frontend/app/tab/widgetbar.tsx` - Core implementation
- `frontend/app/tab/tabbar.tsx` - Integration point
- `frontend/app/workspace/workspace.tsx` - Layout structure

**Medium Risk:**
- Widget-related styling files
- Configuration handling code
- Context menu implementations

**Low Risk:**
- Documentation files
- Test files
- Build configuration (Taskfile.yml)

### Testing Commands

```bash
# Quick dev test
task dev

# Full build test
task clean && task init && task build

# Package test
task package
ls make/  # Check artifacts

# Log monitoring
tail -f ~/.waveterm-dev/waveapp.log
```

---

## Quick Reference

### Important Commands
```bash
task init          # Install dependencies
task dev           # Run dev server
task build         # Build app
task package       # Create installer
task clean         # Clean build artifacts
```

### Important Paths
```
Frontend: frontend/app/tab/widgetbar.tsx
Config:   ~/.config/waveterm/widgets.json
Logs:     ~/.waveterm-dev/waveapp.log
Docs:     UI_CUSTOMIZATION_SUMMARY.md
```

### Key Concepts
- **Widget:** Clickable icon in tab bar that creates blocks
- **Block:** Terminal, web view, editor, or AI chat instance
- **Tab Bar:** Top horizontal bar with tabs and widgets
- **Workspace:** Main content area with blocks

---

**Document Version:** 1.0
**Created:** October 6, 2025
**Last Updated:** October 6, 2025
**Status:** Active fork with horizontal widget bar implementation
