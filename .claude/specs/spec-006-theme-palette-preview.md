# Spec 006: Theme Palette Preview Component

**Date:** 2026-01-26
**Status:** Ready for Implementation
**Dependencies:** Spec 003 (Theme Hook Update) -- requires `data-theme` and `data-accent` attributes to be set on `document.documentElement`

---

## Objective

Create a live color palette preview component that reads computed CSS variable values from the DOM and displays them as a row of labeled color swatches. The preview auto-updates when the theme mode or accent color changes, giving users immediate visual feedback about the active color palette.

## Context

### Why This Component Exists

When a user changes the mode (dark/light) or accent (green/warm/blue/purple/teal), the CSS variables change immediately. This component reads those computed values and displays them, providing a visual summary of the active palette. It serves as confirmation that the theme change took effect and helps users compare palettes.

### Existing Pattern: Color Swatches

The project already has color swatch rendering in `frontend/app/element/settings/termtheme-control.tsx:94-100`:
```tsx
const ColorSwatch = memo(({ color, title }: { color: string; title?: string }) => (
    <div className="termtheme-swatch" style={{ backgroundColor: color }} title={title} />
));
```

This component follows a similar pattern but reads live computed CSS values instead of static config values.

### CSS Variables to Display

From `frontend/app/theme.scss`, these are the key palette variables:

| Display Label | CSS Variable | Dark Default | Light Default |
|--------------|--------------|-------------|---------------|
| Background | `--main-bg-color` | `rgb(34, 34, 34)` | `rgb(250, 250, 250)` |
| Text | `--main-text-color` | `#f7f7f7` | `#1a1a1a` |
| Accent | `--accent-color` | `rgb(88, 193, 66)` | `rgb(46, 160, 67)` |
| Border | `--border-color` | `rgba(255, 255, 255, 0.16)` | `rgba(0, 0, 0, 0.12)` |
| Link | `--link-color` | `#58c142` | `#2ea043` |
| Error | `--error-color` | `rgb(229, 77, 46)` | `rgb(207, 34, 46)` |
| Warning | `--warning-color` | `rgb(224, 185, 86)` | `rgb(191, 135, 0)` |
| Success | `--success-color` | `rgb(78, 154, 6)` | `rgb(46, 160, 67)` |

---

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/app/element/settings/theme-palette-preview.tsx` | React component |
| `frontend/app/element/settings/theme-palette-preview.scss` | Styles |

---

## Component Design

### `ThemePalettePreview`

**Props:** None (reads from DOM)

**Key imports:**
```typescript
import { memo, useCallback, useEffect, useState } from "react";
import "./theme-palette-preview.scss";
```

### Data Structure

```typescript
interface PaletteColor {
    label: string;
    variable: string;
    computedValue: string;
}

const PALETTE_VARIABLES = [
    { label: "Background", variable: "--main-bg-color" },
    { label: "Text", variable: "--main-text-color" },
    { label: "Accent", variable: "--accent-color" },
    { label: "Border", variable: "--border-color" },
    { label: "Link", variable: "--link-color" },
    { label: "Error", variable: "--error-color" },
    { label: "Warning", variable: "--warning-color" },
    { label: "Success", variable: "--success-color" },
] as const;
```

### Color Reading Logic

```typescript
/**
 * Reads the computed value of a CSS variable from documentElement.
 */
