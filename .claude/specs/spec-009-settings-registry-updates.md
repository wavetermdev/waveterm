# Spec 009: Settings Registry Updates (hideFromSettings)

**Task:** 9 of UI Theme System Redesign (Phase 3)
**Status:** Ready for Implementation
**Dependencies:** Task 1 (adds `hideFromSettings` to `SettingMetadata` type), Tasks 7-8 (provide the Appearance panel that replaces these settings in General)
**Branch:** `feat/UI-Theme-System-Redesign`
**Date:** 2026-01-26

---

## Objective

1. Add `hideFromSettings: true` to all settings in `settings-registry.ts` that now have dedicated controls on the Appearance panel, preventing them from appearing in the General settings list.
2. Update the filtering logic in `settings-registry.ts` and/or `settings-visual.tsx` to exclude settings with `hideFromSettings: true` from the General settings view.
3. Ensure these hidden settings are still searchable and accessible via the search function (so users who search for "font size" still find them).

---

## Context

### The hideFromSettings Field

Task 1 (spec-001-backend-accent-setting.md) adds the `hideFromSettings?: boolean` optional field to the `SettingMetadata` interface in `frontend/types/settings-metadata.d.ts`. This spec assumes that field already exists.

**Type definition location:** `G:\Code\waveterm-experimental\frontend\types\settings-metadata.d.ts`, line 98 area (after `fullWidth`)

```typescript
/** If true, hide from the General settings list (has dedicated UI elsewhere) */
hideFromSettings?: boolean;
```

If Task 1 has NOT yet added this field, Step 1 below must add it.

### Current Filtering Pipeline

The General settings view uses this call chain:

1. `settings-visual.tsx` line 560: `getSettingsByCategoryForPlatform(platform)`
2. `settings-registry.ts` line 1140-1155: `getSettingsByCategoryForPlatform()` calls `getSettingsForPlatform()`
3. `settings-registry.ts` line 1131-1135: `getSettingsForPlatform()` filters by platform only:
   ```typescript
   function getSettingsForPlatform(platform: "darwin" | "win32" | "linux"): SettingMetadata[] {
       return Array.from(settingsRegistry.values()).filter(
           (setting) => !setting.platform || setting.platform === "all" || setting.platform === platform
       );
   }
   ```

The `searchSettings()` function (line 1079-1126) iterates ALL settings in the registry without filtering -- this is correct and should remain unchanged so hidden settings are still searchable.

### Settings to Hide

These 19 settings now have dedicated controls on the Appearance panel and should be hidden from the General settings view:

**Theme Controls (Mode + Accent):**
| Key | Current Location in Registry | Appearance Panel Location |
|-----|------------------------------|--------------------------|
| `app:theme` | Line 823, category "App", subcategory "Appearance" | ModeSelector (Task 4/7) |
| `app:accent` | Added by Task 1 | AccentSelector (Task 5/7) |

**Display Settings (Task 8):**
| Key | Current Location in Registry | Appearance Panel Location |
|-----|------------------------------|--------------------------|
| `window:transparent` | Line 300, category "Window", subcategory "Appearance" | Display > Window |
| `window:blur` | Line 313, category "Window", subcategory "Appearance" | Display > Window |
| `window:opacity` | Line 325, category "Window", subcategory "Appearance" | Display > Window |
| `window:bgcolor` | Line 338, category "Window", subcategory "Appearance" | Display > Window |
| `window:zoom` | Line 442, category "Window", subcategory "Appearance" | Display > Window |
| `term:fontsize` | Line 34, category "Terminal", subcategory "Appearance" | Display > Terminal |
| `term:fontfamily` | Line 46, category "Terminal", subcategory "Appearance" | Display > Terminal |
| `term:ligatures` | Line 106, category "Terminal", subcategory "Appearance" | Display > Terminal |
| `term:transparency` | Line 93, category "Terminal", subcategory "Appearance" | Display > Terminal |
| `editor:fontsize` | Line 240, category "Editor", subcategory "Appearance" | Display > Editor |
| `editor:minimapenabled` | Line 251, category "Editor", subcategory "Appearance" | Display > Editor |
| `ai:fontsize` | Line 632, category "AI", subcategory "Appearance" | Display > AI |
| `ai:fixedfontsize` | Line 643, category "AI", subcategory "Appearance" | Display > AI |

