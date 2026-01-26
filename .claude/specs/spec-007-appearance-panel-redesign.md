# Spec 007: Appearance Panel Redesign

**Task:** 7 of UI Theme System Redesign (Phase 3)
**Status:** Ready for Implementation
**Dependencies:** Tasks 4 (ModeSelector), 5 (AccentSelector), 6 (ThemePalettePreview)
**Branch:** `feat/UI-Theme-System-Redesign`
**Date:** 2026-01-26

---

## Objective

Completely redesign the Appearance panel (`appearance-content.tsx`) to use the new two-dimensional theme system: Mode (Dark/Light/System) + Accent (Green/Warm/Blue/Purple/Teal). Replace the old 5-card theme selector (`UIThemeSelector`) with the new `ModeSelector`, `AccentSelector`, and `ThemePalettePreview` components. Add a new "Display Settings" collapsible section (from Task 8), keep existing Terminal Color Scheme and OMP sections, and remove the Tab Backgrounds section.

---

## Context

### Current Implementation

**File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\appearance-content.tsx` (182 lines)

The current `AppearanceContent` component:
- Lines 32-38: `THEME_OPTIONS` array with 5 options (dark, light, light-gray, light-warm, system)
- Lines 43-66: `UIThemeSelector` component rendering visual cards for each theme
- Lines 73-178: `AppearanceContent` with 4 `CollapsibleSection` blocks:
  1. "UI Theme" -- `UIThemeSelector` card grid
  2. "Terminal Color Scheme" -- `TermThemeControl` with `PreviewBackgroundToggle`
  3. "Oh-My-Posh Integration" -- `OmpThemeControl`, `OmpHighContrast`, `OmpPaletteExport`, `OmpConfigurator`
  4. "Tab Backgrounds" -- `BgPresetsContent`

**File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\appearance-content.scss` (129 lines)

Current styles include `.appearance-content`, `.appearance-header`, `.ui-theme-selector`, `.theme-card`, `.theme-preview` (with hardcoded colors per variant), `.omp-section`, `.section-divider`.

### Key Patterns

- Settings are read via `useAtomValue(getSettingsKeyAtom("key"))` (from `G:\Code\waveterm-experimental\frontend\app\store\global.ts`, line 352)
- Settings are written via `settingsService.setSetting("key", value)` (from `G:\Code\waveterm-experimental\frontend\app\store\settings-service.ts`, line 115)
- `CollapsibleSection` accepts `title`, `icon`, `isExpanded`, `onToggle`, optional `badge`, and `children` (from `G:\Code\waveterm-experimental\frontend\app\element\collapsible-section.tsx`)
- The parent passes `model: WaveConfigViewModel` as a prop (from `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\waveconfig-model.ts`, line 38)
- All components use `memo()` wrapper pattern

### New Components (from Tasks 4-6)

These components will be created by Tasks 4, 5, and 6 respectively. The specs below describe their expected interfaces:

1. **ModeSelector** -- 3-button segmented control
   - Props: `{ value: string; onChange: (value: string) => void }`
   - Values: `"dark"`, `"light"`, `"system"`
   - Expected file: `frontend/app/element/settings/mode-selector.tsx`

2. **AccentSelector** -- Grid of 5 accent cards with color swatches
   - Props: `{ value: string; onChange: (value: string) => void }`
   - Values: `"green"`, `"warm"`, `"blue"`, `"purple"`, `"teal"`
   - Expected file: `frontend/app/element/settings/accent-selector.tsx`

3. **ThemePalettePreview** -- Live CSS variable color palette display
   - Props: none (reads active CSS variables from the document)
   - Expected file: `frontend/app/element/settings/theme-palette-preview.tsx`

---

## New Layout

```
+-----------------------------------------------------+
| Appearance                                           |
| Customize the look and feel of Wave Terminal         |
+-----------------------------------------------------+
| Mode                                                 |
|  [Dark] [Light] [System]    <- ModeSelector          |
+-----------------------------------------------------+
| Accent Theme                                         |
|  [Green] [Warm] [Blue] [Purple] [Teal]               |
|    <- AccentSelector                                 |
+-----------------------------------------------------+
| Color Palette Preview                                |
|  [bg] [text] [accent] [border] ...                   |
|    <- ThemePalettePreview                            |
+-----------------------------------------------------+
| > Display Settings         (CollapsibleSection)      |
|   [Window, Terminal, Editor, AI sub-sections]        |
|     <- DisplaySettings (Task 8)                      |
+-----------------------------------------------------+
| > Terminal Color Scheme    (CollapsibleSection)       |
|   [PreviewBackgroundToggle + TermThemeControl]       |
+-----------------------------------------------------+
| > Oh-My-Posh Integration  (CollapsibleSection)       |
|   [OmpThemeControl, OmpHighContrast,                 |
|    OmpPaletteExport, OmpConfigurator]                |
+-----------------------------------------------------+
```

