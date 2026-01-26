# Spec 005: Accent Selector Component

**Date:** 2026-01-26
**Status:** Ready for Implementation
**Dependencies:** Spec 003 (Theme Hook Update) -- requires `AccentSetting` type export

---

## Objective

Create a visual grid of accent theme cards that allow users to select the accent color for the UI. Each card displays a color swatch circle and label text, with a check icon overlay on the selected card. This is the second dimension of the theme system alongside the Mode Selector (Spec 004).

## Context

### Design Inspiration

The design follows the existing `TermThemeControl` card pattern at `frontend/app/element/settings/termtheme-control.tsx:212-231` -- clickable cards with visual previews, selected state with border highlight and checkmark. The accent selector uses a simpler layout (color swatch circle + label) since accent colors are simpler than full terminal themes.

### Existing Patterns

**Card grid pattern** (`frontend/app/element/settings/settings-controls.scss:734-811`):
```scss
.termtheme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
}
.termtheme-card {
    border: 2px solid var(--form-element-border-color);
    border-radius: 8px;
    &.selected {
        border-color: var(--form-element-primary-color);
        box-shadow: 0 0 0 2px rgba(...);
    }
}
```

**Component conventions** (see `frontend/app/element/settings/toggle-control.tsx`):
- `memo()` wrapper
- `displayName` set
- Props interface exported with `export type`
- `useCallback` for handlers

---

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/app/element/settings/accent-selector.tsx` | React component |
| `frontend/app/element/settings/accent-selector.scss` | Styles |

---

## Accent Color Definitions

These are the canonical accent colors used for the swatch previews. The actual CSS variable values will be defined in theme CSS (Spec for CSS variables, separate task), but the component needs these for rendering the preview circles.

| Accent | Dark Mode Color | Label |
|--------|-----------------|-------|
| Green | `rgb(88, 193, 66)` | Green |
| Warm | `rgb(200, 145, 60)` | Warm |
| Blue | `rgb(70, 140, 220)` | Blue |
| Purple | `rgb(160, 100, 220)` | Purple |
| Teal | `rgb(50, 190, 180)` | Teal |

**Note:** These colors are for the swatch preview only. The actual accent CSS variables (`--accent-color`) are set by the CSS `[data-accent="..."]` selectors defined in the theme stylesheet. The swatch provides an approximate preview regardless of the currently active theme.

---

## Component Design

### `AccentSelector`

**Props:**
```typescript
interface AccentSelectorProps {
    value: string;
    onChange: (value: string) => void;
}
```

**Key imports:**
```typescript
import { cn } from "@/util/util";
import { memo, useCallback } from "react";
import "./accent-selector.scss";
```

### Data Structure

```typescript
interface AccentOption {
    value: string;
    label: string;
    color: string; // Preview swatch color
}