**Terminal Theme Controls (already on Appearance panel):**
| Key | Current Location in Registry | Appearance Panel Location |
|-----|------------------------------|--------------------------|
| `term:theme` | Line 57, category "Terminal", subcategory "Appearance" | Terminal Color Scheme section |
| `term:omptheme` | Line 198, category "Terminal", subcategory "Prompt Compatibility" | OMP Integration section |
| `term:ompexport` | Line 210, category "Terminal", subcategory "Prompt Compatibility" | OMP Integration section |
| `term:promptcompat` | Line 223, category "Terminal", subcategory "Prompt Compatibility" | OMP Integration section |

### Settings to Keep in General

These settings remain in the General settings view (no Appearance panel equivalent):

- `window:showmenubar` -- Linux menu bar (platform-specific, not purely visual)
- `window:nativetitlebar` -- OS integration setting
- `window:dimensions` -- Layout, not appearance
- `window:magnifiedblockopacity`, `window:magnifiedblocksize`, `window:magnifiedblockblurprimarypx`, `window:magnifiedblockblursecondarypx` -- Niche magnification settings
- `window:reducedmotion` -- Accessibility setting
- `window:tilegapsize` -- Layout setting
- `window:disablehardwareacceleration` -- Performance setting
- `window:fullscreenonlaunch`, `window:confirmclose`, `window:savelastwindow`, `window:maxtabcachesize` -- Behavior settings
- `markdown:fontsize`, `markdown:fixedfontsize` -- Markdown-specific, not on Appearance panel
- All other non-visual settings (shell, AI config, connections, etc.)

---

## Implementation Steps

### Step 1: Verify hideFromSettings Field Exists

**File:** `G:\Code\waveterm-experimental\frontend\types\settings-metadata.d.ts`

Verify the `SettingMetadata` interface (line 62) has the `hideFromSettings` field. If Task 1 has not yet added it, add it after the `fullWidth` field (line 98):

```typescript
/** If true, hide from the General settings list (has dedicated UI elsewhere) */
hideFromSettings?: boolean;
```

This step is idempotent -- if the field already exists, skip it.

### Step 2: Add hideFromSettings to Settings in Registry

**File:** `G:\Code\waveterm-experimental\frontend\app\store\settings-registry.ts`

For each of the 19 settings listed above, add `hideFromSettings: true` to the metadata object. The changes are purely additive -- just adding one property to each object.

**Theme settings:**

For `app:theme` and `app:accent`: verify that `hideFromSettings: true` is already present (added by Spec 001). If not, add it. These entries are idempotent with Spec 001 -- Spec 001 is the authoritative source for these two entries.

**Window display settings** (5 entries):

At `window:transparent` (line ~300), `window:blur` (line ~313), `window:opacity` (line ~325), `window:bgcolor` (line ~338), `window:zoom` (line ~442):
```typescript
hideFromSettings: true,  // <-- ADD to each
```

**Terminal display settings** (4 entries):

At `term:fontsize` (line ~34), `term:fontfamily` (line ~46), `term:ligatures` (line ~106), `term:transparency` (line ~93):
```typescript
hideFromSettings: true,  // <-- ADD to each
```

**Editor display settings** (2 entries):

At `editor:fontsize` (line ~240), `editor:minimapenabled` (line ~251):
```typescript
hideFromSettings: true,  // <-- ADD to each
```

**AI display settings** (2 entries):

At `ai:fontsize` (line ~632), `ai:fixedfontsize` (line ~643):
```typescript
hideFromSettings: true,  // <-- ADD to each
```

**Terminal theme/OMP settings** (4 entries):

At `term:theme` (line ~57), `term:omptheme` (line ~198), `term:ompexport` (line ~210), `term:promptcompat` (line ~223):
```typescript
hideFromSettings: true,  // <-- ADD to each
```

