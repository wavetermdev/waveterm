# Spec 002: CSS Variable Restructuring (theme.scss + tailwindsetup.css)

## Objective

Restructure the CSS variable system to separate **mode** (dark/light) from **accent** (green/warm/blue/purple/teal). Currently, theme.scss conflates structural colors with accent colors across four monolithic theme blocks. After this change:

- `data-theme="dark|light"` controls structural colors (backgrounds, text, borders, terminal colors)
- `data-accent="green|warm|blue|purple|teal"` controls accent colors, secondary text tints, and border warmth/coolness
- Both attributes are set on `document.documentElement`

This task also renames `--tab-green` to `--tab-accent` for semantic correctness.

## Context

**Parent feature**: UI Theme System Redesign (see `.claude/workflow-state.md`)
**Task number**: Task 2 of Phase 1
**Dependencies**: **Spec 001** (backend `app:accent` field) and **Spec 003** (theme hook migration) must be implemented BEFORE this spec. The appearance panel (`appearance-content.tsx/scss`) references `light-gray` and `light-warm` which this spec removes - Spec 007 must update the appearance panel simultaneously.

## Current State Analysis

### theme.scss (`G:\Code\waveterm-experimental\frontend\app\theme.scss`)

432 lines, 4 theme blocks:

| Block | Lines | Purpose |
|-------|-------|---------|
| `:root` | 4-162 | Dark defaults (structural + accent mixed) |
| `[data-theme="light"]` | 165-256 | Light overrides (structural + accent mixed) |
| `[data-theme="light-gray"]` | 259-344 | **TO REMOVE** - gray light variant |
| `[data-theme="light-warm"]` | 347-432 | **TO REMOVE** - warm light variant |

Key accent-coupled variables in `:root` (dark):
- `--accent-color: rgb(88, 193, 66)` (green)
- `--secondary-text-color: rgb(195, 200, 194)` (slight green tint)
- `--border-color: rgba(255, 255, 255, 0.16)` (neutral)
- `--link-color: #58c142` (green)
- `--tab-green: rgb(88, 193, 66)` (green, rename to `--tab-accent`)
- `--toggle-checked-bg-color: var(--accent-color)` (accent-derived)
- `--button-green-bg: var(--term-green)` (line 150, currently references terminal green)
- `--button-green-border-color: #29f200` (line 151)
- `--form-element-primary-color: var(--accent-color)` (accent-derived)

### tailwindsetup.css (`G:\Code\waveterm-experimental\frontend\tailwindsetup.css`)

175 lines. Contains:
- `@theme` block (lines 7-75): dark defaults with green accent palette (`--color-accent-50` through `--color-accent-900`, `--color-accent`, `--color-accenthover`, `--color-accentbg`)
- `[data-theme="light"]` (lines 78-126): light overrides with adjusted green accent palette

These Tailwind color tokens are actively used throughout the codebase:
- `bg-accent-400`, `text-accent-400`, `border-accent-400/*` - in `quicktips.tsx`
- `bg-accent-600`, `bg-accent-500`, `text-accent-500` - in `secretscontent.tsx`, `aipanelheader.tsx`
- `bg-accent`, `bg-accenthover` - in `webview.tsx`
- `bg-accentbg` - in `suggestion.tsx`
- `hover:bg-accent-500`, `focus:border-accent-500` - various interactive elements

### --tab-green Usage

`--tab-green` is **defined** in 4 places (all in theme.scss) but **never consumed** via `var(--tab-green)` anywhere in the codebase. The rename to `--tab-accent` is safe. This variable appears to be a legacy definition that was used for the tab color indicator.

### --button-green-bg Note

In the dark `:root`, `--button-green-bg` is set to `var(--term-green)` (line 150), which references a terminal ANSI color. In light themes, it is set to `var(--accent-color)`. The accent blocks should normalize this to use `var(--accent-color)` consistently, since button colors should follow the accent, not terminal ANSI colors.

## Implementation Plan

### Step 1: Remove `light-gray` and `light-warm` Blocks from theme.scss

Delete lines 258-432 (the `[data-theme="light-gray"]` and `[data-theme="light-warm"]` blocks entirely).

**Rationale**: These monolithic theme variants are being replaced by the accent dimension. The warm colors move to `[data-accent="warm"]` with light-specific overrides in `[data-theme="light"][data-accent="warm"]`.

### Step 2: Clean Up `:root` (Dark) Block

