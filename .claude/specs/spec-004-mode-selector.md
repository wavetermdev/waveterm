# Spec 004: Mode Selector Component

**Date:** 2026-01-26
**Status:** Ready for Implementation
**Dependencies:** Spec 003 (Theme Hook Update) -- requires `ThemeSetting` type export

---

## Objective

Create a segmented control component for selecting the UI theme mode: Dark, Light, or System. This replaces the existing `UIThemeSelector` card grid in `frontend/app/view/waveconfig/appearance-content.tsx:32-66` with a more compact, modern pill-shaped segmented control.

## Context

### Current Implementation

The existing `UIThemeSelector` at `frontend/app/view/waveconfig/appearance-content.tsx:43-66` renders 5 theme cards in a grid (dark, light, light-gray, light-warm, system). With the mode+accent split, mode selection needs only 3 options and a compact segmented control is more appropriate.

### Existing Component Patterns

**Settings controls follow this pattern** (see `frontend/app/element/settings/toggle-control.tsx:1-64`):
- Components are wrapped in `memo()` for performance
- Props interface defined separately and exported with `export type`
- `displayName` set for React DevTools
- `useCallback` for event handlers
- CSS class conventions: `setting-{name}` prefix
- Font Awesome icons: `<i className="fa fa-solid fa-{name}" />`

**SCSS patterns** (see `frontend/app/element/settings/settings-controls.scss`):
- CSS variables from `frontend/app/theme.scss` (e.g., `--accent-color`, `--main-bg-color`, `--border-color`)
- `$setting-border-radius: 4px` for consistent rounding
- `transition: 0.15s ease` for interactions
- `var(--hover-bg-color)` for hover states

---

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/app/element/settings/mode-selector.tsx` | React component |
| `frontend/app/element/settings/mode-selector.scss` | Styles |

---

## Component Design

### `ModeSelector`

**Props:**
```typescript
interface ModeSelectorProps {
    value: string;
    onChange: (value: string) => void;
}
```

**Key imports:**
```typescript
import { cn } from "@/util/util";
import { memo, useCallback } from "react";
import "./mode-selector.scss";
```

### Component Structure

```tsx
const MODE_OPTIONS = [
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "system", label: "System", icon: "desktop" },
] as const;

const ModeSelector = memo(({ value, onChange }: ModeSelectorProps) => {
    const handleSelect = useCallback(
        (mode: string) => {
            onChange(mode);
        },
        [onChange]
    );

    return (
        <div className="mode-selector" role="radiogroup" aria-label="Theme mode">
            {MODE_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={cn("mode-selector-button", {
                        selected: value === option.value,
                    })}
                    onClick={() => handleSelect(option.value)}
                    role="radio"
                    aria-checked={value === option.value}
                >
                    <i className={`fa fa-solid fa-${option.icon}`} />
                    <span className="mode-selector-label">{option.label}</span>
                </button>
            ))}
        </div>
    );
});

ModeSelector.displayName = "ModeSelector";
```

### Exports

```typescript
export { ModeSelector };
export type { ModeSelectorProps };
```

---

## SCSS Structure

**File:** `frontend/app/element/settings/mode-selector.scss`

```scss
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

.mode-selector {
    display: inline-flex;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--form-element-bg-color);
    overflow: hidden;
    padding: 2px;
    gap: 2px;
}

.mode-selector-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--secondary-text-color);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    white-space: nowrap;

    &:hover:not(.selected) {
        background: var(--hover-bg-color);
        color: var(--main-text-color);
    }

    &.selected {
        background: var(--accent-color);
        color: white;
    }

    &:focus-visible {
        outline: 2px solid var(--accent-color);
        outline-offset: -2px;
    }

    i {
        font-size: 12px;
    }
}

.mode-selector-label {
    line-height: 1;
}
```

### Design Details

| Property | Value | Rationale |
|----------|-------|-----------|
| Container shape | Pill (8px border-radius) | Modern segmented control look |
| Container padding | 2px | Small inner gap for pill buttons |
| Button padding | 6px 16px | Comfortable click target |
| Selected background | `--accent-color` | Consistent with toggle checked state (`settings-controls.scss:158`) |
| Selected text | white | High contrast against accent colors |
| Unselected text | `--secondary-text-color` | Subtle but readable |
| Hover background | `--hover-bg-color` | Consistent with project hover states |
| Font size | 13px | Matches `.setting-label` (13px, `settings-controls.scss:60`) |
| Icon size | 12px | Slightly smaller than label for balance |
| Transition | 0.15s ease | Matches project transition standard |

### Icon Mapping

| Mode | Font Awesome Icon | Class |
|------|-------------------|-------|
| Dark | moon | `fa fa-solid fa-moon` |
| Light | sun | `fa fa-solid fa-sun` |
| System | desktop | `fa fa-solid fa-desktop` |

---

## Integration with Index

Add to `frontend/app/element/settings/index.ts`:

```typescript
export { ModeSelector } from "./mode-selector";
export type { ModeSelectorProps } from "./mode-selector";
```

---

## Integration with Appearance Content

The `AppearanceContent` component at `frontend/app/view/waveconfig/appearance-content.tsx` will replace its `UIThemeSelector` usage with the new `ModeSelector` + `AccentSelector` (Spec 005). The specific integration changes are:

1. Import `ModeSelector` instead of using the inline `UIThemeSelector`
2. The `THEME_OPTIONS` constant (line 32-38) and `UIThemeSelector` component (line 43-66) can be removed
3. The CollapsibleSection for "UI Theme" (lines 121-128) will contain both `ModeSelector` and `AccentSelector`

**Note:** The actual `AppearanceContent` changes are a separate integration task. This spec covers only the component itself.

---

## Accessibility

- Container uses `role="radiogroup"` with `aria-label="Theme mode"`
- Each button uses `role="radio"` with `aria-checked` reflecting selection state
- Keyboard navigation: buttons are focusable via tab order
- `focus-visible` outline for keyboard users
- Color contrast: white text on accent background meets WCAG AA (accent colors are all mid-saturation)

---

## Acceptance Criteria

- [ ] File `frontend/app/element/settings/mode-selector.tsx` exists
- [ ] File `frontend/app/element/settings/mode-selector.scss` exists
- [ ] Component renders 3 buttons: Dark (moon icon), Light (sun icon), System (desktop icon)
- [ ] Selected button has accent-colored background with white text
- [ ] Unselected buttons have subtle hover background effect
- [ ] `onChange` is called with the correct value string when a button is clicked
- [ ] Component is wrapped in `memo()` with `displayName` set
- [ ] Props interface is exported as `ModeSelectorProps`
- [ ] SCSS uses only existing CSS variables (no hardcoded colors except white for selected text)
- [ ] Segmented control has pill shape (rounded container with inner rounded buttons)
- [ ] Component is accessible (role="radiogroup", role="radio", aria-checked)
- [ ] Component is exported from `frontend/app/element/settings/index.ts`
- [ ] TypeScript compiles without errors
