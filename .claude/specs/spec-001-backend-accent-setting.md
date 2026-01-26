# Spec: Go Backend - New `app:accent` Setting

**Task:** 1 of UI Theme System Redesign
**Status:** Ready for Implementation
**Dependencies:** None (foundation task)
**Branch:** `feat/experimental-upstream-fixes`
**Date:** 2026-01-26

---

## Objective

Add a new `app:accent` configuration setting to the Wave Terminal backend and frontend type system. This setting controls the accent color palette used throughout the UI. It is the foundation for the two-dimensional theme system where:

- **Mode** (`app:theme`): Dark / Light / System -- controls structural colors
- **Accent** (`app:accent`): Green / Warm / Blue / Purple / Teal -- controls accent colors

The `app:accent` setting defaults to `"green"` and is persisted in `settings.json` alongside all other settings.

---

## Context

### Current Theme Architecture

The current `app:theme` setting in `settings-registry.ts` (line 822-839) has options for `dark`, `light`, and `system`. With the new redesign, `app:theme` remains for mode selection, and `app:accent` is introduced as a separate dimension for accent color.

Both `app:theme` and `app:accent` will be marked `hideFromSettings: true` because they will be rendered via a custom Appearance panel (a later task) rather than the generic settings controls.

### File Locations and Current Line References

| File | Purpose | Key Lines |
|------|---------|-----------|
| `pkg/wconfig/settingsconfig.go` | Go struct definition | Line 62: `AppTheme` field |
| `pkg/wconfig/metaconsts.go` | Go const definitions | Line 15: `ConfigKey_AppTheme` |
| `schema/settings.json` | JSON Schema | Lines 26-28: `"app:theme"` property |
| `frontend/types/gotypes.d.ts` | TypeScript types (generated) | Line 1245: `"app:theme"?: string` |
| `frontend/types/settings-metadata.d.ts` | SettingMetadata interface | Lines 62-99: No `hideFromSettings` field yet |
| `frontend/app/store/settings-registry.ts` | Settings registry | Lines 822-839: `app:theme` entry |

---

## Implementation Steps

### Step 1: Add `hideFromSettings` to SettingMetadata type

**File:** `frontend/types/settings-metadata.d.ts`
**Location:** Inside the `SettingMetadata` interface, after the `fullWidth` field (line 98)

Add the following property:

```typescript
        /** If true, this setting is hidden from the generic settings panel
         *  (it will be rendered by a custom panel instead) */
        hideFromSettings?: boolean;
```

**Rationale:** The `hideFromSettings` flag is needed so the generic settings panel can skip settings that are rendered by specialized UI components (like the Appearance panel). This must be added before the registry entries can use it.

---

### Step 2: Add `AppAccent` field to Go `SettingsType` struct

**File:** `pkg/wconfig/settingsconfig.go`
**Location:** Line 63, immediately after the `AppTheme` field (line 62)

Insert the following line:

```go
	AppAccent                     string `json:"app:accent,omitempty"`
```

**After this change, lines 62-63 should read:**

```go
	AppTheme                      string `json:"app:theme,omitempty"`
	AppAccent                     string `json:"app:accent,omitempty"`
```

**Rationale:** The field follows the same pattern as `AppTheme` -- a simple `string` type with `omitempty` so it only appears in JSON when set. The field is placed immediately after `AppTheme` to keep all `app:` fields grouped together logically.

---

### Step 3: Add `ConfigKey_AppAccent` constant

**File:** `pkg/wconfig/metaconsts.go`
**Location:** Line 16, immediately after `ConfigKey_AppTheme` (line 15)

Insert the following line:

```go
	ConfigKey_AppAccent                      = "app:accent"
```

**After this change, lines 15-16 should read:**

```go
	ConfigKey_AppTheme                       = "app:theme"
	ConfigKey_AppAccent                      = "app:accent"
```

**Rationale:** Constants file mirrors the struct field order and uses the same alignment style (padded with spaces to align the `=` signs).

---

### Step 4: Add `"app:accent"` to JSON Schema

**File:** `schema/settings.json`
**Location:** After the `"app:theme"` property block (lines 26-28)

