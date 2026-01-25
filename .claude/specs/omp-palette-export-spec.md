# Oh-My-Posh ANSI Color Palette Export Feature - Implementation Specification

## Overview
This specification outlines the implementation of an ANSI color palette export feature that generates Oh-My-Posh (OMP) compatible palette configurations from the current terminal theme.

## Architecture Decision

### Approach: Standalone Component with Direct Theme Access
We will create a self-contained component that:
1. Reads terminal theme colors directly from `fullConfigAtom`
2. Generates OMP-compatible JSON palette format
3. Provides clipboard copy functionality with user feedback
4. Shows a visual preview of the exported colors
5. Includes clear usage instructions

**Rationale:**
- Leverages existing theme access patterns (similar to `settings-options-provider.ts:59`)
- Follows established control component patterns (like `color-control.tsx`)
- Integrates naturally into settings UI without requiring new abstractions
- Uses standard clipboard API patterns found throughout the codebase

## Component Design

### 1. OmpPaletteExport Component
**File:** `frontend/app/element/settings/omp-palette-export.tsx`

**Responsibilities:**
- Fetch current terminal theme from fullConfigAtom
- Generate OMP palette JSON format
- Handle clipboard operations with user feedback
- Display color preview grid
- Show usage instructions

**Dependencies:**
- `@/app/store/global` - for accessing fullConfigAtom
- `@/app/store/jotaiStore` - for globalStore
- `@/util/util` - for cn utility
- React hooks (useState, useCallback, useMemo)
- jotai (useAtomValue)

**Interface:**
```typescript
interface OmpPaletteExportProps {
    themeName?: string; // Optional: specific theme, defaults to current
    className?: string;
}
```

**Key Functions:**
```typescript
// Convert TermThemeType to OMP palette format
function convertToOmpPalette(theme: TermThemeType): OmpPalette

// Copy palette JSON to clipboard
async function copyPaletteToClipboard(palette: OmpPalette): Promise<void>

// Get ANSI color names in OMP format
function getAnsiColorNames(): string[]
```

### 2. Integration Point
**File:** `frontend/app/store/settings-registry.ts`

**Changes:**
- Add new setting entry for OMP export feature under Terminal category
- Use custom control type "omppalette" to render the export component

**Location in Settings:**
- Category: Terminal
- Subcategory: Prompt Compatibility (new)
- Position: After existing terminal appearance settings

## Data Flow

```
User opens Terminal Settings
    ↓
Navigate to "Prompt Compatibility" section
    ↓
Component reads fullConfigAtom → termthemes → current theme
    ↓
Generate OMP palette object with 16 ANSI colors
    ↓
Display color preview grid + JSON preview
    ↓
User clicks "Copy to Clipboard"
    ↓
JSON written to clipboard via navigator.clipboard.writeText()
    ↓
Show success notification
    ↓
User pastes into ~/.config/oh-my-posh/config.json
```

## Implementation Map

### Files to Create

#### 1. `frontend/app/element/settings/omp-palette-export.tsx` (NEW)
**Purpose:** Main component for OMP palette export

**Content Structure:**
```typescript
// Component interface and types
interface OmpPaletteExportProps { ... }
interface OmpPalette { ... }

// Utility functions
function convertToOmpPalette(theme: TermThemeType): OmpPalette
function getAnsiColorNames(): string[]
function formatPaletteJson(palette: OmpPalette): string

// Main component
export const OmpPaletteExport = memo(({ themeName, className }: OmpPaletteExportProps) => {
    // State for copy feedback
    // Read theme from fullConfigAtom
    // Generate palette
    // Render preview grid
    // Clipboard button with feedback
    // Usage instructions
})
```

**Key Features:**
- 16-color grid preview (8 standard + 8 bright)
- Color swatches with labels
- Copy button with loading/success states
- Collapsible JSON preview
- Usage instructions with example OMP config snippet

#### 2. `frontend/app/element/settings/omp-palette-export.scss` (NEW)
**Purpose:** Styles for the OMP palette export component

**Content Structure:**
```scss
.omp-palette-export {
    // Container styles

    .palette-preview-grid {
        // 4x4 grid layout for colors
    }

    .color-swatch {
        // Individual color box with label
    }

    .copy-button {
        // Primary action button
        // States: default, loading, success
    }

    .json-preview {
        // Collapsible JSON display
    }

    .usage-instructions {
        // Help text styling
    }
}
```

### Files to Modify

#### 3. `frontend/app/store/settings-registry.ts`
**Location:** Add to `allSettings` array in Terminal category

