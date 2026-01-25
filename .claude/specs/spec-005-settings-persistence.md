# Spec 005: Settings Persistence Layer

## Objective
Create a robust persistence layer that handles saving individual settings, batched saves, and proper error handling.

## Context
Currently settings are saved by writing the entire settings.json file. We need a more granular approach that:
1. Allows saving individual settings
2. Batches multiple changes efficiently
3. Handles errors gracefully
4. Provides optimistic updates

## Implementation Steps

### Step 1: Create Settings Service
Create `frontend/app/store/settings-service.ts`:
```typescript
class SettingsService {
  // Get current value of a setting
  getSetting<T>(key: string): T | undefined;

  // Set a single setting (debounced save)
  setSetting(key: string, value: any): Promise<void>;

  // Set multiple settings at once
  setSettings(settings: Record<string, any>): Promise<void>;

  // Reset setting to default
  resetSetting(key: string): Promise<void>;

  // Reset all settings to defaults
  resetAllSettings(): Promise<void>;

  // Get all current settings
  getAllSettings(): Record<string, any>;

  // Check if setting is modified from default
  isModified(key: string): boolean;

  // Get all modified settings
  getModifiedSettings(): string[];
}
```

### Step 2: Implement Debounced Save
Add debouncing to prevent excessive writes:
- Collect changes in a pending queue
- Debounce save for 500ms
- Batch all pending changes into single write
- Clear queue on successful save

### Step 3: Implement Optimistic Updates
Update UI immediately before save completes:
- Store pending values separately
- UI reads from pending || saved
- On save error, revert pending values
- Show error toast on failure

### Step 4: Integrate with Existing RPC
Use existing `SetConfigCommand`:
```typescript
// From wshclientapi.ts
RpcApi.SetConfigCommand(TabRpcClient, { settings: { [key]: value } });
```

### Step 5: Create Settings Atoms
Create Jotai atoms for settings state:
```typescript
// Current settings from server
const savedSettingsAtom = atom<Record<string, any>>({});

// Pending changes not yet saved
const pendingSettingsAtom = atom<Record<string, any>>({});

// Merged view (pending overrides saved)
const effectiveSettingsAtom = atom((get) => ({
  ...get(savedSettingsAtom),
  ...get(pendingSettingsAtom)
}));

// Per-setting atoms for efficient updates
const settingAtomFamily = atomFamily((key: string) =>
  atom(
    (get) => get(effectiveSettingsAtom)[key],
    (get, set, value) => { /* update logic */ }
  )
);
```

### Step 6: Handle Config File Changes
Subscribe to config file changes:
- Listen to WPS events for config changes
- Update savedSettingsAtom when config changes
- Handle external edits (merge or warn)

### Step 7: Implement Conflict Resolution
Handle conflicts when both GUI and JSON editor modify:
- Detect when saved differs from expected
- Option 1: Last write wins
- Option 2: Show conflict dialog
- For simplicity: last write wins with toast notification

### Step 8: Add Validation Before Save
Validate settings before saving:
- Check value matches expected type
- Check value passes validation rules (min/max/pattern)
- Return error for invalid values
- Don't save invalid values

### Step 9: Create useSettingValue Hook
```typescript
function useSettingValue<T>(key: string): [
  value: T | undefined,
  setValue: (value: T) => void,
  {
    isModified: boolean,
    isSaving: boolean,
    error: string | null,
    reset: () => void
  }
]
```

### Step 10: Add Undo Support
Track recent changes for undo:
- Store last N changes with old values
- Ctrl+Z to undo last change
- Show "Undo" in toast after change

## Files to Create/Modify
- **Create**: `frontend/app/store/settings-service.ts`
- **Create**: `frontend/app/store/settings-atoms.ts`
- **Create**: `frontend/app/view/waveconfig/use-setting-value.ts`
- **Modify**: `frontend/app/view/waveconfig/waveconfig-model.ts`

## Acceptance Criteria
- [ ] Individual settings can be saved
- [ ] Multiple rapid changes are batched
- [ ] Optimistic updates provide instant feedback
- [ ] Errors are handled and shown to user
- [ ] Settings sync with external file changes
- [ ] Validation prevents invalid values
- [ ] useSettingValue hook works correctly
- [ ] No data loss on errors

## Security Considerations
- Validate all values before saving
- Don't allow arbitrary keys to be set
- Rate limit save operations

## Testing Requirements
- Test debouncing behavior
- Test optimistic updates and rollback
- Test conflict handling
- Test validation
- Test WPS subscription
- Test error scenarios

## Dependencies
- Spec 001 (Settings Schema - for validation rules)