Insert the following property:

```json
        "app:accent": {
          "type": "string"
        },
```

**After this change, lines 26-31 should read:**

```json
        "app:theme": {
          "type": "string"
        },
        "app:accent": {
          "type": "string"
        },
```

**Rationale:** The schema file validates settings.json and is used for editor autocomplete. The `string` type matches the Go field type. No `enum` constraint is added at the schema level -- validation is handled by the frontend settings registry.

---

### Step 5: Add `"app:accent"` to TypeScript `SettingsType`

**File:** `frontend/types/gotypes.d.ts`
**Location:** After the `"app:theme"?: string;` line (line 1245)

Insert the following line:

```typescript
        "app:accent"?: string;
```

**After this change, lines 1245-1246 should read:**

```typescript
        "app:theme"?: string;
        "app:accent"?: string;
```

**Rationale:** This file is normally auto-generated by `task generate`, but since we are on a fork and may not always run the full generation pipeline, we add it manually. The field is optional (`?`) consistent with all other settings in `SettingsType`.

**Note:** If `task generate` is run after this change, the generated output should include this field automatically since it is derived from the Go struct. Verify that the generated output matches the manual addition.

---

### Step 6: Update `app:theme` entry in settings registry

**File:** `frontend/app/store/settings-registry.ts`
**Location:** Lines 822-839 (the `app:theme` settings entry)

Modify the existing `app:theme` entry to add `hideFromSettings: true`. The current options (`dark`, `light`, `system`) are already correct and should remain unchanged.

**Replace the current `app:theme` entry (lines 822-839) with:**

```typescript
    {
        key: "app:theme",
        label: "UI Theme",
        description: "The UI color theme for the application (dark, light, or system).",
        category: "App",
        subcategory: "Appearance",
        controlType: "select",
        defaultValue: "dark",
        type: "string",
        validation: {
            options: [
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
            ],
        },
        hideFromSettings: true,
        tags: ["theme", "appearance", "dark", "light", "mode"],
    },
```

**Changes from current:**
- Added `hideFromSettings: true` (new line before `tags`)

---

### Step 7: Add `app:accent` entry to settings registry

**File:** `frontend/app/store/settings-registry.ts`
**Location:** Immediately after the `app:theme` entry (after the entry modified in Step 6), before the `app:dismissarchitecturewarning` entry (current line 840)

Insert the following new entry:

```typescript
    {
        key: "app:accent",
        label: "Accent Theme",
        description: "The accent color palette for the application UI.",
        category: "App",
        subcategory: "Appearance",
        controlType: "select",
        defaultValue: "green",
        type: "string",
        validation: {
            options: [
                { value: "green", label: "Green" },
                { value: "warm", label: "Warm" },
                { value: "blue", label: "Blue" },
                { value: "purple", label: "Purple" },
                { value: "teal", label: "Teal" },
            ],
        },
        hideFromSettings: true,
        tags: ["accent", "theme", "color", "appearance"],
    },
```

**Rationale:**
- `hideFromSettings: true` -- This setting will be shown in the custom Appearance panel, not the generic settings list
- `defaultValue: "green"` -- Green is the current/default accent color of Wave Terminal
- Options are listed in the design-specified order: green, warm, blue, purple, teal
- Category and subcategory match `app:theme` since they will be rendered together

---

## Summary of All Changes

| # | File | Change | Type |
|---|------|--------|------|
| 1 | `frontend/types/settings-metadata.d.ts` | Add `hideFromSettings?: boolean` to `SettingMetadata` interface | Add field |
| 2 | `pkg/wconfig/settingsconfig.go` | Add `AppAccent string` field after `AppTheme` | Add field |
| 3 | `pkg/wconfig/metaconsts.go` | Add `ConfigKey_AppAccent` after `ConfigKey_AppTheme` | Add constant |
| 4 | `schema/settings.json` | Add `"app:accent": { "type": "string" }` after `"app:theme"` | Add property |
| 5 | `frontend/types/gotypes.d.ts` | Add `"app:accent"?: string` after `"app:theme"` | Add field |
| 6 | `frontend/app/store/settings-registry.ts` | Add `hideFromSettings: true` to existing `app:theme` entry | Modify entry |
| 7 | `frontend/app/store/settings-registry.ts` | Add new `app:accent` entry after `app:theme` entry | Add entry |

