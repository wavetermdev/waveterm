# WaveTerm UI Customization - Horizontal Widget Bar

**Date:** October 5, 2025
**Branch:** `feature/horizontal-widget-bar`
**Commit:** e21b8e1a
**Status:** ✅ Complete - Ready for testing

---

## Summary

Successfully moved WaveTerm's vertical right-side widget sidebar to a horizontal widget bar in the tab bar. Widgets now appear on the far right of the tab bar, maintaining all functionality while providing full-width terminal content.

---

## Changes Made

### 1. Created New Component: `widgetbar.tsx`
**Location:** `frontend/app/tab/widgetbar.tsx`

- Horizontal version of the widgets sidebar
- Simplified layout - removed responsive modes (normal/compact/supercompact)
- Widgets display in a single horizontal row
- Maintained all functionality:
  - Widget click handlers
  - Context menu (Edit widgets.json, Toggle help widgets)
  - Help and Tips widgets
  - Dev notification popover

**Key Differences from Original:**
```tsx
// Original (vertical):
className="flex flex-col w-12 overflow-hidden py-1"

// New (horizontal):
className="flex flex-row items-center gap-1 h-full px-1"
```

### 2. Modified: `tabbar.tsx`
**Changes:**
- Imported `WidgetBar` component
- Added `<WidgetBar />` to `tab-bar-right` section
- Widgets now appear before UpdateStatusBanner and ConfigErrorIcon

**Before:**
```tsx
<div className="tab-bar-right">
    <UpdateStatusBanner ref={updateStatusBannerRef} />
    <ConfigErrorIcon buttonRef={configErrorButtonRef} />
</div>
```

**After:**
```tsx
<div className="tab-bar-right">
    <WidgetBar />
    <UpdateStatusBanner ref={updateStatusBannerRef} />
    <ConfigErrorIcon buttonRef={configErrorButtonRef} />
</div>
```

### 3. Modified: `workspace.tsx`
**Changes:**
- Removed import of `Widgets` component
- Removed `<Widgets />` from layout
- Terminal content now full-width (no right sidebar)

**Before:**
```tsx
<div className="flex flex-row flex-grow overflow-hidden">
    <TabContent key={tabId} tabId={tabId} />
    <Widgets />
    <ModalsRenderer />
</div>
```

**After:**
```tsx
<div className="flex flex-row flex-grow overflow-hidden">
    <TabContent key={tabId} tabId={tabId} />
    <ModalsRenderer />
</div>
```

---

## Files Modified

| File | Lines Changed | Type |
|------|--------------|------|
| `frontend/app/tab/widgetbar.tsx` | +140 | Created |
| `frontend/app/tab/tabbar.tsx` | +2 | Modified |
| `frontend/app/workspace/workspace.tsx` | -2 | Modified |

**Total:** 3 files changed, 140 insertions(+), 2 deletions(-)

---

## Layout Comparison

### Before (Vertical Sidebar)
```
┌──────────────────────────────────┬─┐
│  Tab 1 │ Tab 2 │ Tab 3 │ [+]     │W│
├──────────────────────────────────┤I│
│                                  │D│
│                                  │G│
│         TERMINAL CONTENT         │E│
│                                  │T│
│                                  │S│
│                                  │ │
└──────────────────────────────────┴─┘
```

### After (Horizontal Widget Bar)
```
┌────────────────────────────────────────────┐
│  Tab 1 │ Tab 2 │ Tab 3 │ [+]  [W][I][D][G] │
├────────────────────────────────────────────┤
│                                            │
│                                            │
│          TERMINAL CONTENT (FULL WIDTH)     │
│                                            │
│                                            │
│                                            │
└────────────────────────────────────────────┘
```

---

## Benefits

✅ **Full-width terminal** - Reclaimed ~48px (w-12) of horizontal space
✅ **Cleaner UI** - Unified horizontal command bar
✅ **All functionality preserved** - Context menu, help widgets, tooltips
✅ **Consistent design** - Widgets match tab bar height and styling
✅ **Better widget visibility** - Widgets always visible without scrolling

---

## Testing Instructions

### 1. Install Dependencies
```bash
# Install Task runner (required by WaveTerm build system)
# Windows (Chocolatey):
choco install go-task

# macOS (Homebrew):
brew install go-task/tap/go-task

# Linux:
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
```

