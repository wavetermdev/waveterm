# Spec 003: Theme Hook Update (usetheme.ts)

**Date:** 2026-01-26
**Status:** Ready for Implementation
**File:** `frontend/app/hook/usetheme.ts`
**Dependencies:** None (foundational task -- Tasks 4-6 depend on this)

---

## Objective

Refactor `frontend/app/hook/usetheme.ts` to support the new two-dimensional theme system: **Mode** (dark/light/system) and **Accent** (green/warm/blue/purple/teal). Remove the legacy `light-gray` and `light-warm` theme variants in favor of the mode+accent split. Add one-time migration logic for users on the old theme values.

## Context

The current `usetheme.ts` (`frontend/app/hook/usetheme.ts:1-128`) treats themes as a single axis with five values: `dark`, `light`, `light-gray`, `light-warm`, `system`. The redesign splits this into two independent settings:

| Setting | Key | Values | Default |
|---------|-----|--------|---------|
| Mode | `app:theme` | `"dark"`, `"light"`, `"system"` | `"dark"` |
| Accent | `app:accent` | `"green"`, `"warm"`, `"blue"`, `"purple"`, `"teal"` | `"green"` |

These map to two CSS data attributes on `document.documentElement`:
- `data-theme="dark"` or `data-theme="light"`
- `data-accent="green"`, `data-accent="warm"`, etc.

### Existing Consumers (must remain compatible)

| File | Usage |
|------|-------|
| `frontend/app/app.tsx:129` | `useTheme()` hook call |
| `frontend/app/view/term/term-model.ts:187` | `resolvedAppThemeAtom` |
| `frontend/app/view/term/termtheme.ts:22` | `resolvedAppThemeAtom` |
| `frontend/app/view/term/term.tsx:148` | `resolvedAppThemeAtom` |
| `frontend/app/monaco/monaco-env.ts:73` | `getResolvedTheme()` |

---

## Implementation Steps

### Step 1: Simplify Type Definitions

Replace the current types at lines 9-13:

```typescript
// Old
type ThemeSetting = "dark" | "light" | "light-gray" | "light-warm" | "system";
type ResolvedTheme = "dark" | "light";
type NativeThemeSource = "dark" | "light" | "system";

// New
type ThemeSetting = "dark" | "light" | "system";
type AccentSetting = "green" | "warm" | "blue" | "purple" | "teal";
type ResolvedTheme = "dark" | "light";
type NativeThemeSource = "dark" | "light" | "system";
```

Export `ThemeSetting` and `AccentSetting` types so the ModeSelector and AccentSelector components can import them.

### Step 2: Simplify `isLightTheme`

Replace the current function at line 18-20:

```typescript
// Old
function isLightTheme(theme: string): boolean {
    return theme === "light" || theme === "light-gray" || theme === "light-warm";
}

// New
function isLightTheme(theme: string): boolean {
    return theme === "light";
}
```

### Step 3: Add Migration Logic

Add a migration function that runs once on hook initialization. This handles users upgrading from the old theme system:

```typescript
import { settingsService } from "@/app/store/settings-service";

/**
 * One-time migration from old theme variants to new mode+accent system.
 * - "light-gray" -> app:theme = "light" (accent unchanged)
 * - "light-warm" -> app:theme = "light", app:accent = "warm"
 * Other values pass through unchanged.
 */
function migrateThemeSetting(currentTheme: string): void {
    if (currentTheme === "light-gray") {
        settingsService.setSetting("app:theme", "light");
    } else if (currentTheme === "light-warm") {
        settingsService.setSetting("app:theme", "light");
        settingsService.setSetting("app:accent", "warm");
    }
}
```

**Key decisions:**
- `light-gray` migrates to `light` with no accent change (keeps the default "green" accent). The old light-gray was just a tone shift, not an accent theme.
- `light-warm` migrates to `light` + accent `warm`. The warm theme was fundamentally about accent color (amber/sepia tones).
- Migration runs via `settingsService.setSetting()` which triggers the debounced save to `settings.json`.
- The migration function is called inside `useTheme()` within a `useEffect` that checks the raw theme value on mount.

### Step 4: Add `resolvedAccentAtom`

Create a new exported atom that reads `app:accent`:

```typescript
import { getSettingsKeyAtom, globalStore } from "@/store/global";

/**
 * Atom that resolves the current accent setting.
 * Defaults to "green" if not set.
 */
export const resolvedAccentAtom = atom<AccentSetting>((get) => {
    const setting = get(getSettingsKeyAtom("app:accent"));
    const validAccents: AccentSetting[] = ["green", "warm", "blue", "purple", "teal"];
    if (setting && validAccents.includes(setting as AccentSetting)) {
        return setting as AccentSetting;
    }
    return "green";
});
```

### Step 5: Update `resolveCssTheme`

Simplify since we no longer have `light-gray` / `light-warm` variants:

```typescript
function resolveCssTheme(themeSetting: ThemeSetting, systemPrefersDark: boolean): string {
    if (themeSetting === "system") {
        return systemPrefersDark ? "dark" : "light";
    }
    return themeSetting; // "dark" or "light" only now
}
```

This is functionally identical since the old code already passed through `themeSetting` directly, but the narrower type makes it clearer.

### Step 6: Update `getNativeThemeSource`

Simplify:

```typescript
function getNativeThemeSource(themeSetting: ThemeSetting): NativeThemeSource {
    if (themeSetting === "system") {
        return "system";
    }
    return themeSetting === "light" ? "light" : "dark";
}
```

### Step 7: Update `applyTheme` to Apply Both Attributes

Rename to `applyThemeAndAccent` or keep `applyTheme` with an added accent parameter:

```typescript
/**
 * Applies theme mode and accent to the document root element.
 * Sets data-theme and data-accent attributes.
 */
function applyThemeAndAccent(theme: string, accent: string): void {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-accent", accent);
}
```

### Step 8: Update `useTheme` Hook

The hook now reads both settings and applies both attributes. It also triggers migration on mount:

```typescript
export function useTheme(): void {
    const themeSettingAtom = getSettingsKeyAtom("app:theme");
    const accentSettingAtom = getSettingsKeyAtom("app:accent");
    const themeSetting = (useAtomValue(themeSettingAtom) ?? "dark") as string;
    const accentSetting = (useAtomValue(accentSettingAtom) ?? "green") as AccentSetting;

    // One-time migration from old theme variants
    useEffect(() => {
        migrateThemeSetting(themeSetting);
    }, []); // Only run on mount

    // Normalize theme setting (in case migration hasn't flushed yet)
    const normalizedTheme: ThemeSetting =
        themeSetting === "light-gray" || themeSetting === "light-warm"
            ? "light"
            : (themeSetting as ThemeSetting) ?? "dark";

    useEffect(() => {
        const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const updateTheme = () => {
            const systemPrefersDark = darkModeQuery.matches;
            const cssTheme = resolveCssTheme(normalizedTheme, systemPrefersDark);
            applyThemeAndAccent(cssTheme, accentSetting);
        };

        updateTheme();

        const nativeTheme = getNativeThemeSource(normalizedTheme);
        getApi()?.setNativeThemeSource(nativeTheme);

        const handleSystemPreferenceChange = () => {
            if (normalizedTheme === "system") {
                updateTheme();
            }
        };

        darkModeQuery.addEventListener("change", handleSystemPreferenceChange);
        return () => {
            darkModeQuery.removeEventListener("change", handleSystemPreferenceChange);
        };
    }, [normalizedTheme, accentSetting]);
}
```

### Step 9: Update `resolvedAppThemeAtom`

Simplify (no more light variants):

```typescript
export const resolvedAppThemeAtom = atom<ResolvedTheme>((get) => {
    const setting = (get(getSettingsKeyAtom("app:theme")) || "dark") as string;
    if (setting === "system") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    // Handle legacy values during migration window
    if (setting === "light" || setting === "light-gray" || setting === "light-warm") {
        return "light";
    }
    return "dark";
});
```

**Note:** We keep `light-gray`/`light-warm` handling in the atom for the brief period between app load and migration flush. After migration, these values will no longer appear in settings.

### Step 10: Update `getResolvedTheme`

Same simplification:

```typescript
export function getResolvedTheme(): ResolvedTheme {
    const themeSettingAtom = getSettingsKeyAtom("app:theme");
    const themeSetting = (globalStore.get(themeSettingAtom) ?? "dark") as string;

    if (themeSetting === "system") {
        const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        return darkModeQuery.matches ? "dark" : "light";
    }

    return isLightTheme(themeSetting) || themeSetting === "light-gray" || themeSetting === "light-warm"
        ? "light"
        : "dark";
}
```