### Step 3: Update getSettingsForPlatform to Filter Hidden Settings

**File:** `G:\Code\waveterm-experimental\frontend\app\store\settings-registry.ts`

Update `getSettingsForPlatform()` (line 1131-1135) to also filter out settings with `hideFromSettings: true`:

**Before:**
```typescript
function getSettingsForPlatform(platform: "darwin" | "win32" | "linux"): SettingMetadata[] {
    return Array.from(settingsRegistry.values()).filter(
        (setting) => !setting.platform || setting.platform === "all" || setting.platform === platform
    );
}
```

**After:**
```typescript
function getSettingsForPlatform(platform: "darwin" | "win32" | "linux"): SettingMetadata[] {
    return Array.from(settingsRegistry.values()).filter(
        (setting) =>
            !setting.hideFromSettings &&
            (!setting.platform || setting.platform === "all" || setting.platform === platform)
    );
}
```

This single change propagates through the entire General settings view because:
- `getSettingsByCategoryForPlatform()` (line 1140) calls `getSettingsForPlatform()`
- `SettingsList` in `settings-visual.tsx` (line 560) calls `getSettingsByCategoryForPlatform()`
- `CategorySidebar` in `settings-visual.tsx` (line 192) calls `getSettingsByCategoryForPlatform()`

### Step 4: Keep searchSettings Unchanged

**File:** `G:\Code\waveterm-experimental\frontend\app\store\settings-registry.ts`

Verify that `searchSettings()` (line 1079-1126) does NOT filter by `hideFromSettings`. This is already the case -- the function iterates `settingsRegistry.values()` directly. No change needed.

This ensures that if a user types "font size" in the search box, they will still see `term:fontsize`, `editor:fontsize`, `ai:fontsize`, etc. in the search results, even though those settings are hidden from the categorized list.

### Step 5: Verify Category Count Updates

After hiding settings, some categories may show fewer items in the sidebar count badge. The `CategorySidebar` component (line 244 in `settings-visual.tsx`) renders `settings.length` from `settingsByCategory`:

```tsx
<span className="category-count">{settings.length}</span>
```

This will automatically reflect the correct count because `settingsByCategory` is derived from `getSettingsByCategoryForPlatform()`, which now excludes hidden settings. No code change needed.

However, verify that no category becomes empty after hiding settings. Check:
- **Terminal** category: Has 17 settings, hiding 8 (fontsize, fontfamily, theme, transparency, ligatures, omptheme, ompexport, promptcompat). Remaining 9: scrollback, copyonselect, disablewebgl, localshellpath, localshellopts, allowbracketedpaste, shiftenternewline, macoptionismeta, gitbashpath. That is 9 remaining -- safe.
- **Editor** category: Has 5 settings, hiding 2 (fontsize, minimap). Remaining 3: stickyscroll, wordwrap, inlinediff -- safe.
- **Window** category: Has 19 settings, hiding 5 (transparent, blur, opacity, bgcolor, zoom). Remaining 14 -- safe.
- **AI** category: Has 13 settings, hiding 2 (fontsize, fixedfontsize). Remaining 11 -- safe.
- **App** category: Has 7 settings (8 after Task 1 adds app:accent), hiding 1 (theme). Remaining 5 (6 after Task 1) -- safe.

No category becomes empty. Good.

---

## Complete List of Changes by File

### `frontend/types/settings-metadata.d.ts`

Add `hideFromSettings?: boolean` to `SettingMetadata` interface if not already present from Task 1.

### `frontend/app/store/settings-registry.ts`

1. Add `hideFromSettings: true` to these 19 settings:
   - `app:theme`
   - `app:accent` (if present from Task 1)
   - `window:transparent`
   - `window:blur`
   - `window:opacity`
   - `window:bgcolor`
   - `window:zoom`
   - `term:fontsize`
   - `term:fontfamily`
   - `term:theme`
   - `term:transparency`
   - `term:ligatures`
   - `term:omptheme`
   - `term:ompexport`
   - `term:promptcompat`
   - `editor:fontsize`
   - `editor:minimapenabled`
   - `ai:fontsize`
   - `ai:fixedfontsize`