function getComputedCSSVar(varName: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * Reads all palette colors from the current computed styles.
 */
function readPaletteColors(): PaletteColor[] {
    return PALETTE_VARIABLES.map((entry) => ({
        label: entry.label,
        variable: entry.variable,
        computedValue: getComputedCSSVar(entry.variable),
    }));
}
```

### MutationObserver for Live Updates

The component uses a `MutationObserver` on `document.documentElement` to detect when `data-theme` or `data-accent` attributes change. This ensures the preview updates immediately when the theme changes, without requiring prop drilling or atom subscriptions.

```typescript
const ThemePalettePreview = memo(() => {
    const [colors, setColors] = useState<PaletteColor[]>(() => readPaletteColors());

    const refreshColors = useCallback(() => {
        // Use requestAnimationFrame to ensure styles have been applied
        requestAnimationFrame(() => {
            setColors(readPaletteColors());
        });
    }, []);

    useEffect(() => {
        // Initial read
        refreshColors();

        // Watch for attribute changes on documentElement (data-theme, data-accent)
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (
                    mutation.type === "attributes" &&
                    (mutation.attributeName === "data-theme" ||
                        mutation.attributeName === "data-accent")
                ) {
                    refreshColors();
                    break;
                }
            }
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme", "data-accent"],
        });

        return () => {
            observer.disconnect();
        };
    }, [refreshColors]);

    return (
        <div className="palette-preview">
            <div className="palette-swatches">
                {colors.map((color) => (
                    <div key={color.variable} className="palette-swatch-item">
                        <div
                            className="palette-swatch"
                            style={{ backgroundColor: color.computedValue }}
                            title={`${color.variable}: ${color.computedValue}`}
                        />
                        <span className="palette-swatch-label">{color.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});

ThemePalettePreview.displayName = "ThemePalettePreview";
```

### Exports

```typescript
export { ThemePalettePreview };
```

---

## SCSS Structure

**File:** `frontend/app/element/settings/theme-palette-preview.scss`

```scss
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

.palette-preview {
    padding: 12px 0;
}

.palette-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.palette-swatch-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}

.palette-swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--border-color);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    cursor: default;

    &:hover {
        transform: scale(1.15);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
}

.palette-swatch-label {
    font-size: 10px;
    color: var(--secondary-text-color);
    text-align: center;
    max-width: 48px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

### Design Details

| Property | Value | Rationale |
|----------|-------|-----------|
| Swatch size | 32x32px circle | Specified in requirements |
| Swatch border | `2px solid var(--border-color)` | Provides definition, especially for colors close to background |
| Layout | `flex-wrap` row | Horizontal flow that wraps on narrow panels |
| Gap | 12px | Comfortable spacing between swatches |
| Label font | 10px | Small, secondary information |
| Label color | `--secondary-text-color` | Unobtrusive |
| Hover effect | `scale(1.15)` + shadow | Interactive feedback, hover shows tooltip |
| Tooltip | Native `title` attribute | Shows variable name and computed value |
| Transition | 0.15s ease | Project standard |

### Tooltip Behavior

The component uses the native HTML `title` attribute on each swatch, which displays:
```
--main-bg-color: rgb(34, 34, 34)
```

This is simple and requires no additional tooltip library. The title shows both the CSS variable name and its current computed value.

---

## Integration with Index

Add to `frontend/app/element/settings/index.ts`:

```typescript
export { ThemePalettePreview } from "./theme-palette-preview";
```

---

## Integration with Appearance Content

The `ThemePalettePreview` will be placed in the "UI Theme" CollapsibleSection of `frontend/app/view/waveconfig/appearance-content.tsx`, below the ModeSelector and AccentSelector:

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
    <div className="section-divider" />
    <div className="theme-section-group">
        <div className="theme-section-label">Current Palette</div>
        <ThemePalettePreview />
    </div>
</CollapsibleSection>
```

**Note:** The actual AppearanceContent integration is a separate task. This spec covers the ThemePalettePreview component itself.

---

## Technical Considerations

### Why MutationObserver Instead of Atoms

The component could subscribe to `resolvedAppThemeAtom` and `resolvedAccentAtom` and re-read CSS variables when they change. However, the MutationObserver approach is better because:

1. **Decoupled from state management** -- does not need to import Jotai atoms or global store
2. **Catches all theme changes** -- including programmatic changes or CSS hot-reload during development
3. **Guaranteed timing** -- the observer fires after the DOM attribute change, ensuring `getComputedStyle` returns updated values
4. **Single source of truth** -- the DOM attributes are the actual source of theme state for CSS

### `requestAnimationFrame` Usage

After detecting an attribute change, the component uses `requestAnimationFrame` before reading `getComputedStyle`. This ensures the browser has had a chance to recalculate styles after the attribute change. Without this, the computed values might be stale.

### Performance

- The observer only watches 2 specific attributes (`data-theme`, `data-accent`) via `attributeFilter`
- Color reads are inexpensive (8 `getComputedStyle` calls)
- The component is memoized with `memo()`
- State updates are batched via `requestAnimationFrame`
- No polling or intervals

---

## Accessibility

- Swatches are non-interactive (decorative, informational only)
- Color information is supplemented by text labels (accessible to screen readers)
- Native `title` tooltip provides variable name for power users
- Swatches have `cursor: default` to indicate non-interactive nature
- Color information is not the sole means of conveying information (each swatch has a label)

---

## Acceptance Criteria

- [ ] File `frontend/app/element/settings/theme-palette-preview.tsx` exists
- [ ] File `frontend/app/element/settings/theme-palette-preview.scss` exists
- [ ] Component renders 8 color swatches: Background, Text, Accent, Border, Link, Error, Warning, Success
- [ ] Each swatch is a 32x32px circle filled with the computed CSS variable value
- [ ] Each swatch has a text label below it
- [ ] Hovering a swatch shows a tooltip with the CSS variable name and computed value
- [ ] Component has no props (reads from DOM)
- [ ] Colors update automatically when `data-theme` attribute changes on `documentElement`
- [ ] Colors update automatically when `data-accent` attribute changes on `documentElement`
- [ ] MutationObserver is properly disconnected on unmount (no memory leaks)
- [ ] `requestAnimationFrame` is used to ensure styles are recalculated before reading
- [ ] Component is wrapped in `memo()` with `displayName` set
- [ ] SCSS uses CSS variables for structural styling (borders, text colors)
- [ ] Swatch inline styles use computed CSS values (not hardcoded colors)
- [ ] Component is exported from `frontend/app/element/settings/index.ts`
- [ ] TypeScript compiles without errors
- [ ] Swatches have subtle hover scale animation