---

## Data Flow

```
settings.json (on disk)
    |
    v
ReadFullConfig() in settingsconfig.go
    |  (JSON -> SettingsType struct)
    |  AppAccent field populated from "app:accent" key
    v
FullConfigType.Settings
    |
    v  (WebSocket push to frontend via WPS)
    |
Frontend receives SettingsType
    |  "app:accent" field available as string
    v
settings-registry.ts metadata
    |  Provides label, options, default, hideFromSettings flag
    v
Appearance Panel (future task)
    |  Reads current value, renders accent picker
    |  Writes via SetBaseConfigValue RPC
    v
settings.json (on disk, updated)
```

---

## Acceptance Criteria

- [ ] `pkg/wconfig/settingsconfig.go` has `AppAccent string` field with `json:"app:accent,omitempty"` tag, positioned after `AppTheme`
- [ ] `pkg/wconfig/metaconsts.go` has `ConfigKey_AppAccent = "app:accent"` constant, positioned after `ConfigKey_AppTheme`
- [ ] `schema/settings.json` has `"app:accent": { "type": "string" }` property, positioned after `"app:theme"`
- [ ] `frontend/types/gotypes.d.ts` has `"app:accent"?: string` in `SettingsType`, positioned after `"app:theme"`
- [ ] `frontend/types/settings-metadata.d.ts` has `hideFromSettings?: boolean` field in `SettingMetadata` interface
- [ ] `frontend/app/store/settings-registry.ts` `app:theme` entry has `hideFromSettings: true`
- [ ] `frontend/app/store/settings-registry.ts` has new `app:accent` entry with all specified metadata
- [ ] `app:accent` entry has `defaultValue: "green"`
- [ ] `app:accent` entry has validation options: green, warm, blue, purple, teal
- [ ] `app:accent` entry has `hideFromSettings: true`
- [ ] Go backend compiles without errors (`go build ./...`)
- [ ] TypeScript type checking passes (`task check:ts`)
- [ ] Setting `"app:accent": "blue"` in `settings.json` is correctly read by the backend
- [ ] Setting a value via `SetBaseConfigValue` RPC with key `"app:accent"` persists correctly

---

## Testing Notes

### Manual Verification

1. Add `"app:accent": "blue"` to `~/.waveterm-dev/config/settings.json`
2. Start the dev server (`task dev`)
3. Open DevTools console and verify: `globalStore.get(atoms.settingsAtom)["app:accent"]` returns `"blue"`
4. Verify the setting does NOT appear in the generic Settings panel (due to `hideFromSettings: true`)

### Build Verification

```bash
# Go compilation
cd G:\Code\waveterm-experimental
go build ./...

# TypeScript type checking
task check:ts
```

---

## Notes

- The `hideFromSettings` flag is a new concept being introduced. Later tasks in the UI Theme System Redesign will use this flag to filter settings from the generic panel. The filtering logic itself is part of a later task -- this spec only adds the field and sets the flag values.
- The `app:accent` default of `"green"` preserves backward compatibility -- existing users who have no `app:accent` set will see the same green accent they are used to.
- No migration is needed since `omitempty` means missing values default to empty string, and the frontend falls back to `defaultValue: "green"` from the registry.

## Dependencies

This spec has no dependencies. However, Spec 003 (Theme Hook Update) depends on this spec being implemented first.

## Related Files Requiring Future Updates

The files `appearance-content.tsx` and `appearance-content.scss` reference `light-gray`/`light-warm` and must be updated by Spec 007 (Appearance Panel Redesign).

## Design Review

**Reviewer:** Phase 1 Design Review Agent
**Verdict:** APPROVED (after fixes applied)
**Date:** 2026-01-26

All issues resolved. Registry entries in this spec are authoritative - Spec 003 should reference this spec for registry definitions.