**Changes:**
```typescript
{
    key: "term:ompexport",
    label: "Oh-My-Posh Palette Export",
    description: "Export your current terminal color scheme as an Oh-My-Posh palette configuration. Copy the palette and add it to your OMP config file.",
    category: "Terminal",
    subcategory: "Prompt Compatibility",
    controlType: "omppalette",
    defaultValue: null,
    type: "string",
    tags: ["omp", "oh-my-posh", "palette", "export", "prompt"],
    fullWidth: true,
}
```

#### 4. `frontend/types/settings-metadata.d.ts`
**Location:** SettingControlType union type

**Changes:**
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
    | "omppalette"; // ADD THIS
```

#### 5. `frontend/app/view/waveconfig/settings-visual.tsx`
**Location:** `renderControl` function (line ~381)

**Changes:**
```typescript
function renderControl(...) {
    switch (metadata.controlType) {
        // ... existing cases ...

        case "omppalette":
            return <OmpPaletteExport />;

        default:
            // ... existing default ...
    }
}
```

**Import to add:**
```typescript
import { OmpPaletteExport } from "@/app/element/settings/omp-palette-export";
```

#### 6. `frontend/app/element/settings/settings-controls.scss`
**Location:** Import the new SCSS file

**Changes:**
```scss
// Add at bottom of file
@import "./omp-palette-export.scss";
```

## OMP Palette Format

### Expected JSON Structure
```json
{
  "palette": {
    "black": "#757575",
    "red": "#cc685c",
    "green": "#76c266",
    "yellow": "#cbca9b",
    "blue": "#85aacb",
    "magenta": "#cc72ca",
    "cyan": "#74a7cb",
    "white": "#c1c1c1",
    "darkGray": "#727272",
    "lightRed": "#cc9d97",
    "lightGreen": "#a3dd97",
    "lightYellow": "#cbcaaa",
    "lightBlue": "#9ab6cb",
    "lightMagenta": "#cc8ecb",
    "lightCyan": "#b7b8cb",
    "lightWhite": "#f0f0f0"
  }
}
```

### Mapping from TermThemeType
```typescript
const ompColorMap = {
    "black": theme.black,
    "red": theme.red,
    "green": theme.green,
    "yellow": theme.yellow,
    "blue": theme.blue,
    "magenta": theme.magenta,
    "cyan": theme.cyan,
    "white": theme.white,
    "darkGray": theme.brightBlack,
    "lightRed": theme.brightRed,
    "lightGreen": theme.brightGreen,
    "lightYellow": theme.brightYellow,
    "lightBlue": theme.brightBlue,
    "lightMagenta": theme.brightMagenta,
    "lightCyan": theme.brightCyan,
    "lightWhite": theme.brightWhite
};
```

## Build Sequence

### Phase 1: Core Component (30-45 min)
- [ ] Create `omp-palette-export.tsx` with basic structure
- [ ] Implement `convertToOmpPalette` function
- [ ] Add theme reading from fullConfigAtom
- [ ] Test palette generation logic

### Phase 2: UI Implementation (30-45 min)
- [ ] Create color preview grid
- [ ] Add color swatches with labels
- [ ] Implement JSON preview section
- [ ] Add usage instructions text
- [ ] Create `omp-palette-export.scss`

### Phase 3: Clipboard Integration (15-20 min)
- [ ] Implement clipboard copy function
- [ ] Add copy button with states (idle/loading/success)
- [ ] Add user feedback (icon change, tooltip)
- [ ] Error handling for clipboard failures

### Phase 4: Settings Integration (15-20 min)
- [ ] Update `settings-metadata.d.ts` with new control type
- [ ] Add setting entry to `settings-registry.ts`
- [ ] Update `renderControl` in `settings-visual.tsx`
- [ ] Import component and SCSS

### Phase 5: Testing & Polish (20-30 min)
- [ ] Test with different terminal themes
- [ ] Verify JSON format matches OMP spec
- [ ] Test clipboard functionality
- [ ] Check responsive layout
- [ ] Verify accessibility (keyboard navigation)
- [ ] Test with no theme selected (fallback behavior)

**Total Estimated Time:** 2-2.5 hours

## Critical Implementation Details

### 1. Error Handling
```typescript
// Theme not found
if (!theme) {
    return (
        <div className="omp-palette-export-error">
            <i className="fa fa-exclamation-triangle" />
            <span>No terminal theme selected. Please choose a theme first.</span>
        </div>
    );
}

