# Spec 008: Move Display Settings from General to Appearance

**Task:** 8 of UI Theme System Redesign (Phase 3)
**Status:** Ready for Implementation
**Dependencies:** Task 7 (Appearance Panel Redesign -- consumes this component)
**Branch:** `feat/UI-Theme-System-Redesign`
**Date:** 2026-01-26

---

## Objective

Create a `DisplaySettings` component that renders inline controls for visual/display-related settings. This component is embedded inside the "Display Settings" `CollapsibleSection` on the Appearance panel (Task 7). It groups settings into four sub-sections: Window, Terminal, Editor, and AI. Each setting uses the same control components (`ToggleControl`, `SliderControl`, `ColorControl`, `FontControl`) already used throughout the settings system.

---

## Context

### Why Move These Settings

Currently, display-related settings are scattered throughout the General settings panel (`settings-visual.tsx`), interleaved with non-visual settings like shell paths, scrollback, API configuration, etc. Moving the visual/display subset to the Appearance panel:

1. Creates a single destination for all visual customization
2. Reduces noise in the General settings panel
3. Allows these settings to appear alongside the theme/accent controls for a cohesive experience

These settings are NOT removed from the registry -- they continue to exist there and can still be found via search. They are just hidden from the General settings list view (Task 9 adds `hideFromSettings: true`).

### Settings to Include

| Setting Key | Control Type | Label | Min | Max | Step | Notes |
|------------|-------------|-------|-----|-----|------|-------|
| **Window** | | | | | | |
| `window:transparent` | toggle | Transparent Window | - | - | - | `requiresRestart: true` |
| `window:blur` | toggle | Background Blur | - | - | - | |
| `window:opacity` | slider | Window Opacity | 0.1 | 1 | 0.05 | |
| `window:bgcolor` | color | Background Color | - | - | - | |
| `window:zoom` | slider | Interface Zoom | 0.5 | 2 | 0.1 | |
| **Terminal** | | | | | | |
| `term:fontsize` | slider | Terminal Font Size | 8 | 24 | 1 | |
| `term:fontfamily` | font | Terminal Font | - | - | - | |
| `term:ligatures` | toggle | Font Ligatures | - | - | - | |
| `term:transparency` | slider | Terminal Transparency | 0 | 1 | 0.1 | |
| **Editor** | | | | | | |
| `editor:fontsize` | slider | Editor Font Size | 8 | 24 | 1 | |
| `editor:minimapenabled` | toggle | Show Minimap | - | - | - | |
| **AI** | | | | | | |
| `ai:fontsize` | slider | AI Panel Font Size | 10 | 24 | 1 | |
| `ai:fixedfontsize` | slider | AI Code Font Size | 8 | 20 | 1 | |

### Existing Control Components

All control components are already implemented and exported from `G:\Code\waveterm-experimental\frontend\app\element\settings\index.ts`:

| Component | File | Props |
|-----------|------|-------|
| `ToggleControl` | `frontend/app/element/settings/toggle-control.tsx` | `{ value: boolean; onChange: (v: boolean) => void }` |
| `SliderControl` | `frontend/app/element/settings/slider-control.tsx` | `{ value: number; onChange: (v: number) => void; min?; max?; step? }` |
| `ColorControl` | `frontend/app/element/settings/color-control.tsx` | `{ value: string; onChange: (v: string) => void }` |
| `FontControl` | `frontend/app/element/settings/font-control.tsx` | `{ value: string; onChange: (v: string) => void }` |

### Settings Read/Write Pattern

From `G:\Code\waveterm-experimental\frontend\app\store\global.ts` (line 352):
```typescript
function getSettingsKeyAtom<T extends keyof SettingsType>(key: T): Atom<SettingsType[T]>
```

From `G:\Code\waveterm-experimental\frontend\app\store\settings-service.ts` (line 115):
```typescript
settingsService.setSetting(key: string, value: unknown): void
```