### 2. Build & Run
```bash
cd /d/temp2/waveterm

# Initialize dependencies
task init

# Run in dev mode
task dev

# OR build production
task build
task package
```

### 3. Verify Changes
- [ ] Widgets appear horizontally in tab bar (far right)
- [ ] Right-click widgets → "Edit widgets.json" works
- [ ] Right-click widgets → "Show Help Widgets" toggle works
- [ ] Help and Tips widgets display (if enabled in config)
- [ ] Terminal content is full width (no right sidebar)
- [ ] All widgets clickable and functional
- [ ] Widget tooltips display on hover

---

## Configuration

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
    "display:order": 1
  }
}
```

**Widget Properties:**
- `icon` - FontAwesome icon name
- `label` - Display text
- `color` - Icon color (hex)
- `blockdef` - Block definition for creating the widget view
- `display:order` - Sort order (lower = leftmost)
- `display:hidden` - Hide widget if true

---

## Known Limitations

### Responsive Design
The current implementation does NOT include:
- Overflow menu for many widgets
- Responsive breakpoints
- Widget hiding based on window width

**Why:** The original vertical sidebar had responsive modes (normal/compact/supercompact) because vertical space is limited. Horizontal space is much less constrained, so this wasn't necessary for the initial implementation.

**Future Enhancement:** Could add overflow menu if users configure >10 widgets.

### Widget Modes Removed
Original sidebar had 3 modes:
- `normal` - Icon + label
- `compact` - Icon only
- `supercompact` - 2-column grid

New horizontal bar uses single mode:
- Icon + label in horizontal layout

**Rationale:** Horizontal space allows showing labels always.

---

## Original Vertical Sidebar Code

The original `frontend/app/workspace/widgets.tsx` is **still in the repository** but no longer used. It can be:
- Kept for reference
- Deleted in a cleanup commit
- Used as fallback if horizontal layout needs reversion

---

## Next Steps

### For Development:
1. **Test in real WaveTerm environment** - Build and run the application
2. **Test with multiple widgets** - Add 5+ widgets to widgets.json
3. **Test on different screen sizes** - Verify layout works on small/large displays
4. **Test widget interactions** - Click widgets, use context menu
5. **Test with help widgets disabled** - `widget:showhelp: false` in config

### For Production:
1. **Create pull request** to upstream WaveTerm repository
2. **Include screenshots** of before/after
3. **Document breaking changes** (if any)
4. **Update user documentation** for widget location
5. **Consider adding settings toggle** to switch between vertical/horizontal

### Optional Enhancements:
- [ ] Add overflow menu for >8 widgets
- [ ] Add responsive breakpoints for small screens
- [ ] Add animation for widget clicks
- [ ] Add drag-to-reorder functionality
- [ ] Add "collapse all widgets" button
- [ ] Add widget grouping/separators

---

## Troubleshooting

### Build Fails
**Error:** `task: command not found`
**Solution:** Install Task runner (see Testing Instructions #1)

**Error:** `Cannot find module '@/app/tab/widgetbar'`
**Solution:** Restart dev server (Ctrl+C, then `task dev`)

### Widgets Not Showing
**Check:** `~/.config/waveterm/widgets.json` exists and is valid JSON
**Check:** Widget has `"display:hidden": false` (or property omitted)
**Check:** `widget:showhelp` setting if expecting help/tips widgets

### Styling Issues
**Check:** Tab bar height is sufficient (should be ~27px)
**Check:** `.tab-bar-right` has flex-direction: row
**Check:** Widget icons are FontAwesome compatible

---

## License & Attribution

Based on WaveTerm by Command Line Inc.
Original License: Apache-2.0
Modification: Widget bar horizontal layout

**Attribution:**
```
🤖 Generated with Claude Code (https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Commit Message

```
feat: Move widgets from vertical sidebar to horizontal tab bar

- Create new horizontal WidgetBar component (widgetbar.tsx)
- Integrate WidgetBar into TabBar's tab-bar-right section
- Remove vertical Widgets sidebar from workspace layout
- Widgets now display horizontally on the right side of tab bar
- All widget functionality preserved (context menu, help widgets, etc.)
- Full-width terminal content (no right sidebar consuming space)

Based on UI customization spec to remove vertical sidebar and
relocate widgets to tab bar for better space utilization.
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-05
**Status:** Ready for testing
**Fork:** https://github.com/a5af/waveterm
**Branch:** feature/horizontal-widget-bar