---

## Implementation Steps

### Step 1: Remove Old Components and Imports

**File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\appearance-content.tsx`

Remove entirely:
- Lines 32-38: `THEME_OPTIONS` array
- Lines 43-66: `UIThemeSelector` component
- Import of `BgPresetsContent` (line 21)
- Import of `PreviewBackgroundToggle` (line 17, type import)

Add new imports:
```typescript
import { ModeSelector } from "@/app/element/settings/mode-selector";
import { AccentSelector } from "@/app/element/settings/accent-selector";
import { ThemePalettePreview } from "@/app/element/settings/theme-palette-preview";
import { DisplaySettings } from "@/app/view/waveconfig/display-settings";
```

### Step 2: Update State in AppearanceContent

**File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\appearance-content.tsx`

Current state variables (line 74-76):
```typescript
const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["ui-theme", "terminal-theme"]));
const [termPreviewBg, setTermPreviewBg] = useState<PreviewBackground>("dark");
const [ompPreviewBg, setOmpPreviewBg] = useState<PreviewBackground>("dark");
```

Update `expandedSections` default to no longer include `"ui-theme"` (Mode/Accent are always visible, not in a collapsible). Keep `"terminal-theme"` expanded by default. Add `"display"` as collapsed by default:

```typescript
const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["terminal-theme"]));
```

Add atom read for `app:accent`:
```typescript
const appAccent = (useAtomValue(getSettingsKeyAtom("app:accent")) as string) ?? "green";
```

### Step 3: Add Accent Change Handler

After `handleThemeChange` (line 95-97), add:

```typescript
const handleAccentChange = useCallback((value: string) => {
    settingsService.setSetting("app:accent", value);
}, []);
```

### Step 4: Rewrite the JSX Return

Replace the entire return block (lines 114-178) with the new layout:

```tsx
return (
    <div className="appearance-content">
        <div className="appearance-header">
            <h2>Appearance</h2>
            <p className="appearance-subtitle">Customize the look and feel of Wave Terminal</p>
        </div>

        {/* Mode and Accent are always visible (not collapsible) */}
        <div className="appearance-section">
            <div className="appearance-section-label">Mode</div>
            <ModeSelector value={appTheme} onChange={handleThemeChange} />
        </div>

        <div className="appearance-section">
            <div className="appearance-section-label">Accent Theme</div>
            <AccentSelector value={appAccent} onChange={handleAccentChange} />
        </div>

        <div className="appearance-section">
            <div className="appearance-section-label">Color Palette Preview</div>
            <ThemePalettePreview />
        </div>

        {/* Collapsible sections */}
        <CollapsibleSection
            title="Display Settings"
            icon="sliders"
            isExpanded={expandedSections.has("display")}
            onToggle={() => toggleSection("display")}
        >
            <DisplaySettings />
        </CollapsibleSection>

        <CollapsibleSection
            title="Terminal Color Scheme"
            icon="terminal"
            isExpanded={expandedSections.has("terminal-theme")}
            onToggle={() => toggleSection("terminal-theme")}
        >
            <PreviewBackgroundToggle value={termPreviewBg} onChange={setTermPreviewBg} />
            <TermThemeControl
                value={termTheme}
                onChange={handleTermThemeChange}
                previewBackground={termPreviewBg}
            />
        </CollapsibleSection>

        <CollapsibleSection
            title="Oh-My-Posh Integration"
            icon="wand-magic-sparkles"
            isExpanded={expandedSections.has("omp")}
            onToggle={() => toggleSection("omp")}
        >
            <div className="omp-section">
                <PreviewBackgroundToggle value={ompPreviewBg} onChange={setOmpPreviewBg} />
                <OmpThemeControl
                    value={ompTheme}
                    onChange={handleOmpThemeChange}
                    previewBackground={ompPreviewBg}
                />
                <div className="section-divider" />
                <OmpHighContrast />
                <div className="section-divider" />
                <OmpPaletteExport />
                <div className="section-divider" />
                <OmpConfigurator
                    previewBackground={ompPreviewBg}
                    onConfigChange={handleOmpConfigChange}
                />
            </div>
        </CollapsibleSection>
    </div>
);
```

### Step 5: Update SCSS