### Existing Pattern: SettingControl Wrapper

From `G:\Code\waveterm-experimental\frontend\app\element\settings\setting-control.tsx`, the `SettingControl` component provides a consistent row layout with label, description, reset button, and modified indicator. However, for the Display Settings component, we will use a more compact inline layout without the full `SettingControl` wrapper, since the settings are grouped visually rather than listed individually.

---

## Implementation Steps

### Step 1: Create the DisplaySettings Component

**New File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\display-settings.tsx`

This component renders all display-related settings with compact inline controls, grouped by sub-section.

```typescript
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Display Settings
 *
 * Compact inline controls for visual/display settings,
 * embedded in the Appearance panel's "Display Settings" collapsible section.
 */

import { ColorControl } from "@/app/element/settings/color-control";
import { FontControl } from "@/app/element/settings/font-control";
import { SliderControl } from "@/app/element/settings/slider-control";
import { ToggleControl } from "@/app/element/settings/toggle-control";
import { getSettingsKeyAtom } from "@/app/store/global";
import { settingsService } from "@/app/store/settings-service";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

import "./display-settings.scss";
```

### Step 2: Define the DisplaySettingRow Helper

Inside `display-settings.tsx`, create a compact row component for individual settings:

```tsx
interface DisplaySettingRowProps {
    label: string;
    description?: string;
    requiresRestart?: boolean;
    children: React.ReactNode;
}

const DisplaySettingRow = memo(({ label, description, requiresRestart, children }: DisplaySettingRowProps) => {
    return (
        <div className="display-setting-row">
            <div className="display-setting-info">
                <span className="display-setting-label">{label}</span>
                {requiresRestart && <span className="display-setting-restart">Restart required</span>}
                {description && <span className="display-setting-description">{description}</span>}
            </div>
            <div className="display-setting-control">{children}</div>
        </div>
    );
});

DisplaySettingRow.displayName = "DisplaySettingRow";
```

### Step 3: Define the Sub-Section Header

```tsx
interface SubSectionProps {
    title: string;
    children: React.ReactNode;
}

const SubSection = memo(({ title, children }: SubSectionProps) => {
    return (
        <div className="display-subsection">
            <div className="display-subsection-title">{title}</div>
            <div className="display-subsection-content">{children}</div>
        </div>
    );
});