2. Update `getSettingsForPlatform()` filter to exclude `hideFromSettings: true`

### NO changes to `settings-visual.tsx`

The filtering is handled in `settings-registry.ts` at the data layer. The `settings-visual.tsx` components (`CategorySidebar`, `SettingsList`) automatically pick up the change because they consume `getSettingsByCategoryForPlatform()`.

---

## Data Flow

```
General Settings Panel opens
  -> SettingsList renders
    -> calls getSettingsByCategoryForPlatform(platform)
      -> calls getSettingsForPlatform(platform)
        -> filters: !setting.hideFromSettings && platform match
        -> Returns ~60 settings (was ~79 before hiding 19)
      -> Groups by category
    -> Renders categories with correct counts
    -> Hidden settings are NOT shown

User types "font size" in search bar
  -> searchSettings("font size") called
    -> Iterates ALL settingsRegistry.values() (no hideFromSettings filter)
    -> Returns all matching settings including hidden ones
    -> User sees term:fontsize, editor:fontsize, ai:fontsize, etc.
    -> User can still modify values via the search result controls
```

---

## Acceptance Criteria

- [ ] `SettingMetadata` interface has `hideFromSettings?: boolean` field
- [ ] All 19 specified settings have `hideFromSettings: true` in their metadata
- [ ] `getSettingsForPlatform()` filters out settings with `hideFromSettings: true`
- [ ] General settings panel no longer shows the 19 hidden settings in the categorized list
- [ ] Category counts in the sidebar update correctly (no zero-count categories)
- [ ] Search still finds hidden settings (searchSettings is unchanged)
- [ ] Settings that should remain in General (menubar, titlebar, dimensions, magnification, reduced motion, markdown fonts, etc.) are NOT hidden
- [ ] No TypeScript compilation errors (`task check:ts`)
- [ ] The `app:accent` entry (from Task 1) has `hideFromSettings: true`
- [ ] `getSubcategoriesForCategory()` reflects correct subcategories (some "Appearance" subcategories may disappear from categories if all their settings are hidden -- this is expected and correct)

---

## Edge Cases

### Empty Subcategories

After hiding all "Appearance" subcategory settings from a category, that subcategory header will no longer appear in the General settings view. For example:

- **Terminal > Appearance** subcategory had: fontsize, fontfamily, theme, transparency, ligatures. All 5 are hidden. The "Appearance" subcategory header disappears from the Terminal category -- this is expected and correct.
- **Window > Appearance** subcategory had: transparent, blur, opacity, bgcolor, showmenubar, nativetitlebar, zoom. After hiding 5, `showmenubar` and `nativetitlebar` remain -- the subcategory stays visible.

### Search Results for Hidden Settings

When a user finds a hidden setting via search and modifies it, the change is persisted normally via `settingsService.setSetting()`. The setting is still fully functional -- it is just not visible in the categorized list. This is intentional: search serves as a fallback access path.

### Backward Compatibility

Adding `hideFromSettings: true` to metadata objects is purely additive. Existing code that does not check this field continues to work. Only `getSettingsForPlatform()` is updated to respect it.

---

## Files Modified

| File | Change |
|------|--------|
| `frontend/types/settings-metadata.d.ts` | Add `hideFromSettings?: boolean` to interface (if not from Task 1) |
| `frontend/app/store/settings-registry.ts` | Add `hideFromSettings: true` to 19 entries; update `getSettingsForPlatform()` filter |

## Files NOT Modified

| File | Reason |
|------|--------|
| `frontend/app/view/waveconfig/settings-visual.tsx` | Filtering handled at data layer in registry |
| `frontend/app/store/settings-atoms.ts` | No changes needed |
| `frontend/app/store/settings-service.ts` | No changes needed |

## Design Review

**Reviewer:** Phase 3 Design Review Agent
**Verdict:** APPROVED (after fixes applied)
**Date:** 2026-01-26

Category count documentation corrected. Implementation logic is correct.
