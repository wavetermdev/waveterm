# Oh-My-Posh Theme Selector - Architecture Blueprint

**Date:** 2026-01-25
**Status:** Ready for Implementation
**Component:** `OmpThemeControl` - Visual Oh-My-Posh Theme Selector

---

## 1. Patterns & Conventions Found

### 1.1 Existing Terminal Theme Implementation

**File:** `frontend/app/element/settings/settings-controls.scss:709-818`
- Terminal theme control uses a grid layout with visual preview cards
- Each card shows color swatches in rows
- Cards have hover and selected states with border highlighting
- Selected theme shows a checkmark indicator
- Full-width control layout (uses `fullWidth: true` in metadata)

**Pattern Reference:**
```scss
.termtheme-control {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
}

.termtheme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
}

.termtheme-card {
    display: flex;
    flex-direction: column;
    padding: 8px;
    border: 2px solid var(--form-element-border-color);
    &.selected { /* selected state */ }
}
```

### 1.2 Settings Control Architecture

**Control Factory Pattern:** `frontend/app/element/settings/control-factory.tsx:31-157`
- Each control type has its own component
- Controls are registered in a switch statement
- SettingControl wrapper provides label, description, reset functionality

**Settings Registry Pattern:** `frontend/app/store/settings-registry.ts:30-971`
- Metadata-driven GUI generation
- Settings organized by category and subcategory
- Control types defined in type system
- Full-width controls supported via `fullWidth` flag

**Dynamic Options Pattern:** `frontend/app/store/settings-options-provider.ts:48-71`
- OptionsProvider interface for runtime data fetching
- Providers registered in options-registry.ts
- Used for terminal themes, AI modes, etc.

### 1.3 Terminal Theme Loading

**Terminal Themes Source:** `pkg/wconfig/defaultconfig/termthemes.json`
- Themes stored as JSON with color definitions
- Each theme has `display:name` and `display:order`
- Colors include: black, red, green, yellow, blue, magenta, cyan, white, bright variants
- Also includes: background, foreground, cursor, selectionBackground

**Theme Provider:** `frontend/app/store/settings-options-provider.ts:48-71`
```typescript
class TermThemesProvider implements OptionsProvider {
    async getOptions(): Promise<SelectOption[]> {
        const fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
        const themes = fullConfig?.termthemes || {};
        return Object.entries(themes)
            .map(([key, theme]) => ({
                value: key,
                label: theme?.["display:name"] || key,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }
}
```

### 1.4 Component File Structure

**Location Pattern:** `frontend/app/element/settings/`
- Individual control components: `{type}-control.tsx`
- Exported via `index.ts`
- Styles in shared `settings-controls.scss`

---

## 2. Architecture Decision: OmpThemeControl Component

### 2.1 Core Approach

**Decision:** Create a standalone `OmpThemeControl` component that mirrors the existing `TermThemeControl` pattern but adapted for Oh-My-Posh themes.

**Rationale:**
1. Leverage proven visual theme selector pattern
2. Maintain consistency with existing terminal theme UI
3. Enable preview of OMP themes with color representations
4. Support future expansion for custom themes

**Trade-offs:**
- **Chosen:** Visual grid with color previews
  - Pro: Familiar to users, consistent with term themes
  - Pro: Quick visual identification
  - Con: Requires parsing OMP theme files
- **Not Chosen:** Simple dropdown select
  - Pro: Simpler implementation
  - Con: No visual preview, harder to choose

### 2.2 Data Source Strategy

**Decision:** Create `OmpThemesProvider` that fetches themes from Oh-My-Posh GitHub repository or local installation.

**Implementation Phases:**
1. **Phase 1 (MVP):** Static list of official themes
2. **Phase 2:** Fetch from GitHub API
3. **Phase 3:** Scan local OMP installation

**Rationale:**
- Phase 1 avoids network dependencies
- Provides immediate value
- Foundation for dynamic loading later

---

## 3. Component Design

### 3.1 OmpThemeControl Component

**File:** `frontend/app/element/settings/omptheme-control.tsx`