In the `:root` block:

1. **Rename** `--tab-green` to `--tab-accent` (line 44)
2. **Change** `--button-green-bg` from `var(--term-green)` to `var(--accent-color)` (line 150) -- normalizes button color to follow accent rather than terminal ANSI

No other changes to `:root`. The green accent values remain as defaults since `green` is the default accent.

### Step 3: Clean Up `[data-theme="light"]` Block

In the `[data-theme="light"]` block:

1. **Rename** `--tab-green` to `--tab-accent` (line 191)

No other changes. Light structural colors remain intact.

### Step 4: Add Accent Blocks to theme.scss

Add the following blocks after the `[data-theme="light"]` block (after line 256):

#### 4a. `[data-accent="green"]` (Minimal -- Matches :root Defaults)

```scss
// Accent: Green (default)
[data-accent="green"] {
    --accent-color: rgb(88, 193, 66);
    --tab-accent: rgb(88, 193, 66);
    --link-color: #58c142;
}
```

#### 4b. `[data-accent="warm"]` (Warm Brown Tones)

```scss
// Accent: Warm (brown/amber tones)
[data-accent="warm"] {
    --accent-color: rgb(200, 145, 60);
    --secondary-text-color: rgb(200, 195, 185);
    --border-color: rgba(200, 170, 120, 0.18);
    --link-color: #c89140;
    --tab-accent: rgb(200, 145, 60);
    --button-green-bg: var(--accent-color);
    --button-green-border-color: rgb(180, 130, 50);
}
```

#### 4c. `[data-accent="blue"]` (Cool Blue)

```scss
// Accent: Blue (cool blue tones)
[data-accent="blue"] {
    --accent-color: rgb(70, 140, 220);
    --secondary-text-color: rgb(185, 195, 210);
    --border-color: rgba(120, 160, 220, 0.18);
    --link-color: #468cdc;
    --tab-accent: rgb(70, 140, 220);
    --button-green-bg: var(--accent-color);
    --button-green-border-color: rgb(60, 120, 200);
}
```

#### 4d. `[data-accent="purple"]` (Creative Purple)

```scss
// Accent: Purple (creative purple tones)
[data-accent="purple"] {
    --accent-color: rgb(160, 100, 220);
    --secondary-text-color: rgb(200, 190, 210);
    --border-color: rgba(160, 130, 220, 0.18);
    --link-color: #a064dc;
    --tab-accent: rgb(160, 100, 220);
    --button-green-bg: var(--accent-color);
    --button-green-border-color: rgb(140, 85, 200);
}
```

#### 4e. `[data-accent="teal"]` (Calm Teal)

```scss
// Accent: Teal (calm teal tones)
[data-accent="teal"] {
    --accent-color: rgb(50, 190, 180);
    --secondary-text-color: rgb(185, 210, 208);
    --border-color: rgba(80, 190, 180, 0.18);
    --link-color: #32beb4;
    --tab-accent: rgb(50, 190, 180);
    --button-green-bg: var(--accent-color);
    --button-green-border-color: rgb(40, 170, 160);
}
```

### Step 5: Add Compound Light+Accent Blocks to theme.scss

These override accent colors for better contrast on light backgrounds. Add after the accent blocks:

```scss
// Light mode accent overrides (darker accent colors for contrast on light backgrounds)

[data-theme="light"][data-accent="green"] {
    --accent-color: rgb(46, 160, 67);
    --link-color: #2ea043;
    --tab-accent: rgb(46, 160, 67);
}

[data-theme="light"][data-accent="warm"] {
    --accent-color: rgb(140, 100, 40);
    --secondary-text-color: rgb(85, 80, 70);
    --border-color: rgba(90, 70, 40, 0.12);
    --link-color: #8a6428;
    --tab-accent: rgb(140, 100, 40);
    --button-green-border-color: rgb(120, 85, 30);
}

[data-theme="light"][data-accent="blue"] {
    --accent-color: rgb(30, 100, 180);
    --secondary-text-color: rgb(70, 85, 110);
    --border-color: rgba(30, 80, 160, 0.12);
    --link-color: #1e64b4;
    --tab-accent: rgb(30, 100, 180);
    --button-green-border-color: rgb(25, 85, 160);
}

[data-theme="light"][data-accent="purple"] {
    --accent-color: rgb(120, 70, 180);
    --secondary-text-color: rgb(90, 75, 110);
    --border-color: rgba(100, 60, 160, 0.12);
    --link-color: #7846b4;
    --tab-accent: rgb(120, 70, 180);
    --button-green-border-color: rgb(100, 60, 160);
}

[data-theme="light"][data-accent="teal"] {
    --accent-color: rgb(20, 150, 140);
    --secondary-text-color: rgb(50, 95, 90);
    --border-color: rgba(20, 130, 120, 0.12);
    --link-color: #14968c;
    --tab-accent: rgb(20, 150, 140);
    --button-green-border-color: rgb(15, 130, 120);
}
```

