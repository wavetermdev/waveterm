# Spec 001: Settings Schema and Metadata System

## Objective
Create a comprehensive settings schema/metadata system that defines each setting's type, label, description, validation rules, and GUI control type - enabling dynamic GUI generation.

## Context
Currently, settings are defined in `pkg/wconfig/settingsconfig.go` as a Go struct (`SettingsType`) with JSON tags. The frontend has no metadata about what GUI controls to use, descriptions, or validation rules. We need to bridge this gap.

## Implementation Steps

### Step 1: Create Settings Metadata TypeScript Types
Create `frontend/types/settings-metadata.d.ts`:
- Define `SettingControlType`: 'toggle' | 'number' | 'slider' | 'text' | 'select' | 'color' | 'font' | 'path' | 'stringlist'
- Define `SettingMetadata` interface with:
  - `key`: string (e.g., "term:fontsize")
  - `label`: string (human-readable)
  - `description`: string
  - `category`: string (e.g., "Terminal", "Window", "AI")
  - `subcategory`?: string (optional grouping within category)
  - `controlType`: SettingControlType
  - `defaultValue`: any
  - `type`: 'boolean' | 'number' | 'string' | 'string[]'
  - `validation`?: ValidationRules (min, max, pattern, options for selects)
  - `requiresRestart`?: boolean
  - `platform`?: 'darwin' | 'win32' | 'linux' | 'all'
  - `deprecated`?: boolean
  - `tags`?: string[] (for search, e.g., ["font", "typography"])

### Step 2: Create Settings Registry
Create `frontend/app/store/settings-registry.ts`:
- Export `settingsRegistry: Map<string, SettingMetadata>`
- Export `settingsByCategory: Map<string, SettingMetadata[]>`
- Export `getSettingMetadata(key: string): SettingMetadata | undefined`
- Export `searchSettings(query: string): SettingMetadata[]`
- Export `getDefaultValue(key: string): any`

### Step 3: Populate the Registry with All Settings
Map all settings from `SettingsType` to metadata entries:

**App Category:**
- `app:globalhotkey` → text input
- `app:defaultnewblock` → select (options: "term", "preview", etc.)
- `app:showoverlayblocknums` → toggle
- `app:ctrlvpaste` → toggle

**Terminal Category:**
- `term:fontsize` → slider (min: 8, max: 24, step: 1)
- `term:fontfamily` → font picker
- `term:theme` → select (load from termthemes)
- `term:scrollback` → number (min: 100, max: 100000)
- `term:copyonselect` → toggle
- `term:transparency` → slider (min: 0, max: 1, step: 0.1)
- `term:ligatures` → toggle
- `term:disablewebgl` → toggle
- `term:localshellpath` → path input
- `term:allowbracketedpaste` → toggle
- `term:shiftenternewline` → toggle
- `term:macoptionismeta` → toggle (platform: darwin)

**Editor Category:**
- `editor:fontsize` → slider
- `editor:minimapenabled` → toggle
- `editor:stickyscrollenabled` → toggle
- `editor:wordwrap` → toggle
- `editor:inlinediff` → toggle

**Window Category:**
- `window:transparent` → toggle
- `window:blur` → toggle
- `window:opacity` → slider (min: 0.1, max: 1)
- `window:bgcolor` → color picker
- `window:reducedmotion` → toggle
- `window:tilegapsize` → number
- `window:showmenubar` → toggle
- `window:nativetitlebar` → toggle
- `window:disablehardwareacceleration` → toggle
- `window:fullscreenonlaunch` → toggle
- `window:confirmclose` → toggle
- `window:savelastwindow` → toggle
- `window:zoom` → slider (min: 0.5, max: 2)
- `window:magnifiedblockopacity` → slider
- `window:magnifiedblocksize` → slider

**Web Category:**
- `web:openlinksinternally` → toggle
- `web:defaulturl` → text
- `web:defaultsearch` → text

**AI Category:**
- `ai:preset` → select
- `ai:apitype` → select
- `ai:baseurl` → text
- `ai:model` → text
- `ai:maxtokens` → number
- `ai:timeoutms` → number
- `ai:fontsize` → slider
- `ai:fixedfontsize` → slider
- `waveai:showcloudmodes` → toggle
- `waveai:defaultmode` → select

**Markdown Category:**
- `markdown:fontsize` → slider
- `markdown:fixedfontsize` → slider

**Preview Category:**
- `preview:showhiddenfiles` → toggle

**Connection Category:**
- `conn:askbeforewshinstall` → toggle
- `conn:wshenabled` → toggle

**AutoUpdate Category:**
- `autoupdate:enabled` → toggle
- `autoupdate:installonquit` → toggle
- `autoupdate:intervalms` → number
- `autoupdate:channel` → select

**Telemetry Category:**
- `telemetry:enabled` → toggle

**Block Header Category:**
- `blockheader:showblockids` → toggle

### Step 4: Add Category Ordering and Icons
Define category display order and icons:
```typescript
const categoryConfig = {
  "Terminal": { order: 1, icon: "terminal" },
  "Editor": { order: 2, icon: "edit" },
  "Window": { order: 3, icon: "window-maximize" },
  "AI": { order: 4, icon: "robot" },
  "Web": { order: 5, icon: "globe" },
  "Connections": { order: 6, icon: "plug" },
  "App": { order: 7, icon: "cog" },
  "AutoUpdate": { order: 8, icon: "sync" },
  "Preview": { order: 9, icon: "file" },
  "Markdown": { order: 10, icon: "markdown" },
  "Telemetry": { order: 11, icon: "chart-bar" },
  "Debug": { order: 12, icon: "bug" }
};
```

## Files to Create/Modify
- **Create**: `frontend/types/settings-metadata.d.ts`
- **Create**: `frontend/app/store/settings-registry.ts`
- **Modify**: `frontend/types/gotypes.d.ts` (add any missing types)

## Acceptance Criteria
- [ ] All settings from `SettingsType` have corresponding metadata entries
- [ ] Each setting has appropriate control type mapped
- [ ] Categories are properly defined with icons and order
- [ ] Search function works across labels, descriptions, and tags
- [ ] TypeScript types are properly defined with no `any` escapes
- [ ] Registry exports are properly typed

## Security Considerations
- Settings keys should be validated against the registry to prevent injection of unknown keys
- Sensitive settings (like API tokens) should be marked appropriately

## Testing Requirements
- Unit tests for `searchSettings` function
- Unit tests for category grouping
- Verify all settings from Go struct are covered

## Dependencies
- None (foundational component)