SubSection.displayName = "SubSection";
```

### Step 4: Implement the Main DisplaySettings Component

```tsx
export const DisplaySettings = memo(() => {
    // Window settings
    const windowTransparent = useAtomValue(getSettingsKeyAtom("window:transparent")) ?? false;
    const windowBlur = useAtomValue(getSettingsKeyAtom("window:blur")) ?? false;
    const windowOpacity = useAtomValue(getSettingsKeyAtom("window:opacity")) ?? 1;
    const windowBgcolor = useAtomValue(getSettingsKeyAtom("window:bgcolor")) ?? "";
    const windowZoom = useAtomValue(getSettingsKeyAtom("window:zoom")) ?? 1;

    // Terminal settings
    const termFontsize = useAtomValue(getSettingsKeyAtom("term:fontsize")) ?? 12;
    const termFontfamily = useAtomValue(getSettingsKeyAtom("term:fontfamily")) ?? "";
    const termLigatures = useAtomValue(getSettingsKeyAtom("term:ligatures")) ?? false;
    const termTransparency = useAtomValue(getSettingsKeyAtom("term:transparency")) ?? 0;

    // Editor settings
    const editorFontsize = useAtomValue(getSettingsKeyAtom("editor:fontsize")) ?? 12;
    const editorMinimap = useAtomValue(getSettingsKeyAtom("editor:minimapenabled")) ?? false;

    // AI settings
    const aiFontsize = useAtomValue(getSettingsKeyAtom("ai:fontsize")) ?? 14;
    const aiFixedFontsize = useAtomValue(getSettingsKeyAtom("ai:fixedfontsize")) ?? 12;

    // Generic change handler factory
    const makeSetter = useCallback(
        (key: string) => (value: unknown) => {
            settingsService.setSetting(key, value);
        },
        []
    );

    return (
        <div className="display-settings">
            <SubSection title="Window">
                <DisplaySettingRow label="Transparent Window" requiresRestart>
                    <ToggleControl
                        value={Boolean(windowTransparent)}
                        onChange={makeSetter("window:transparent") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Background Blur">
                    <ToggleControl
                        value={Boolean(windowBlur)}
                        onChange={makeSetter("window:blur") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Window Opacity">
                    <SliderControl
                        value={Number(windowOpacity)}
                        onChange={makeSetter("window:opacity") as (v: number) => void}
                        min={0.1}
                        max={1}
                        step={0.05}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Background Color">
                    <ColorControl
                        value={String(windowBgcolor)}
                        onChange={makeSetter("window:bgcolor") as (v: string) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Interface Zoom">
                    <SliderControl
                        value={Number(windowZoom)}
                        onChange={makeSetter("window:zoom") as (v: number) => void}
                        min={0.5}
                        max={2}
                        step={0.1}
                    />
                </DisplaySettingRow>
            </SubSection>

            <SubSection title="Terminal">
                <DisplaySettingRow label="Font Size">
                    <SliderControl
                        value={Number(termFontsize)}
                        onChange={makeSetter("term:fontsize") as (v: number) => void}
                        min={8}
                        max={24}
                        step={1}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Font Family">
                    <FontControl
                        value={String(termFontfamily)}
                        onChange={makeSetter("term:fontfamily") as (v: string) => void}
                        showPreview={false}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Font Ligatures">
                    <ToggleControl
                        value={Boolean(termLigatures)}
                        onChange={makeSetter("term:ligatures") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Transparency">
                    <SliderControl
                        value={Number(termTransparency)}
                        onChange={makeSetter("term:transparency") as (v: number) => void}
                        min={0}
                        max={1}
                        step={0.1}
                    />
                </DisplaySettingRow>
            </SubSection>

            <SubSection title="Editor">
                <DisplaySettingRow label="Font Size">
                    <SliderControl
                        value={Number(editorFontsize)}
                        onChange={makeSetter("editor:fontsize") as (v: number) => void}
                        min={8}
                        max={24}
                        step={1}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Show Minimap">
                    <ToggleControl
                        value={Boolean(editorMinimap)}
                        onChange={makeSetter("editor:minimapenabled") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
            </SubSection>

            <SubSection title="AI Panel">
                <DisplaySettingRow label="Text Font Size">
                    <SliderControl
                        value={Number(aiFontsize)}
                        onChange={makeSetter("ai:fontsize") as (v: number) => void}
                        min={10}
                        max={24}
                        step={1}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Code Font Size">
                    <SliderControl
                        value={Number(aiFixedFontsize)}
                        onChange={makeSetter("ai:fixedfontsize") as (v: number) => void}
                        min={8}
                        max={20}
                        step={1}
                    />
                </DisplaySettingRow>
            </SubSection>
        </div>
    );
});

DisplaySettings.displayName = "DisplaySettings";
```

### Step 5: Create SCSS for DisplaySettings

**New File:** `G:\Code\waveterm-experimental\frontend\app\view\waveconfig\display-settings.scss`

```scss
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

.display-settings {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.display-subsection {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .display-subsection-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--border-color);
    }

    .display-subsection-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
}

.display-setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px;
    border-radius: 4px;
    min-height: 36px;

    &:hover {
        background: var(--hover-bg-color);
    }

    .display-setting-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;

        .display-setting-label {
            font-size: 13px;
            font-weight: 500;
            color: var(--main-text-color);
            white-space: nowrap;
        }

        .display-setting-restart {
            font-size: 10px;
            color: var(--warning-color, #e8a838);
            background: rgba(232, 168, 56, 0.1);
            padding: 1px 6px;
            border-radius: 3px;
            white-space: nowrap;
        }

        .display-setting-description {
            font-size: 11px;
            color: var(--grey-text-color);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }

    .display-setting-control {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        min-width: 140px;
        justify-content: flex-end;
    }
}
```

### Step 6: Design Decisions

**Why a compact layout instead of full SettingControl rows?**

The `SettingControl` component (from `setting-control.tsx`) renders each setting as a tall row with label, description text below, and a control on the right. This is appropriate for the General settings panel where each setting needs full context. In the Display Settings section, however:

1. The settings are already grouped by sub-section (Window, Terminal, etc.), providing context
2. The collapsible section is one of several on the Appearance page -- vertical space is at a premium
3. Users visiting the Appearance panel understand these are visual controls -- less explanation needed
4. The compact layout (label + control on same line) is more scannable

**Why `makeSetter` factory pattern?**

The `makeSetter` callback factory avoids creating a unique `useCallback` for each of the 13 settings. It creates a stable function that constructs setters on demand. This is the same pattern used in the existing codebase for bulk event handler creation.

**Why `showPreview={false}` on FontControl?**

The `FontControl` component (from `font-control.tsx`, line 88) has an optional `showPreview` prop. In the compact Display Settings layout, the font preview text would take too much vertical space. The user can still see the font name in the dropdown.

---

## Data Flow

```
User adjusts Terminal Font Size slider to 16
  -> SliderControl.onChange(16)
    -> makeSetter("term:fontsize")(16)
      -> settingsService.setSetting("term:fontsize", 16)
        -> pendingSettingsAtom updated immediately (optimistic)
        -> getSettingsKeyAtom("term:fontsize") emits 16
        -> All terminal blocks re-render with new font size
        -> Debounced save to settings.json (500ms)
```

---

## Acceptance Criteria

- [ ] New file `display-settings.tsx` created at `frontend/app/view/waveconfig/`
- [ ] New file `display-settings.scss` created at `frontend/app/view/waveconfig/`
- [ ] Component exports `DisplaySettings` as a named export
- [ ] Window sub-section renders 5 controls: transparent (toggle), blur (toggle), opacity (slider), bgcolor (color), zoom (slider)
- [ ] Terminal sub-section renders 4 controls: fontsize (slider), fontfamily (font), ligatures (toggle), transparency (slider)
- [ ] Editor sub-section renders 2 controls: fontsize (slider), minimap (toggle)
- [ ] AI sub-section renders 2 controls: fontsize (slider), fixedfontsize (slider)
- [ ] All controls read from `getSettingsKeyAtom()` and write via `settingsService.setSetting()`
- [ ] Slider controls have correct min/max/step matching the values in `settings-registry.ts`
- [ ] "Transparent Window" row shows a "Restart required" badge
- [ ] Changes take effect immediately (optimistic update via settings service)
- [ ] Component renders properly inside `CollapsibleSection` on the Appearance panel
- [ ] No TypeScript compilation errors (`task check:ts`)
- [ ] Component uses `memo()` wrapper consistent with codebase conventions

---

## Files Created

| File | Purpose |
|------|---------|
| `frontend/app/view/waveconfig/display-settings.tsx` | DisplaySettings component |
| `frontend/app/view/waveconfig/display-settings.scss` | Styles for DisplaySettings |

## Files NOT Modified

These files are consumed but not changed:

| File | Role |
|------|------|
| `frontend/app/element/settings/toggle-control.tsx` | ToggleControl component |
| `frontend/app/element/settings/slider-control.tsx` | SliderControl component |
| `frontend/app/element/settings/color-control.tsx` | ColorControl component |
| `frontend/app/element/settings/font-control.tsx` | FontControl component |
| `frontend/app/store/global.ts` | `getSettingsKeyAtom` |
| `frontend/app/store/settings-service.ts` | `settingsService.setSetting()` |
| `frontend/app/store/settings-registry.ts` | Metadata read (validation values) |