### Step 6: Add Accent Blocks to tailwindsetup.css

Add accent overrides **after** the `[data-theme="light"]` block (after line 126), **before** the `:root` zoom factor block (line 128).

The `[data-accent="green"]` block is minimal since green is the default in `@theme`. Only non-green accents need overrides.

#### 6a. `[data-accent="warm"]`

```css
/* Accent: Warm */
[data-accent="warm"] {
    --color-accent-50: rgb(255, 248, 235);
    --color-accent-100: rgb(255, 238, 200);
    --color-accent-200: rgb(250, 215, 150);
    --color-accent-300: rgb(235, 185, 100);
    --color-accent-400: rgb(200, 145, 60);
    --color-accent-500: rgb(170, 120, 45);
    --color-accent-600: rgb(140, 100, 35);
    --color-accent-700: rgb(115, 80, 25);
    --color-accent-800: rgb(90, 65, 20);
    --color-accent-900: rgb(70, 50, 15);
    --color-accent: rgb(200, 145, 60);
    --color-accenthover: rgb(225, 170, 80);
    --color-accentbg: rgba(200, 145, 60, 0.5);
}
```

#### 6b. `[data-accent="blue"]`

```css
/* Accent: Blue */
[data-accent="blue"] {
    --color-accent-50: rgb(235, 245, 255);
    --color-accent-100: rgb(210, 233, 255);
    --color-accent-200: rgb(170, 210, 250);
    --color-accent-300: rgb(120, 180, 240);
    --color-accent-400: rgb(70, 140, 220);
    --color-accent-500: rgb(50, 115, 195);
    --color-accent-600: rgb(35, 95, 170);
    --color-accent-700: rgb(25, 75, 140);
    --color-accent-800: rgb(18, 60, 115);
    --color-accent-900: rgb(12, 45, 90);
    --color-accent: rgb(70, 140, 220);
    --color-accenthover: rgb(100, 165, 240);
    --color-accentbg: rgba(70, 140, 220, 0.5);
}
```

#### 6c. `[data-accent="purple"]`

```css
/* Accent: Purple */
[data-accent="purple"] {
    --color-accent-50: rgb(248, 240, 255);
    --color-accent-100: rgb(238, 220, 255);
    --color-accent-200: rgb(218, 190, 250);
    --color-accent-300: rgb(190, 150, 240);
    --color-accent-400: rgb(160, 100, 220);
    --color-accent-500: rgb(135, 80, 195);
    --color-accent-600: rgb(110, 65, 170);
    --color-accent-700: rgb(90, 50, 140);
    --color-accent-800: rgb(70, 38, 115);
    --color-accent-900: rgb(55, 28, 90);
    --color-accent: rgb(160, 100, 220);
    --color-accenthover: rgb(185, 130, 240);
    --color-accentbg: rgba(160, 100, 220, 0.5);
}
```

#### 6d. `[data-accent="teal"]`

```css
/* Accent: Teal */
[data-accent="teal"] {
    --color-accent-50: rgb(232, 255, 253);
    --color-accent-100: rgb(200, 250, 245);
    --color-accent-200: rgb(150, 240, 230);
    --color-accent-300: rgb(100, 220, 210);
    --color-accent-400: rgb(50, 190, 180);
    --color-accent-500: rgb(35, 160, 150);
    --color-accent-600: rgb(25, 135, 125);
    --color-accent-700: rgb(18, 110, 100);
    --color-accent-800: rgb(12, 85, 78);
    --color-accent-900: rgb(8, 65, 60);
    --color-accent: rgb(50, 190, 180);
    --color-accenthover: rgb(80, 215, 205);
    --color-accentbg: rgba(50, 190, 180, 0.5);
}
```

#### 6e. Light+Accent Compound Overrides