// Clipboard failure
try {
    await navigator.clipboard.writeText(json);
    setSuccess(true);
} catch (error) {
    console.error("Clipboard error:", error);
    setError("Failed to copy to clipboard");
}
```

### 2. Theme Access Pattern
```typescript
// Following pattern from settings-options-provider.ts:59
const fullConfig = useAtomValue(atoms.fullConfigAtom);
const currentThemeName = useAtomValue(getSettingsPrefixAtom("term:theme"));
const themes = fullConfig?.termthemes ?? {};
const theme = themes[currentThemeName || DefaultTermTheme];
```

### 3. Color Validation
```typescript
// Ensure all colors are valid hex codes
function validateHexColor(color: string): string {
    if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return "#000000"; // fallback
    }
    return color;
}
```

### 4. State Management
```typescript
const [copyState, setCopyState] = useState<"idle" | "copying" | "success" | "error">("idle");
const [showJsonPreview, setShowJsonPreview] = useState(false);
```

### 5. Performance
- Use `useMemo` for palette generation (only regenerate when theme changes)
- Debounce clipboard operations if needed
- Lazy render JSON preview (only when expanded)

### 6. Accessibility
```typescript
// Keyboard support for copy button
<button
    onClick={handleCopy}
    disabled={copyState === "copying"}
    aria-label="Copy palette to clipboard"
    aria-live="polite"
>
    {copyState === "success" ? "Copied!" : "Copy to Clipboard"}
</button>

// Color swatches with accessible labels
<div
    className="color-swatch"
    style={{ backgroundColor: color }}
    role="img"
    aria-label={`${colorName}: ${color}`}
>
    <span className="color-label">{colorName}</span>
    <span className="color-value">{color}</span>
</div>
```

## UI Mockup Structure

```
┌─────────────────────────────────────────────────┐
│ Oh-My-Posh Palette Export                       │
├─────────────────────────────────────────────────┤
│                                                 │
│ Current Theme: Default Dark                     │
│                                                 │
│ ┌─────┬─────┬─────┬─────┐                      │
│ │ BLK │ RED │ GRN │ YEL │  Standard Colors     │
│ └─────┴─────┴─────┴─────┘                      │
│ ┌─────┬─────┬─────┬─────┐                      │
│ │ BLU │ MAG │ CYN │ WHT │                      │
│ └─────┴─────┴─────┴─────┘                      │
│                                                 │
│ ┌─────┬─────┬─────┬─────┐                      │
│ │ GRY │ RED │ GRN │ YEL │  Bright Colors       │
│ └─────┴─────┴─────┴─────┘                      │
│ ┌─────┬─────┬─────┬─────┐                      │
│ │ BLU │ MAG │ CYN │ WHT │                      │
│ └─────┴─────┴─────┴─────┘                      │
│                                                 │
│ [✓ Copied!]                                     │
│                                                 │
│ ▼ View JSON Preview                             │
│                                                 │
│ Usage Instructions:                             │
│ 1. Copy the palette above                       │
│ 2. Open your OMP config file:                   │
│    ~/.config/oh-my-posh/config.json             │
│ 3. Add the palette object at the root level     │
│ 4. Reference colors in your theme:              │
│    "foreground": "p:white"                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Security Considerations
- Clipboard API requires secure context (HTTPS/localhost) - already satisfied
- No user input validation needed (read-only theme data)
- JSON stringification is safe (no executable code)

## Testing Strategy
1. **Unit Tests** (if test infrastructure exists):
   - `convertToOmpPalette()` with various themes
   - Color validation logic
   - JSON formatting

2. **Integration Tests**:
   - Component renders with valid theme
   - Component handles missing theme
   - Clipboard copy succeeds
   - UI states transition correctly

3. **Manual Tests**:
   - Test with each bundled theme (default-dark, onedarkpro, dracula, etc.)
   - Verify copied JSON works in actual OMP config
   - Check responsive layout at different widths
   - Test keyboard navigation
   - Verify color accuracy in preview vs terminal

## Documentation Updates Needed
None - this is a UI-only feature with inline instructions.

## Future Enhancements (Out of Scope)
- Import OMP palettes to create terminal themes
- Export to other prompt frameworks (Starship, Powerline)
- Theme editor with live preview
- Share palettes via URL/file

## References
- Terminal theme definition: `pkg/wconfig/defaultconfig/termthemes.json`
- TermThemeType interface: `frontend/types/gotypes.d.ts:1216-1242`
- Clipboard patterns: `frontend/app/app.tsx:251`, `frontend/app/element/markdown.tsx:153`
- Color control pattern: `frontend/app/element/settings/color-control.tsx`
- Settings integration: `frontend/app/view/waveconfig/settings-visual.tsx`
- Theme access: `frontend/app/store/settings-options-provider.ts:59`

## Success Criteria
✅ Component displays current theme's 16 ANSI colors in a grid
✅ Copy button successfully writes OMP-compatible JSON to clipboard
✅ JSON format matches OMP specification exactly
✅ UI provides clear feedback on copy success/failure
✅ Instructions guide users on how to use exported palette
✅ Component integrates seamlessly into Terminal settings
✅ Works with all bundled terminal themes
✅ Handles edge cases (no theme, invalid colors) gracefully