**Responsibilities:**
- Display OMP themes in a visual grid
- Show theme preview with color swatches
- Handle theme selection
- Indicate currently selected theme
- Support search/filter by theme name or style

**Interface:**
```typescript
interface OmpThemeControlProps {
    value: string;              // Current theme name
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
}
```

**State Management:**
- `themes`: Array of available OMP themes
- `loading`: Boolean for async theme fetching
- `searchQuery`: String for filtering themes
- `selectedCategory`: String for category filtering (optional)

**Key Methods:**
- `fetchThemes()`: Load available themes
- `renderThemeCard()`: Render individual theme preview
- `handleThemeSelect()`: Handle theme selection
- `extractThemeColors()`: Parse OMP theme for preview colors

### 3.2 OmpThemesProvider

**File:** `frontend/app/store/settings-options-provider.ts` (extend existing)

**Responsibilities:**
- Fetch available Oh-My-Posh themes
- Parse theme metadata
- Cache theme list
- Provide options for select controls

**Interface:**
```typescript
class OmpThemesProvider implements OptionsProvider {
    async getOptions(): Promise<SelectOption[]>
    async getThemeDetails(themeName: string): Promise<OmpThemeType>
}
```

### 3.3 Theme Data Types

**File:** `frontend/types/custom.d.ts` (extend)

```typescript
interface OmpThemeType {
    name: string;
    displayName: string;
    colors: {
        primary?: string;      // Extracted from theme
        secondary?: string;
        accent?: string;
        background?: string;
    };
    style?: 'minimal' | 'powerline' | 'rainbow' | 'classic';
    segments?: OmpSegment[];
}

interface OmpSegment {
    type: string;
    style: string;
    foreground?: string;
    background?: string;
}
```

---

## 4. Implementation Map

### 4.1 Files to Create

#### 4.1.1 `frontend/app/element/settings/omptheme-control.tsx`
**Purpose:** Main OMP theme selector component

**Content:**
```typescript
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";
import { ompThemesProvider } from "@/app/store/settings-options-provider";

interface OmpThemeControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

interface OmpTheme {
    name: string;
    displayName: string;
    colors: string[];  // Color swatches for preview
}

const OmpThemeControl = memo(({ value, onChange, disabled }: OmpThemeControlProps) => {
    const [themes, setThemes] = useState<OmpTheme[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fetch themes on mount
        fetchThemes();
    }, []);

    const fetchThemes = async () => {
        try {
            const themeList = await ompThemesProvider.getThemes();
            setThemes(themeList);
        } catch (error) {
            console.error("Failed to load OMP themes:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleThemeClick = useCallback((themeName: string) => {
        if (!disabled) {
            onChange(themeName);
        }
    }, [onChange, disabled]);

    if (loading) {
        return <div className="omptheme-loading">Loading themes...</div>;
    }

    return (
        <div className={cn("omptheme-control", { disabled })}>
            <div className="omptheme-grid">
                {themes.map((theme) => (
                    <ThemeCard
                        key={theme.name}
                        theme={theme}
                        selected={value === theme.name}
                        onClick={() => handleThemeClick(theme.name)}
                    />
                ))}
            </div>
        </div>
    );
});

interface ThemeCardProps {
    theme: OmpTheme;
    selected: boolean;
    onClick: () => void;
}

const ThemeCard = memo(({ theme, selected, onClick }: ThemeCardProps) => {
    return (
        <div
            className={cn("omptheme-card", { selected })}
            onClick={onClick}
        >
            <div className="omptheme-preview" style={{ background: theme.colors[0] }}>
                <div className="omptheme-color-row">
                    {theme.colors.slice(0, 8).map((color, i) => (
                        <div
                            key={i}
                            className="omptheme-swatch"
                            style={{ backgroundColor: color }}
                        />
                    ))}
                </div>
            </div>
            <div className="omptheme-name">{theme.displayName}</div>
            {selected && (
                <div className="omptheme-check">
                    <i className="fa fa-solid fa-check" />
                </div>
            )}
        </div>
    );
});

OmpThemeControl.displayName = "OmpThemeControl";
ThemeCard.displayName = "ThemeCard";

export { OmpThemeControl };
export type { OmpThemeControlProps };
```