```css
/* Light mode accent palette adjustments (darker for contrast) */

[data-theme="light"][data-accent="green"] {
    --color-accent-400: rgb(46, 160, 67);
    --color-accent-500: rgb(34, 137, 54);
    --color-accent-600: rgb(28, 114, 45);
    --color-accent: rgb(46, 160, 67);
    --color-accenthover: rgb(56, 180, 77);
    --color-accentbg: rgba(46, 160, 67, 0.15);
}

[data-theme="light"][data-accent="warm"] {
    --color-accent-50: rgb(255, 250, 240);
    --color-accent-100: rgb(255, 240, 215);
    --color-accent-200: rgb(245, 220, 175);
    --color-accent-300: rgb(220, 180, 110);
    --color-accent-400: rgb(140, 100, 40);
    --color-accent-500: rgb(120, 85, 30);
    --color-accent-600: rgb(100, 70, 22);
    --color-accent-700: rgb(80, 55, 15);
    --color-accent-800: rgb(60, 42, 10);
    --color-accent-900: rgb(45, 32, 8);
    --color-accent: rgb(140, 100, 40);
    --color-accenthover: rgb(165, 120, 55);
    --color-accentbg: rgba(140, 100, 40, 0.15);
}

[data-theme="light"][data-accent="blue"] {
    --color-accent-50: rgb(240, 248, 255);
    --color-accent-100: rgb(220, 238, 255);
    --color-accent-200: rgb(185, 218, 250);
    --color-accent-300: rgb(130, 180, 235);
    --color-accent-400: rgb(30, 100, 180);
    --color-accent-500: rgb(22, 82, 155);
    --color-accent-600: rgb(15, 68, 130);
    --color-accent-700: rgb(10, 52, 105);
    --color-accent-800: rgb(8, 40, 85);
    --color-accent-900: rgb(5, 30, 65);
    --color-accent: rgb(30, 100, 180);
    --color-accenthover: rgb(45, 120, 200);
    --color-accentbg: rgba(30, 100, 180, 0.15);
}

[data-theme="light"][data-accent="purple"] {
    --color-accent-50: rgb(250, 245, 255);
    --color-accent-100: rgb(242, 232, 255);
    --color-accent-200: rgb(225, 205, 250);
    --color-accent-300: rgb(195, 160, 235);
    --color-accent-400: rgb(120, 70, 180);
    --color-accent-500: rgb(100, 55, 155);
    --color-accent-600: rgb(82, 42, 130);
    --color-accent-700: rgb(65, 32, 108);
    --color-accent-800: rgb(50, 24, 85);
    --color-accent-900: rgb(38, 18, 65);
    --color-accent: rgb(120, 70, 180);
    --color-accenthover: rgb(145, 95, 205);
    --color-accentbg: rgba(120, 70, 180, 0.15);
}

[data-theme="light"][data-accent="teal"] {
    --color-accent-50: rgb(238, 255, 252);
    --color-accent-100: rgb(210, 250, 245);
    --color-accent-200: rgb(165, 235, 225);
    --color-accent-300: rgb(100, 200, 190);
    --color-accent-400: rgb(20, 150, 140);
    --color-accent-500: rgb(15, 125, 115);
    --color-accent-600: rgb(10, 105, 95);
    --color-accent-700: rgb(8, 82, 75);
    --color-accent-800: rgb(5, 65, 58);
    --color-accent-900: rgb(3, 48, 43);
    --color-accent: rgb(20, 150, 140);
    --color-accenthover: rgb(35, 170, 160);
    --color-accentbg: rgba(20, 150, 140, 0.15);
}
```

## Variable Rename: `--tab-green` to `--tab-accent`

### Definition Sites (all in theme.scss)

| Line | Block | Old | New |
|------|-------|-----|-----|
| 44 | `:root` | `--tab-green: rgb(88, 193, 66)` | `--tab-accent: rgb(88, 193, 66)` |
| 191 | `[data-theme="light"]` | `--tab-green: rgb(46, 160, 67)` | `--tab-accent: rgb(46, 160, 67)` |
| 284 | `[data-theme="light-gray"]` | _(deleted with block)_ | N/A |
| 372 | `[data-theme="light-warm"]` | _(deleted with block)_ | N/A |

### Consumption Sites

**None found.** `var(--tab-green)` is not referenced anywhere in the codebase. The variable was defined but never consumed. After the restructuring, new accent blocks will define `--tab-accent` and it can be consumed by tab-related components in the future.