const ACCENT_OPTIONS: AccentOption[] = [
    { value: "green", label: "Green", color: "rgb(88, 193, 66)" },
    { value: "warm", label: "Warm", color: "rgb(200, 145, 60)" },
    { value: "blue", label: "Blue", color: "rgb(70, 140, 220)" },
    { value: "purple", label: "Purple", color: "rgb(160, 100, 220)" },
    { value: "teal", label: "Teal", color: "rgb(50, 190, 180)" },
];
```

### Component Structure

```tsx
const AccentSelector = memo(({ value, onChange }: AccentSelectorProps) => {
    const handleSelect = useCallback(
        (accent: string) => {
            onChange(accent);
        },
        [onChange]
    );

    return (
        <div className="accent-selector" role="radiogroup" aria-label="Accent color">
            {ACCENT_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={cn("accent-card", { selected: value === option.value })}
                    onClick={() => handleSelect(option.value)}
                    role="radio"
                    aria-checked={value === option.value}
                    aria-label={`${option.label} accent color`}
                >
                    <div
                        className="accent-swatch"
                        style={{ backgroundColor: option.color }}
                    />
                    <span className="accent-label">{option.label}</span>
                    {value === option.value && (
                        <span className="accent-check">
                            <i className="fa fa-solid fa-check" />
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
});

AccentSelector.displayName = "AccentSelector";
```

### Exports

```typescript
export { AccentSelector };
export type { AccentSelectorProps };
```

---

## SCSS Structure

**File:** `frontend/app/element/settings/accent-selector.scss`

```scss
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

.accent-selector {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 12px;
}

.accent-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 12px;
    border: 2px solid var(--border-color);
    border-radius: 8px;
    background: var(--form-element-bg-color);
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    position: relative;

    &:hover {
        border-color: var(--form-element-primary-color);
    }

    &.selected {
        border-color: var(--accent-color);
        box-shadow: 0 0 8px 0 rgba(var(--accent-color-rgb, 88, 193, 66), 0.3);
    }

    &:focus-visible {
        outline: 2px solid var(--accent-color);
        outline-offset: 2px;
    }
}

.accent-swatch {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    margin-bottom: 10px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    transition: transform 0.15s ease;

    .accent-card:hover & {
        transform: scale(1.1);
    }

    // Light theme adjustments
    [data-theme="light"] & {
        border-color: rgba(0, 0, 0, 0.1);
    }
}

.accent-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--main-text-color);
    text-align: center;
}

.accent-check {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-color);
    border-radius: 50%;
    color: white;

    i {
        font-size: 10px;
    }
}
```

### Design Details

| Property | Value | Rationale |
|----------|-------|-----------|
| Grid layout | `repeat(auto-fill, minmax(100px, 1fr))` | Responsive grid, ~5 cards per row on wide panels |
| Card border | `2px solid var(--border-color)` | Matches `termtheme-card` pattern (`settings-controls.scss:746`) |
| Card border-radius | `8px` | Matches `termtheme-card` pattern |
| Card background | `var(--form-element-bg-color)` | Matches `termtheme-card` pattern |
| Swatch size | 40x40px circle | Prominent color preview |
| Swatch border | `2px solid rgba(255,255,255,0.1)` | Subtle definition in dark mode |
| Selected glow | `box-shadow: 0 0 8px 0 rgba(accent, 0.3)` | Subtle glow effect to indicate selection |
| Check icon | Absolute positioned, top-right | Matches `termtheme-check` pattern (`settings-controls.scss:795-810`) |
| Hover swatch scale | `scale(1.1)` | Subtle interaction feedback |
| Transition | 0.15s ease | Project standard |

### Selected State

The selected card uses:
1. `border-color: var(--accent-color)` -- border highlights with the current accent
2. `box-shadow` -- subtle glow using the accent color at 30% opacity
3. Check icon overlay -- circular accent-colored badge with white checkmark (top-right corner)

This matches the established `termtheme-card.selected` pattern from `settings-controls.scss:756-759`.

---

## Integration with Index

Add to `frontend/app/element/settings/index.ts`:

```typescript
export { AccentSelector } from "./accent-selector";
export type { AccentSelectorProps } from "./accent-selector";
```

---

## Integration with Appearance Content

The `AppearanceContent` component at `frontend/app/view/waveconfig/appearance-content.tsx` will use this component alongside `ModeSelector` in the "UI Theme" CollapsibleSection. The integration involves:

1. Import `AccentSelector` from `@/app/element/settings`
2. Read `app:accent` setting via `getSettingsKeyAtom("app:accent")`
3. Add a handler: `handleAccentChange = (value) => settingsService.setSetting("app:accent", value)`
4. Render `AccentSelector` below `ModeSelector` with a small label or divider

**Example layout within the UI Theme section:**
```tsx
<CollapsibleSection title="UI Theme" icon="palette" ...>
    <div className="theme-section-group">
        <div className="theme-section-label">Mode</div>
        <ModeSelector value={appTheme} onChange={handleThemeChange} />
    </div>
    <div className="theme-section-group">
        <div className="theme-section-label">Accent</div>
        <AccentSelector value={appAccent} onChange={handleAccentChange} />
    </div>
</CollapsibleSection>
```

**Note:** The actual AppearanceContent integration is a separate task. This spec covers the AccentSelector component itself.

---

## Accessibility

- Container uses `role="radiogroup"` with `aria-label="Accent color"`
- Each card uses `role="radio"` with `aria-checked` reflecting selection state
- Each card has `aria-label` with full text (e.g., "Green accent color")
- Keyboard: buttons are focusable, Enter/Space activates
- `focus-visible` outline for keyboard navigation
- Swatch colors are supplemented by text labels (not color-only identification)

---

## Acceptance Criteria

- [ ] File `frontend/app/element/settings/accent-selector.tsx` exists
- [ ] File `frontend/app/element/settings/accent-selector.scss` exists
- [ ] Component renders 5 accent cards: Green, Warm, Blue, Purple, Teal
- [ ] Each card shows a circular color swatch with the preview color
- [ ] Each card shows a text label below the swatch
- [ ] Selected card has accent-colored border and subtle glow
- [ ] Selected card shows a check icon overlay (top-right corner)
- [ ] `onChange` is called with the correct accent value when a card is clicked
- [ ] Cards are laid out in a responsive grid (`auto-fill, minmax(100px, 1fr)`)
- [ ] Component is wrapped in `memo()` with `displayName` set
- [ ] Props interface is exported as `AccentSelectorProps`
- [ ] SCSS uses CSS variables from theme.scss (no hardcoded structural colors)
- [ ] Swatch colors are defined as inline styles (these are preview-only values)
- [ ] Swatch has subtle scale animation on hover
- [ ] Component is accessible (role="radiogroup", role="radio", aria-checked, aria-label)
- [ ] Component is exported from `frontend/app/element/settings/index.ts`
- [ ] TypeScript compiles without errors
