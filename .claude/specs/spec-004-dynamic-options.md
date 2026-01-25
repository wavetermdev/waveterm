# Spec 004: Dynamic Options Loading

## Objective
Implement dynamic loading of options for select controls that depend on runtime data (terminal themes, AI modes, font families).

## Context
Some settings have options that aren't known at build time - they come from config files or system state. We need a mechanism to load these dynamically.

## Implementation Steps

### Step 1: Create Options Provider Interface
Create `frontend/app/store/settings-options-provider.ts`:
```typescript
interface OptionsProvider {
  getOptions(): Promise<SelectOption[]>;
  subscribeToChanges?(callback: () => void): () => void;
}

interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}
```

### Step 2: Create Terminal Themes Provider
Implement provider for `term:theme`:
- Load themes from `fullConfig.TermThemes`
- Subscribe to config changes via WPS
- Return `{ value: themeKey, label: theme.DisplayName }`
- Sort by DisplayOrder

### Step 3: Create AI Modes Provider
Implement provider for `waveai:defaultmode`:
- Load from `fullConfig.WaveAIModes`
- Subscribe to config changes
- Filter by cloud/local based on `waveai:showcloudmodes`
- Return formatted options

### Step 4: Create AI Presets Provider
Implement provider for `ai:preset`:
- Load from `fullConfig.Presets` (filter `ai@*`)
- Subscribe to config changes
- Return formatted options

### Step 5: Create Font Family Provider
Implement provider for `term:fontfamily`:
- Provide common monospace fonts
- Optional: Query system fonts via Electron IPC
- Include "default" option

### Step 6: Create Default Block Type Provider
Implement provider for `app:defaultnewblock`:
- Return static options: term, preview, web, etc.
- Could be extended with custom block types

### Step 7: Create AutoUpdate Channel Provider
Implement provider for `autoupdate:channel`:
- Return: stable, beta, nightly

### Step 8: Create Provider Registry
Create `frontend/app/store/options-registry.ts`:
- Map setting keys to their providers
- `getOptionsProvider(key: string): OptionsProvider | null`
- Cache providers (singleton pattern)

### Step 9: Create useSettingOptions Hook
Create `frontend/app/view/waveconfig/use-setting-options.ts`:
```typescript
function useSettingOptions(settingKey: string): {
  options: SelectOption[];
  loading: boolean;
  error: string | null;
}
```
- Use provider registry
- Handle loading state
- Handle errors gracefully
- Subscribe to changes and re-render

### Step 10: Integrate with Select Control
Modify select control to:
- Check if setting has dynamic options
- Show loading spinner while loading
- Handle empty options gracefully
- Update when options change

## Files to Create/Modify
- **Create**: `frontend/app/store/settings-options-provider.ts`
- **Create**: `frontend/app/store/options-registry.ts`
- **Create**: `frontend/app/view/waveconfig/use-setting-options.ts`
- **Modify**: `frontend/app/element/settings/select-control.tsx`
- **Modify**: `frontend/app/store/settings-registry.ts` (mark dynamic options)

## Acceptance Criteria
- [ ] Terminal themes load dynamically in theme selector
- [ ] AI modes load dynamically
- [ ] AI presets load dynamically
- [ ] Options update when config files change
- [ ] Loading states are shown appropriately
- [ ] Errors are handled gracefully
- [ ] No memory leaks from subscriptions

## Security Considerations
- Validate loaded options before rendering
- Don't expose internal implementation details in errors

## Testing Requirements
- Test each provider in isolation
- Test subscription/unsubscription
- Test loading states
- Test error handling
- Test options updates

## Dependencies
- Spec 001 (Settings Schema)
- Spec 002 (GUI Controls - select component)