### Files NOT Affected

No `.scss`, `.css`, `.tsx`, or `.ts` files reference `var(--tab-green)`, so no consumers need updating.

## What Does NOT Change

1. **Terminal ANSI colors** (`--term-*`) -- These are controlled by `term:theme` and are NOT accent-dependent. They remain in the `:root` and `[data-theme="light"]` blocks unchanged.
2. **ANSI colors in tailwindsetup.css** (`--ansi-*`) -- Not accent-dependent.
3. **Structural colors** in `:root` and `[data-theme="light"]` -- `--main-bg-color`, `--main-text-color`, `--block-bg-color`, `--panel-bg-color`, `--hover-bg-color`, `--highlight-bg-color`, `--error-color`, `--warning-color`, `--success-color`, scrollbar colors, z-index values, font definitions, modal structural colors -- all stay in their current blocks.
4. **Connection icon colors** (`--conn-icon-color-*`) -- Hard-coded per-connection identity colors.
5. **Sysinfo colors** (`--sysinfo-cpu-color`, `--sysinfo-mem-color`) -- Functional, not accent.
6. **`--bulb-color`** -- Semantic constant.

## Expected Final File Structure

### theme.scss (~320 lines, down from 432)

```
:root { ... }                                    // Dark structural + defaults (lines ~4-162)
[data-theme="light"] { ... }                     // Light structural overrides (lines ~165-256)
[data-accent="green"] { ... }                    // Green accent (minimal)
[data-accent="warm"] { ... }                     // Warm accent
[data-accent="blue"] { ... }                     // Blue accent
[data-accent="purple"] { ... }                   // Purple accent
[data-accent="teal"] { ... }                     // Teal accent
[data-theme="light"][data-accent="green"] { ... }    // Light+green
[data-theme="light"][data-accent="warm"] { ... }     // Light+warm
[data-theme="light"][data-accent="blue"] { ... }     // Light+blue
[data-theme="light"][data-accent="purple"] { ... }   // Light+purple
[data-theme="light"][data-accent="teal"] { ... }     // Light+teal
```

### tailwindsetup.css (~310 lines, up from 175)

```
@theme { ... }                                   // Default (dark+green)
[data-theme="light"] { ... }                     // Light structural overrides
[data-accent="warm"] { ... }                     // Warm palette
[data-accent="blue"] { ... }                     // Blue palette
[data-accent="purple"] { ... }                   // Purple palette
[data-accent="teal"] { ... }                     // Teal palette
[data-theme="light"][data-accent="green"] { ... }    // Light+green palette
[data-theme="light"][data-accent="warm"] { ... }     // Light+warm palette
[data-theme="light"][data-accent="blue"] { ... }     // Light+blue palette
[data-theme="light"][data-accent="purple"] { ... }   // Light+purple palette
[data-theme="light"][data-accent="teal"] { ... }     // Light+teal palette
:root { --zoomfactor: ... }                      // Zoom (unchanged)
/* Chart/Monaco/utility styles... */             // Unchanged
```

## Cascade and Specificity Notes

1. **`:root` vs `[data-accent="X"]`**: Both have specificity `0,1,0`. Since the accent blocks appear AFTER `:root`, they win by source order.
2. **`[data-theme="light"]` vs `[data-accent="X"]`**: Both have specificity `0,1,0`. Accent blocks appear after light, so accent overrides take effect for shared properties like `--accent-color`, `--border-color`, `--secondary-text-color`.
3. **Compound selectors** `[data-theme="light"][data-accent="X"]`: Specificity `0,2,0`. These always win over single-attribute selectors, which is correct -- they provide light-specific accent adjustments.
4. **Important**: The `:root` block sets structural defaults. `[data-theme="light"]` overrides structural colors. `[data-accent="X"]` overrides accent colors. Compound blocks adjust accent for specific modes. This layering works cleanly because the overridden properties are non-overlapping between structural and accent concerns (except `--border-color` and `--secondary-text-color` which intentionally need accent-specific adjustment for visual harmony).

## Related Changes in Other Tasks

- **Task 1** (`spec-001-backend-accent-setting.md`): Adds `app:accent` Go setting and schema
- **Task 3** (`usetheme.ts`): Updates the hook to set both `data-theme` and `data-accent` attributes, handles system mode, migrates `light-warm` to `light`+`warm` accent
- **Appearance settings UI** (Tasks 4-9): Updates `appearance-content.tsx` to show separate Mode and Accent selectors

