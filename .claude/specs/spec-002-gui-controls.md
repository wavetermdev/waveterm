# Spec 002: GUI Control Components

## Objective
Create reusable React components for each setting control type that can be dynamically rendered based on the settings metadata.

## Context
VS Code's settings UI uses specific controls for each setting type (toggles for booleans, dropdowns for selects, sliders for ranges). We need a component library that maps to our `SettingControlType` values.

## Implementation Steps

### Step 1: Create Base Setting Control Wrapper
Create `frontend/app/element/settings/setting-control.tsx`:
- Wrapper component that handles common layout
- Shows label, description, "modified" indicator, reset button
- Renders the appropriate control based on `controlType`

```tsx
interface SettingControlProps {
  settingKey: string;
  value: any;
  defaultValue: any;
  onChange: (value: any) => void;
  metadata: SettingMetadata;
}
```

### Step 2: Create Toggle Control
Create `frontend/app/element/settings/toggle-control.tsx`:
- Use existing toggle component or create new one
- Support disabled state
- Accessible (keyboard navigation, ARIA)

### Step 3: Create Number Input Control
Create `frontend/app/element/settings/number-control.tsx`:
- Text input with number validation
- Support min/max from validation rules
- Show increment/decrement buttons
- Support step value

### Step 4: Create Slider Control
Create `frontend/app/element/settings/slider-control.tsx`:
- Range slider with value display
- Support min/max/step from validation rules
- Show current value next to slider
- Support decimal values for opacity settings

### Step 5: Create Text Input Control
Create `frontend/app/element/settings/text-control.tsx`:
- Standard text input
- Support pattern validation
- Support placeholder text from metadata
- Support multiline for longer text

### Step 6: Create Select/Dropdown Control
Create `frontend/app/element/settings/select-control.tsx`:
- Dropdown with options from metadata
- Support dynamic options (e.g., terminal themes loaded at runtime)
- Show "modified" indicator when value differs from default

### Step 7: Create Color Picker Control
Create `frontend/app/element/settings/color-control.tsx`:
- Color swatch preview
- Click to open color picker
- Support hex, rgb, and CSS color names
- Reset to default button

### Step 8: Create Font Picker Control
Create `frontend/app/element/settings/font-control.tsx`:
- Text input with font name
- Optional: Font family dropdown with system fonts
- Preview text in selected font

### Step 9: Create Path Input Control
Create `frontend/app/element/settings/path-control.tsx`:
- Text input with path
- "Browse" button to open file dialog (use Electron IPC)
- Validate path exists (optional)

### Step 10: Create String List Control
Create `frontend/app/element/settings/stringlist-control.tsx`:
- For settings like `term:localshellopts`
- List of text inputs
- Add/remove buttons
- Reorder capability (drag or buttons)

### Step 11: Create Control Factory
Create `frontend/app/element/settings/control-factory.tsx`:
- `renderControl(metadata, value, onChange)` function
- Maps `controlType` to appropriate component
- Handles unknown types gracefully

### Step 12: Style All Controls
Create `frontend/app/element/settings/settings-controls.scss`:
- Consistent styling matching Wave's design system
- Modified indicator styling (yellow/orange highlight like VS Code)
- Reset button styling
- Responsive layouts

## Files to Create/Modify
- **Create**: `frontend/app/element/settings/setting-control.tsx`
- **Create**: `frontend/app/element/settings/toggle-control.tsx`
- **Create**: `frontend/app/element/settings/number-control.tsx`
- **Create**: `frontend/app/element/settings/slider-control.tsx`
- **Create**: `frontend/app/element/settings/text-control.tsx`
- **Create**: `frontend/app/element/settings/select-control.tsx`
- **Create**: `frontend/app/element/settings/color-control.tsx`
- **Create**: `frontend/app/element/settings/font-control.tsx`
- **Create**: `frontend/app/element/settings/path-control.tsx`
- **Create**: `frontend/app/element/settings/stringlist-control.tsx`
- **Create**: `frontend/app/element/settings/control-factory.tsx`
- **Create**: `frontend/app/element/settings/settings-controls.scss`
- **Create**: `frontend/app/element/settings/index.ts` (barrel export)

## Acceptance Criteria
- [ ] Each control type has a corresponding React component
- [ ] Controls are accessible (keyboard, screen reader)
- [ ] Controls show "modified" indicator when value differs from default
- [ ] Controls have reset-to-default functionality
- [ ] All controls follow Wave's design system
- [ ] Controls are properly typed with TypeScript
- [ ] Controls handle undefined/null values gracefully

## Security Considerations
- Path inputs should validate against path traversal
- Text inputs should sanitize for XSS if displayed elsewhere
- No sensitive data should be logged in console

## Testing Requirements
- Unit tests for each control component
- Test value change callbacks
- Test accessibility (keyboard navigation)
- Test reset functionality

## Dependencies
- Spec 001 (Settings Schema) - for SettingMetadata type