### Step 11: Add `getResolvedAccent` Helper

For non-React contexts (similar to `getResolvedTheme`):

```typescript
/**
 * Gets the current resolved accent directly from the store.
 * Useful for non-React contexts or one-time reads.
 */
export function getResolvedAccent(): AccentSetting {
    const accentSettingAtom = getSettingsKeyAtom("app:accent");
    const setting = globalStore.get(accentSettingAtom);
    const validAccents: AccentSetting[] = ["green", "warm", "blue", "purple", "teal"];
    if (setting && validAccents.includes(setting as AccentSetting)) {
        return setting as AccentSetting;
    }
    return "green";
}
```

---

## Complete File Structure

After modification, `frontend/app/hook/usetheme.ts` will export:

| Export | Type | Description |
|--------|------|-------------|
| `ThemeSetting` | type | `"dark" \| "light" \| "system"` |
| `AccentSetting` | type | `"green" \| "warm" \| "blue" \| "purple" \| "teal"` |
| `ResolvedTheme` | type | `"dark" \| "light"` |
| `resolvedAppThemeAtom` | `Atom<ResolvedTheme>` | Resolves current mode to dark/light |
| `resolvedAccentAtom` | `Atom<AccentSetting>` | Resolves current accent setting |
| `useTheme` | function (hook) | Applies both `data-theme` and `data-accent` |
| `getResolvedTheme` | function | Non-React resolved theme reader |
| `getResolvedAccent` | function | Non-React resolved accent reader |

---

## Key Imports

```typescript
import { getApi, getSettingsKeyAtom, globalStore } from "@/store/global";
import { settingsService } from "@/app/store/settings-service";
import { atom, useAtomValue } from "jotai";
import { useEffect } from "react";
```

---

## Settings Registry Update

The `app:theme` entry in `frontend/app/store/settings-registry.ts:823-839` must be updated to remove `light-gray`/`light-warm` options. Additionally, a new `app:accent` entry must be added.

**Update `app:theme` (line 823):**
```typescript
{
    key: "app:theme",
    label: "UI Theme",
    description: "The UI color mode for the application.",
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
    tags: ["theme", "appearance", "dark", "light", "mode"],
},
```

**Add `app:accent` (after `app:theme`):**
```typescript
{
    key: "app:accent",
    label: "Accent Color",
    description: "The accent color theme used for highlights, buttons, and interactive elements.",
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
    tags: ["accent", "color", "appearance", "theme"],
},
```

---

## Backend Types Update

The Go types in `pkg/wconfig/settingsconfig.go` and `frontend/types/gotypes.d.ts` must add the `app:accent` field to `SettingsType`. Run `task generate` after modifying Go types.

**In `pkg/wconfig/settingsconfig.go` (SettingsType struct):**
```go
AppAccent string `json:"app:accent,omitempty"`
```

**In `pkg/wconfig/metaconsts.go`:**
```go
ConfigKey_AppAccent = "app:accent"
```

---

## Acceptance Criteria

- [ ] `ThemeSetting` type is simplified to `"dark" | "light" | "system"`
- [ ] `AccentSetting` type is exported: `"green" | "warm" | "blue" | "purple" | "teal"`
- [ ] `isLightTheme` only checks for `"light"` (no more `light-gray`/`light-warm`)
- [ ] `useTheme()` applies both `data-theme` AND `data-accent` attributes to `document.documentElement`
- [ ] Migration: `"light-gray"` setting is auto-migrated to `app:theme = "light"`
- [ ] Migration: `"light-warm"` setting is auto-migrated to `app:theme = "light"` + `app:accent = "warm"`
- [ ] `resolvedAppThemeAtom` still works for all consumers (term-model, termtheme, term.tsx)
- [ ] `resolvedAccentAtom` is exported and reads `app:accent` setting
- [ ] `getResolvedTheme()` still works for Monaco integration
- [ ] `getResolvedAccent()` is exported for non-React contexts
- [ ] `getNativeThemeSource` is simplified (no more `isLightTheme` branching for variants)
- [ ] System theme preference change listener still works for `"system"` mode
- [ ] Settings registry has updated `app:theme` options and new `app:accent` entry
- [ ] TypeScript compiles without errors
- [ ] No behavioral regression for existing consumers of `resolvedAppThemeAtom`