## Files Modified

| File | Changes |
|------|---------|
| `frontend/app/theme.scss` | Remove light-gray/light-warm blocks, rename --tab-green, normalize --button-green-bg, add 10 accent/compound blocks |
| `frontend/tailwindsetup.css` | Add 9 accent/compound blocks for Tailwind color tokens |

## Acceptance Criteria

- [ ] `[data-theme="light-gray"]` block is completely removed from theme.scss
- [ ] `[data-theme="light-warm"]` block is completely removed from theme.scss
- [ ] `--tab-green` is renamed to `--tab-accent` in `:root` and `[data-theme="light"]` blocks
- [ ] `--button-green-bg` in `:root` changed from `var(--term-green)` to `var(--accent-color)`
- [ ] Five `[data-accent="X"]` blocks added to theme.scss (green, warm, blue, purple, teal)
- [ ] Five `[data-theme="light"][data-accent="X"]` compound blocks added to theme.scss
- [ ] Four `[data-accent="X"]` blocks added to tailwindsetup.css (warm, blue, purple, teal)
- [ ] Six light+accent compound blocks added to tailwindsetup.css (green, warm, blue, purple, teal + green for light mode palette)
- [ ] Terminal ANSI colors (`--term-*`) are NOT modified by any accent block
- [ ] ANSI colors in tailwindsetup.css (`--ansi-*`) are NOT modified by any accent block
- [ ] All accent blocks use `--accent-color` as their primary accent variable
- [ ] All compound blocks override accent colors to be darker/more saturated for light backgrounds
- [ ] CSS specificity is correct: compound selectors (`0,2,0`) override single-attribute selectors (`0,1,0`)
- [ ] File compiles without SCSS errors
- [ ] No references to `var(--tab-green)` exist anywhere in the codebase (already true, just verify)
- [ ] TypeScript type check passes (`task check:ts`)
- [ ] Tailwind utility classes (`bg-accent-400`, `text-accent-500`, etc.) correctly reflect overridden values when `data-accent` is changed at runtime

## CSS Maintenance Invariant

When adding a property to any `[data-accent='X']` block, you MUST also add the corresponding light-mode value to `[data-theme='light'][data-accent='X']` if the property needs different values in light mode. Otherwise the dark-mode accent value will leak into light mode due to CSS source order.

## Known Behavioral Changes (Migration from light-warm/light-gray)

When users migrate from `light-warm` to `light` + `accent:warm`, the following visual changes occur:

**Intentionally NOT preserved:**
- Warm-tinted backgrounds (`--main-bg-color`, `--panel-bg-color`, `--block-bg-color`) revert to standard light theme backgrounds
- Warm-tinted scrollbar colors revert to standard light theme scrollbar colors
- Warm-tinted modal colors revert to standard light theme modal colors
- Warm-tinted form element borders revert to standard light theme form element borders
- Warm-tinted keybinding badge colors revert to standard light theme keybinding colors
- Warm-tinted terminal ANSI colors are NOT preserved (terminal colors are controlled by `term:theme`, not by `app:accent`)

**Preserved via accent blocks:**
- Accent color (`--accent-color`) becomes warm brown
- Border color (`--border-color`) becomes warm-tinted
- Secondary text color (`--secondary-text-color`) becomes warm-tinted
- Link color (`--link-color`) becomes warm brown
- Button green colors become warm brown
- Tab accent color becomes warm brown
- Tailwind accent palette (50-900) becomes warm brown

**Rationale:** This is an intentional simplification. The accent system controls accent/branding colors, not structural backgrounds. Trying to reproduce the full `light-warm` experience would require dozens of additional structural overrides in compound blocks, creating maintenance complexity that outweighs the benefit. Users who want a fundamentally different structural palette should use `term:theme` for terminal colors and browser extensions for structural backgrounds.

When users migrate from `light-gray` to `light` (no accent change), the gray-toned backgrounds revert to standard light theme backgrounds. This is also intentional -- `light-gray` was minimally different from `light` and is not worth maintaining as a separate dimension.

## Design Review

**Reviewer:** Phase 1 Design Review Agent
**Verdict:** APPROVED (after fixes applied)
**Date:** 2026-01-26

Dependency ordering corrected. CSS maintenance invariant documented.
