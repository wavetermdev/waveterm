# Spec 008: Styling and Polish

## Objective
Apply consistent styling, animations, and polish to create a professional VS Code-like settings experience.

## Context
The functional components need visual polish to match Wave's design system and provide a high-quality user experience similar to VS Code's settings UI.

## Implementation Steps

### Step 1: Define Design Tokens
Create/update design tokens for settings:
```scss
// settings-tokens.scss
$settings-sidebar-width: 200px;
$settings-row-padding: 12px 16px;
$settings-modified-color: #e2c08d; // yellow/gold like VS Code
$settings-label-color: var(--primary);
$settings-description-color: var(--muted-foreground);
$settings-category-bg: var(--highlightbg);
```

### Step 2: Style Category Sidebar
Apply styling to sidebar:
- Hover effects
- Active state highlight
- Icon styling
- Modified badge styling
- Responsive collapse on narrow screens

### Step 3: Style Setting Rows
Each setting row should have:
- Clear visual hierarchy (label > description > control)
- Modified indicator (left border or background tint)
- Hover state (subtle background change)
- Focus state for accessibility
- Proper spacing and alignment

### Step 4: Style Controls
Ensure consistent control styling:
- Toggle switches: smooth animation, clear on/off state
- Sliders: track, thumb, value indicator
- Inputs: focus ring, error state
- Dropdowns: arrow indicator, hover state
- Color picker: swatch preview, picker popup

### Step 5: Add Animations
Subtle animations for polish:
- Setting row hover: subtle background fade
- Toggle: smooth slide animation
- Slider: smooth value change
- Save button: pulse when changes exist
- Reset: fade and slide animation
- Category expand/collapse: smooth transition

### Step 6: Style Search
Search bar styling:
- Icon position
- Clear button appearance
- Results count badge
- Filter toggles
- Highlighted search matches

### Step 7: Implement Modified Indicator
VS Code-style modified indicator:
- Yellow/gold left border on modified settings
- "Modified" text or icon
- Subtle background tint option
- Reset button appears on hover

### Step 8: Style Error States
Error styling:
- Input border color change
- Error message below input
- Error icon
- Toast notifications for save errors

### Step 9: Add Responsive Behavior
Handle different screen sizes:
- Sidebar collapses to hamburger menu on narrow
- Controls stack vertically on mobile
- Category headers remain sticky
- Search remains accessible

### Step 10: Implement Dark/Light Theme Support
Ensure settings work in both themes:
- Test all colors in both modes
- Ensure sufficient contrast
- Modified indicator visible in both
- Icons adapt to theme

### Step 11: Add Loading States
Loading UI:
- Skeleton loaders while loading
- Spinner for async operations
- Disabled state during save
- Progress indicator for batch saves

### Step 12: Final Polish
- Consistent focus rings
- Proper z-index layering
- Smooth scrolling
- Scroll shadows (top/bottom)
- Empty state for no results

## Files to Create/Modify
- **Create**: `frontend/app/view/waveconfig/settings-visual.scss`
- **Create**: `frontend/app/element/settings/settings-controls.scss`
- **Modify**: Various component files for inline styles/classes
- **Modify**: `frontend/app/theme.scss` (if adding tokens)

## Acceptance Criteria
- [ ] Consistent styling across all components
- [ ] Animations are smooth (60fps)
- [ ] Modified indicator is clearly visible
- [ ] Error states are clear
- [ ] Responsive design works on all screen sizes
- [ ] Dark and light themes both work
- [ ] Loading states are implemented
- [ ] Focus states for accessibility
- [ ] Overall feel matches VS Code quality

## Security Considerations
- CSS should not allow injection
- Animations should respect `prefers-reduced-motion`

## Testing Requirements
- Visual regression tests
- Test on different screen sizes
- Test in dark and light modes
- Test with reduced motion preference
- Test loading states
- Test error states

## Dependencies
- Specs 001-007 (all functional components)