### 4.2 Files to Modify

#### 4.2.1 `frontend/app/element/settings/index.ts`
**Changes:** Add export for OmpThemeControl

```typescript
// Add after StringListControl export
export { OmpThemeControl } from "./omptheme-control";
export type { OmpThemeControlProps } from "./omptheme-control";
```

#### 4.2.2 `frontend/app/element/settings/settings-controls.scss`
**Changes:** Add styles for OmpThemeControl (after termtheme styles)

```scss
// ===========================================
// Oh-My-Posh Theme Control
// ===========================================

.omptheme-control {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    padding: 8px 0;

    &.disabled {
        opacity: 0.5;
        pointer-events: none;
    }
}

.omptheme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
}

.omptheme-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 8px;
    border: 2px solid var(--form-element-border-color);
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
        box-shadow: 0 0 0 2px rgba(var(--accent-color-rgb, 88, 166, 255), 0.2);
    }
}

.omptheme-preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border-radius: 4px;
    margin-bottom: 8px;
}

.omptheme-color-row {
    display: flex;
    gap: 2px;
}

.omptheme-swatch {
    flex: 1;
    height: 14px;
    border-radius: 2px;
    min-width: 14px;
}

.omptheme-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--main-text-color);
    text-align: center;
    padding: 4px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.omptheme-check {
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

.omptheme-loading {
    padding: 20px;
    text-align: center;
    color: var(--secondary-text-color);
    font-size: 13px;
}
```

#### 4.2.3 `frontend/app/store/settings-options-provider.ts`
**Changes:** Add OmpThemesProvider class and export

```typescript
// Add after AIModeProvider class

/**
 * Provider for Oh-My-Posh themes.
 * Initially provides a static list of official themes.
 * Future: Fetch from GitHub API or local installation.
 */
class OmpThemesProvider implements OptionsProvider {
    private static OFFICIAL_THEMES = [
        "1_shell", "M365Princess", "agnoster", "agnoster.minimal", "agnosterplus",
        "aliens", "amro", "atomic", "atomicBit", "avit", "blue-owl", "blueish",
        "bubbles", "bubblesextra", "bubblesline", "capr4n", "catppuccin",
        "catppuccin_frappe", "catppuccin_latte", "catppuccin_macchiato",
        "catppuccin_mocha", "cert", "chips", "cinnamon", "clean-detailed",
        "cloud-context", "cloud-native-azure", "cobalt2", "craver", "darkblood",
        "devious-diamonds", "di4am0nd", "dracula", "easy-term", "emodipt",
        "emodipt-extend", "fish", "free-ukraine", "froczh", "glowsticks", "gmay",
        "grandpa-style", "gruvbox", "half-life", "honukai", "hotstick.minimal",
        "hul10", "hunk", "huvix", "if_tea", "illusi0n", "iterm2", "jandedobbeleer",
        "jblab_2021", "jonnychipz", "json", "jtracey93", "jv_sitecorian", "kali",
        "kushal", "lambda", "lambdageneration", "larserikfinholt", "lightgreen",
        "marcduiker", "markbull", "material", "microverse-power", "mojada",
        "montys", "mt", "multiverse-neon", "negligible", "neko", "night-owl",
        "nordtron", "nu4a", "onehalf.minimal", "paradox", "pararussel",
        "patriksvensson", "peru", "pixelrobots", "plague", "poshmon",
        "powerlevel10k_classic", "powerlevel10k_lean", "powerlevel10k_modern",
        "powerlevel10k_rainbow", "powerline", "probua.minimal", "pure",
        "quick-term", "remk", "robbyrussell", "rudolfs-dark", "rudolfs-light",
        "sim-web", "slim", "slimfat", "smoothie", "sonicboom_dark",
        "sonicboom_light", "sorin", "space", "spaceship", "star", "stelbent",
        "stelbent-compact.minimal", "takuya", "the-unnamed", "thecyberden",
        "tiwahu", "tokyo", "tokyonight_storm", "tonybaloney", "uew", "unicorn",
        "velvet", "wholespace", "wopian", "xtoys", "ys", "zash"
    ];

    async getOptions(): Promise<SelectOption[]> {
        return OmpThemesProvider.OFFICIAL_THEMES.map(name => ({
            value: name,
            label: this.formatThemeName(name),
        })).sort((a, b) => a.label.localeCompare(b.label));
    }

    async getThemes(): Promise<Array<{name: string, displayName: string, colors: string[]}>> {
        // For MVP, return themes with default color palettes
        // Future: Fetch actual theme files and parse colors
        return OmpThemesProvider.OFFICIAL_THEMES.map(name => ({
            name,
            displayName: this.formatThemeName(name),
            colors: this.getDefaultColors(name),
        }));
    }

    private formatThemeName(name: string): string {
        // Convert theme name to display name
        return name
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
            .replace(/\.minimal/i, ' (Minimal)')
            .replace(/Omp\.json$/i, '');
    }

    private getDefaultColors(themeName: string): string[] {
        // Return a default color palette based on theme name patterns
        // This is a placeholder - in Phase 2, we'll parse actual theme files
        if (themeName.includes('dracula')) {
            return ['#282a36', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'];
        } else if (themeName.includes('catppuccin')) {
            return ['#1e1e2e', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#94e2d5', '#cdd6f4'];
        } else if (themeName.includes('gruvbox')) {
            return ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'];
        } else if (themeName.includes('nord')) {
            return ['#2e3440', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'];
        } else if (themeName.includes('light')) {
            return ['#ffffff', '#d73a49', '#22863a', '#b08800', '#005cc5', '#6f42c1', '#0598bc', '#24292e'];
        } else {
            // Default powerline-style colors
            return ['#000000', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#cccccc'];
        }
    }
}

// Add to exports
export const ompThemesProvider = new OmpThemesProvider();
```