**File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\appearance-content.scss`

Remove the entire `.ui-theme-selector` block (lines 30-116) including all `.theme-card`, `.theme-preview`, `.theme-check` styles and the hardcoded theme variant colors.

Add new styles for the always-visible sections:

```scss
.appearance-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 4px;

    .appearance-section-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
}
```

Keep existing `.omp-section` and `.section-divider` styles (lines 118-128) unchanged.

### Step 6: Remove Unused Imports

After the rewrite, verify that the following are no longer imported if unused:
- `BgPresetsContent` -- removed (Tab Backgrounds section gone)
- `type PreviewBackground` -- still needed (used for term and OMP preview backgrounds)
- `PreviewBackgroundToggle` -- still needed (used in Terminal and OMP sections)

Keep import of `PreviewBackgroundToggle` and `PreviewBackground` type. The import line (line 17) stays as-is since both are still used.

---

## Complete Final Import List

```typescript
import { CollapsibleSection } from "@/app/element/collapsible-section";
import { OmpConfigurator } from "@/app/element/settings/omp-configurator";
import { reinitOmpInAllTerminals } from "@/app/element/settings/omp-configurator/omp-utils";
import { OmpHighContrast } from "@/app/element/settings/omp-high-contrast";
import { OmpPaletteExport } from "@/app/element/settings/omp-palette-export";
import { OmpThemeControl } from "@/app/element/settings/omptheme-control";
import { PreviewBackgroundToggle, type PreviewBackground } from "@/app/element/settings/preview-background-toggle";
import { TermThemeControl } from "@/app/element/settings/termtheme-control";
import { ModeSelector } from "@/app/element/settings/mode-selector";
import { AccentSelector } from "@/app/element/settings/accent-selector";
import { ThemePalettePreview } from "@/app/element/settings/theme-palette-preview";
import { DisplaySettings } from "@/app/view/waveconfig/display-settings";
import { getSettingsKeyAtom } from "@/app/store/global";
import { settingsService } from "@/app/store/settings-service";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useCallback, useState } from "react";

import "./appearance-content.scss";
```

---

## Data Flow

```
User clicks Mode button (e.g., "Light")
  -> ModeSelector.onChange("light")
    -> handleThemeChange("light")
      -> settingsService.setSetting("app:theme", "light")
        -> pendingSettingsAtom updated (optimistic)
        -> debounced save to settings.json via RPC
        -> WPS event triggers fullConfigAtom update
        -> useTheme hook detects change, updates data-theme attribute
        -> CSS variables cascade updates all colors
        -> ThemePalettePreview re-renders with new CSS vars

User clicks Accent card (e.g., "Blue")
  -> AccentSelector.onChange("blue")
    -> handleAccentChange("blue")
      -> settingsService.setSetting("app:accent", "blue")
        -> Same flow as above, updates data-accent attribute
        -> Accent CSS variables update
```

---

## Acceptance Criteria

- [ ] `UIThemeSelector` component and `THEME_OPTIONS` are completely removed
- [ ] `ModeSelector` renders a 3-button segmented control (Dark/Light/System) reading `app:theme`
- [ ] `AccentSelector` renders a 5-card grid reading `app:accent`
- [ ] `ThemePalettePreview` renders below the accent selector
- [ ] "Display Settings" collapsible section is present and renders `DisplaySettings` (Task 8)
- [ ] "Terminal Color Scheme" collapsible section is preserved with `PreviewBackgroundToggle` and `TermThemeControl`
- [ ] "Oh-My-Posh Integration" collapsible section is preserved with all sub-components
- [ ] "Tab Backgrounds" collapsible section is removed; `BgPresetsContent` is no longer imported
- [ ] Clicking Mode buttons immediately updates `app:theme` via `settingsService.setSetting()`
- [ ] Clicking Accent cards immediately updates `app:accent` via `settingsService.setSetting()`
- [ ] The panel header ("Appearance" / subtitle) is preserved
- [ ] SCSS no longer contains hardcoded theme variant colors (`.dark`, `.light`, `.light-gray`, `.light-warm`, `.system`)
- [ ] All changes compile without TypeScript errors (`task check:ts`)
- [ ] The `model` prop is kept in `AppearanceContentProps` for compatibility even if not directly used by the new components

---

## Files Modified

| File | Change |
|------|--------|
| `frontend/app/view/waveconfig/appearance-content.tsx` | Full rewrite of component structure |
| `frontend/app/view/waveconfig/appearance-content.scss` | Remove old theme card styles, add section label styles |

## Files Not Modified (consumed as dependencies)

| File | Role |
|------|------|
| `frontend/app/element/collapsible-section.tsx` | CollapsibleSection component (unchanged) |
| `frontend/app/element/settings/mode-selector.tsx` | Task 4 output |
| `frontend/app/element/settings/accent-selector.tsx` | Task 5 output |
| `frontend/app/element/settings/theme-palette-preview.tsx` | Task 6 output |
| `frontend/app/view/waveconfig/display-settings.tsx` | Task 8 output |
| `frontend/app/store/global.ts` | `getSettingsKeyAtom` |
| `frontend/app/store/settings-service.ts` | `settingsService.setSetting()` |
