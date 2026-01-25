# Spec 007: Integration with Existing WaveConfig

## Objective
Integrate the new GUI settings view with the existing WaveConfig infrastructure, maintaining the ability to edit raw JSON while adding the visual interface.

## Context
The existing `WaveConfigView` has:
- Sidebar with config file selection
- Tab system (Visual/JSON) for some files
- Monaco editor for JSON editing
- Save functionality

We need to integrate our new settings visual component while preserving this architecture.

## Implementation Steps

### Step 1: Update ConfigFile Definition
Modify `waveconfig-model.ts` to enable visual component for settings.json:
```typescript
{
  name: "General",
  path: "settings.json",
  language: "json",
  docsUrl: "https://docs.waveterm.dev/config",
  hasJsonView: true,
  visualComponent: SettingsVisualContent, // Add this
}
```

### Step 2: Create SettingsVisualContent Wrapper
Create `frontend/app/view/waveconfig/settings-visual-content.tsx`:
- Wrapper component that receives `model: WaveConfigViewModel`
- Renders the settings visual view
- Handles communication with model for saving

### Step 3: Sync Visual and JSON Views
When switching between Visual and JSON tabs:
- Visual → JSON: serialize current visual state to JSON
- JSON → Visual: parse JSON and update visual state
- Handle parse errors gracefully
- Show warning if JSON has unknown keys

### Step 4: Update WaveConfigViewModel
Add new methods and atoms:
```typescript
class WaveConfigViewModel {
  // ... existing code ...

  // New atoms for visual settings
  settingsValuesAtom: PrimitiveAtom<Record<string, any>>;

  // New methods
  getSettingValue(key: string): any;
  setSettingValue(key: string, value: any): void;
  saveSettings(): Promise<void>;
  resetSetting(key: string): void;

  // Sync between JSON and visual
  syncJsonToVisual(): void;
  syncVisualToJson(): void;
}
```

### Step 5: Handle Tab Switching
Implement sync logic when switching tabs:
```typescript
// In waveconfig.tsx
const handleTabChange = (newTab: 'visual' | 'json') => {
  if (activeTab === 'visual' && newTab === 'json') {
    model.syncVisualToJson();
  } else if (activeTab === 'json' && newTab === 'visual') {
    model.syncJsonToVisual();
  }
  setActiveTab(newTab);
};
```

### Step 6: Update Save Logic
Modify save to handle both modes:
- If in JSON mode: save raw JSON (existing behavior)
- If in Visual mode: serialize settings and save
- Mark both views as synced after save

### Step 7: Handle Config Changes
Subscribe to config file changes:
- When settings.json changes externally:
  - Update JSON editor content
  - Update visual settings state
  - Show notification if user had unsaved changes

### Step 8: Add Migration Path for Unknown Settings
Handle settings not in registry:
- Show in "Advanced" or "Unknown" section
- Allow editing as raw JSON within visual view
- Don't lose unknown settings on save

### Step 9: Update Error Handling
Enhance error display:
- Validation errors show in visual mode
- Parse errors show when switching to JSON
- Save errors show toast
- Clear errors on successful save

### Step 10: Add Docs Link Integration
Connect settings to documentation:
- "Learn more" link on each setting
- Links to specific anchor in docs
- Open in external browser

## Files to Create/Modify
- **Create**: `frontend/app/view/waveconfig/settings-visual-content.tsx`
- **Modify**: `frontend/app/view/waveconfig/waveconfig-model.ts`
- **Modify**: `frontend/app/view/waveconfig/waveconfig.tsx`

## Acceptance Criteria
- [ ] Settings.json shows Visual tab by default
- [ ] Can switch between Visual and JSON tabs
- [ ] Changes in Visual reflect in JSON
- [ ] Changes in JSON reflect in Visual
- [ ] Unknown settings are preserved
- [ ] Save works from both views
- [ ] External file changes are detected
- [ ] Errors are displayed appropriately
- [ ] Existing config files still work (connections, etc.)

## Security Considerations
- Validate JSON before parsing
- Handle malformed settings gracefully
- Don't execute any code from settings

## Testing Requirements
- Test tab switching with changes
- Test sync between views
- Test save from both views
- Test external file changes
- Test with unknown settings
- Test error scenarios

## Dependencies
- Spec 001-006 (all previous specs)