#### 4.2.4 `frontend/app/view/waveconfig/settings-visual.tsx`
**Changes:** Add omptheme case to renderControl function

```typescript
// In renderControl function, after termtheme case:

case "omptheme":
    return <OmpThemeControl
        value={(value as string) ?? ""}
        onChange={onChange as (value: string) => void}
    />;
```

**Changes:** Add import at top of file

```typescript
import { OmpThemeControl } from "@/app/element/settings/omptheme-control";
```

#### 4.2.5 `frontend/types/settings-metadata.d.ts`
**Changes:** Add "omptheme" to SettingControlType union

```typescript
type SettingControlType =
    | "toggle"
    | "number"
    | "slider"
    | "text"
    | "select"
    | "color"
    | "font"
    | "path"
    | "stringlist"
    | "termtheme"
    | "omptheme";  // Add this line
```

#### 4.2.6 `frontend/app/store/settings-registry.ts`
**Changes:** Add OMP theme setting metadata in Terminal category

```typescript
// Add after term:theme setting (around line 69)
{
    key: "term:omptheme",
    label: "Oh-My-Posh Theme",
    description: "Choose an Oh-My-Posh theme for your terminal prompt. This customizes the appearance of your command prompt with powerline symbols and colors.",
    category: "Terminal",
    subcategory: "Appearance",
    controlType: "omptheme",
    defaultValue: "",
    type: "string",
    tags: ["theme", "prompt", "powerline", "oh-my-posh", "appearance"],
    fullWidth: true,
},
```

#### 4.2.7 `pkg/wconfig/settingsconfig.go`
**Changes:** Add TermOmpTheme field to SettingsType struct

```go
// In SettingsType struct, after TermTheme field:
TermOmpTheme            string   `json:"term:omptheme,omitempty"`
```

#### 4.2.8 `pkg/wconfig/metaconsts.go`
**Changes:** Add constant for OMP theme config key

```go
// After ConfigKey_TermTheme constant:
ConfigKey_TermOmpTheme              = "term:omptheme"
```

---

## 5. Data Flow

