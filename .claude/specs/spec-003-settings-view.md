# Spec 003: Settings View Component (Main UI)

## Objective
Create the main settings view component that renders settings in a VS Code-like layout with category sidebar, search, and scrollable settings list.

## Context
Currently `WaveConfigView` shows a JSON editor for settings.json. We need to replace/enhance this with a GUI-based settings view that dynamically renders controls based on the settings registry.

## Implementation Steps

### Step 1: Create Settings View Layout
Create `frontend/app/view/waveconfig/settings-visual.tsx`:
- Three-column layout (similar to VS Code):
  1. Category sidebar (left)
  2. Settings list (center/main)
  3. Optional: Table of contents for current category (right, hidden on narrow screens)

### Step 2: Create Search Bar Component
Add search functionality at the top:
- Text input with search icon
- Filter settings in real-time as user types
- Search across: labels, descriptions, tags, keys
- Show "X results" count
- Clear button

### Step 3: Create Category Sidebar
Create category navigation:
- List all categories with icons
- Show count of settings in each category
- Highlight currently active category
- Scroll to category when clicked
- Show "modified" badge if any setting in category is modified

### Step 4: Create Settings List Component
Create `frontend/app/view/waveconfig/settings-list.tsx`:
- Virtualized list for performance (many settings)
- Group settings by category
- Category headers as sticky elements
- Each setting renders appropriate control from control factory

### Step 5: Create Individual Setting Row
Create `frontend/app/view/waveconfig/setting-row.tsx`:
- Layout: Label | Description | Control | Reset button
- Show key on hover (for power users)
- Show "Modified" indicator (yellow bar on left, like VS Code)
- Show "Requires restart" badge if applicable
- Platform indicator if setting is platform-specific

### Step 6: Integrate with Existing WaveConfig Model
Modify `frontend/app/view/waveconfig/waveconfig-model.ts`:
- Add atoms for current settings values
- Add atom for modified settings tracking
- Add methods to get/set individual settings
- Add method to reset individual setting to default
- Add method to reset all settings

### Step 7: Create Settings State Management
Create `frontend/app/view/waveconfig/settings-state.ts`:
- Track current values vs saved values
- Track modified settings
- Debounced save mechanism
- Optimistic updates with rollback on error

### Step 8: Add Save/Discard Controls
Add header controls:
- "Save" button (active when changes exist)
- "Discard Changes" button
- Auto-save toggle option
- "Reset All to Defaults" with confirmation

### Step 9: Create Modified Settings Summary
Show summary of modified settings:
- "You have modified X settings" message
- Quick link to view only modified settings
- Option to reset all modifications

### Step 10: Add Keyboard Navigation
Implement keyboard accessibility:
- Tab through settings
- Enter to toggle booleans
- Arrow keys for sliders/selects
- Escape to close dropdowns
- Cmd/Ctrl+F to focus search
- Cmd/Ctrl+S to save

## Files to Create/Modify
- **Create**: `frontend/app/view/waveconfig/settings-visual.tsx`
- **Create**: `frontend/app/view/waveconfig/settings-list.tsx`
- **Create**: `frontend/app/view/waveconfig/setting-row.tsx`
- **Create**: `frontend/app/view/waveconfig/settings-state.ts`
- **Create**: `frontend/app/view/waveconfig/settings-visual.scss`
- **Modify**: `frontend/app/view/waveconfig/waveconfig-model.ts`
- **Modify**: `frontend/app/view/waveconfig/waveconfig.tsx` (integrate new view)

## Acceptance Criteria
- [ ] Settings view shows all settings grouped by category
- [ ] Category sidebar allows navigation
- [ ] Search filters settings in real-time
- [ ] Modified settings show visual indicator
- [ ] Reset to default works for individual settings
- [ ] Save/Discard controls work correctly
- [ ] Settings persist correctly after save
- [ ] Keyboard navigation is fully functional
- [ ] View is responsive for different screen sizes
- [ ] Performance is good with all settings (no lag)

## Security Considerations
- Validate all values before saving
- Don't expose sensitive settings in UI inappropriately
- Sanitize search input

## Testing Requirements
- Test search functionality
- Test save/discard flow
- Test reset to default
- Test keyboard navigation
- Test category navigation
- Visual regression tests for layout

## Dependencies
- Spec 001 (Settings Schema)
- Spec 002 (GUI Controls)