### 5.1 Theme Loading Flow

```
Component Mount
    ↓
OmpThemeControl.fetchThemes()
    ↓
ompThemesProvider.getThemes()
    ↓
[Phase 1] Static theme list with default colors
[Phase 2] GitHub API fetch
[Phase 3] Local file scan
    ↓
Parse theme metadata
    ↓
Extract preview colors
    ↓
Return theme array
    ↓
Render theme grid
```

### 5.2 Theme Selection Flow

```
User clicks theme card
    ↓
handleThemeClick(themeName)
    ↓
onChange(themeName) - propagate to parent
    ↓
settingsService.setSetting("term:omptheme", themeName)
    ↓
Backend saves to settings.json
    ↓
Setting change triggers terminal reconfiguration
    ↓
New OMP theme applied to prompt
```

### 5.3 Settings Persistence Flow

```
User selects OMP theme
    ↓
frontend/app/store/settings-service.ts
    ↓
RPC call: SetConfigValue("term:omptheme", value)
    ↓
pkg/wconfig/settingsconfig.go
    ↓
Save to ~/.config/waveterm/settings.json
    ↓
Notify frontend of change
    ↓
Update UI selected state
```

---

## 6. Build Sequence

### Phase 1: Foundation (MVP)
- [ ] Create type definitions in `settings-metadata.d.ts`
- [ ] Add `OmpThemesProvider` class to `settings-options-provider.ts`
- [ ] Create `omptheme-control.tsx` with static theme list
- [ ] Add styles to `settings-controls.scss`
- [ ] Export component in `element/settings/index.ts`

### Phase 2: Integration
- [ ] Add setting metadata to `settings-registry.ts`
- [ ] Add omptheme case to `settings-visual.tsx` renderControl
- [ ] Add backend support in `settingsconfig.go`
- [ ] Add config key constant in `metaconsts.go`
- [ ] Test setting persistence

### Phase 3: Visual Polish
- [ ] Implement theme preview color extraction
- [ ] Add loading states
- [ ] Add error handling
- [ ] Add theme categories/grouping (optional)
- [ ] Add search/filter functionality (optional)

### Phase 4: Dynamic Loading (Future)
- [ ] Implement GitHub API integration
- [ ] Add theme file parsing
- [ ] Add local OMP installation detection
- [ ] Add custom theme support
- [ ] Add theme preview screenshots

---

## 7. Critical Details

### 7.1 Error Handling

**Theme Loading Errors:**
```typescript
try {
    const themes = await ompThemesProvider.getThemes();
    setThemes(themes);
} catch (error) {
    console.error("Failed to load OMP themes:", error);
    // Fallback to minimal default list
    setThemes([{ name: "default", displayName: "Default", colors: [...] }]);
}
```

**Network Errors (Phase 2):**
- Implement retry logic with exponential backoff
- Cache fetched themes in localStorage
- Provide offline fallback to static list

### 7.2 State Management

**Component State:**
- `themes`: Managed locally in component
- `loading`: Boolean flag for async operations
- `value`: Controlled via props from settings service

**Global State:**
- Setting value stored in settings service
- Changes propagate via atom updates
- No need for additional global state

### 7.3 Testing Strategy

**Unit Tests:**
- Test theme name formatting
- Test color extraction logic
- Test selection handling
- Test loading states

**Integration Tests:**
- Test setting persistence
- Test theme application to terminal
- Test error recovery

**Manual Testing:**
- Visual verification of theme previews
- Test with various themes
- Test responsive grid layout
- Test keyboard navigation

### 7.4 Performance Considerations

**Optimization Strategies:**
1. Lazy load theme details only when needed
2. Cache theme list after first fetch
3. Use memo for theme card rendering
4. Virtualize grid if theme count > 100 (future)

**Memory Management:**
- Theme list ~5KB for 125 themes
- Color arrays minimal overhead
- No image loading in MVP

### 7.5 Security Considerations

**Phase 1 (MVP):**
- Static theme list - no security concerns
- No external data fetching
- No user input validation needed

**Phase 2 (GitHub API):**
- Validate GitHub API responses
- Sanitize theme names
- Prevent XSS in theme display names
- Rate limit API calls

**Phase 3 (Local files):**
- Validate file paths
- Sanitize file contents
- Prevent directory traversal
- Validate JSON schema

### 7.6 Accessibility

**Keyboard Navigation:**
- Theme cards focusable with tab
- Enter/Space to select theme
- Arrow keys for grid navigation (future)

**Screen Readers:**
- Proper ARIA labels for theme cards
- Announce selected theme
- Loading state announcements

**Visual:**
- High contrast for selected state
- Color not sole indicator (checkmark added)
- Proper focus indicators

---

## 8. Future Enhancements

### 8.1 Phase 2 Features
- Fetch themes from Oh-My-Posh GitHub repository
- Parse actual `.omp.json` files for accurate colors
- Cache themes in localStorage
- Add theme preview screenshots

### 8.2 Phase 3 Features
- Detect local Oh-My-Posh installation
- Scan for custom user themes
- Theme editor/customizer
- Import/export custom themes

### 8.3 Phase 4 Features
- Theme categories/tags (minimal, powerline, nerd font, etc.)
- Search and filter by name or style
- Favorite themes
- Recent themes
- Live preview in terminal

---

## 9. References

### 9.1 Similar Components
- **TermThemeControl:** Referenced pattern (SCSS lines 709-818)
- **ColorControl:** Component structure reference
- **SelectControl:** Options provider pattern

### 9.2 External Resources
- [Oh My Posh Themes](https://ohmyposh.dev/docs/themes)
- [Oh My Posh GitHub Themes](https://github.com/JanDeDobbeleer/oh-my-posh/tree/main/themes)
- [Oh My Posh Schema](https://github.com/JanDeDobbeleer/oh-my-posh/blob/main/themes/schema.json)

### 9.3 Code Locations
- Settings registry: `frontend/app/store/settings-registry.ts`
- Control factory: `frontend/app/element/settings/control-factory.tsx`
- Settings visual: `frontend/app/view/waveconfig/settings-visual.tsx`
- Options provider: `frontend/app/store/settings-options-provider.ts`
- Styles: `frontend/app/element/settings/settings-controls.scss`

---

## 10. Implementation Checklist

### Pre-Implementation
- [x] Analyze existing terminal theme pattern
- [x] Review settings infrastructure
- [x] Research Oh-My-Posh theme format
- [x] Design component architecture

### Phase 1: MVP Implementation
- [ ] Add type definition for "omptheme" control type
- [ ] Create OmpThemesProvider with static theme list
- [ ] Create OmpThemeControl component
- [ ] Add SCSS styles for omptheme control
- [ ] Export component from settings/index.ts
- [ ] Add setting metadata to registry
- [ ] Integrate with settings-visual.tsx
- [ ] Add backend Go struct field
- [ ] Add config key constant
- [ ] Test component rendering
- [ ] Test theme selection
- [ ] Test setting persistence

### Phase 2: Visual Polish
- [ ] Refine color extraction logic
- [ ] Add loading spinner
- [ ] Add error states
- [ ] Improve theme name formatting
- [ ] Test with all 125+ themes
- [ ] Verify responsive layout
- [ ] Add keyboard navigation

### Phase 3: Testing & Documentation
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Manual QA testing
- [ ] Update user documentation
- [ ] Create demo screenshots

---

## Summary

This architecture blueprint provides a complete, actionable plan for implementing the Oh-My-Posh theme selector component. The design:

1. **Follows established patterns** from the existing TermThemeControl
2. **Integrates seamlessly** with the settings infrastructure
3. **Provides immediate value** with a static theme list (MVP)
4. **Enables future expansion** for dynamic theme loading
5. **Maintains consistency** with Wave Terminal's design system

The implementation is broken into clear phases with specific file changes, code examples, and testing strategies. All critical details for error handling, state management, performance, and security are addressed.

**Next Step:** Begin Phase 1 implementation by creating the type definitions and OmpThemesProvider class.
