# Prompt Color Contrast Warning System - Implementation Specification

**Feature ID**: spec-prompt-contrast-warning
**Created**: 2026-01-25
**Status**: Planning

---

## Overview

Implement a non-intrusive prompt color contrast warning system that detects when terminal prompt colors have poor contrast against the current terminal theme background and displays a warning indicator in the terminal block header.

---

## Problem Statement

Users may configure their shell prompts (via PS1, starship, oh-my-zsh, etc.) with colors that work well on one terminal theme but have poor contrast on another. For example:
- Light-colored prompts (yellow, white) on light themes
- Dark-colored prompts (blue, black) on dark themes

This creates usability issues where prompts become difficult or impossible to read, but users may not realize the issue is contrast-related.

---

## Architecture Analysis

### Existing Patterns Found

#### 1. Terminal Structure (frontend/app/view/term/)

**term.tsx** (lines 168-491):
- Main terminal component rendering
- Uses `TermViewModel` for state management
- Integrates multiple sub-components (TermStickers, TermVDomNode, etc.)
- Header integration via `viewText` atom in ViewModel

**term-model.ts** (lines 45-1174):
- ViewModel pattern with Jotai atoms for reactive state
- `viewText` atom (line 123): Returns `HeaderElem[]` for header content
- `endIconButtons` atom (line 266): Returns `IconButtonDecl[]` for header buttons
- Example pattern: Shell integration status button (lines 345-389)

**termwrap.ts** (lines 505-1100+):
- Core terminal wrapper using xterm.js
- Has `SerializeAddon` (line 515) for getting terminal content
- Terminal buffer accessible via `this.terminal.buffer.active`
- OSC sequence handlers already implemented (OSC 7, OSC 52)

#### 2. Header Icon Buttons (frontend/app/block/blockframe.tsx)

**blockframe.tsx** (lines 120-171):
```typescript
function computeEndIcons(
    viewModel: ViewModel,
    nodeModel: NodeModel,
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
): React.ReactElement[]
```
- Reads `viewModel.endIconButtons` atom
- Renders array of `IconButton` components
- Used for settings, magnify, close buttons

**IconButtonDecl type** (frontend/types/custom.d.ts lines 186-190):
```typescript
type IconButtonDecl = IconButtonCommon & {
    elemtype: "iconbutton";
    click?: (e: React.MouseEvent<any>) => void;
    longClick?: (e: React.MouseEvent<any>) => void;
};
```

#### 3. Similar Warning Indicators

**provider-status-badge.tsx**:
- Uses `Tooltip` component for hover details
- Status-based icon rendering (ready, incomplete, local, cloud)
- Color-coded status via CSS classes
- Pattern: Icon + Tooltip with detailed explanation

**Shell Integration Status** (term-model.ts lines 345-389):
- Returns `IconButtonDecl` with status-based icons
- Uses sparkles icon with different colors (muted, accent, warning)
- `noAction: true` for non-clickable indicators
- Includes detailed title text for hover

#### 4. Color Analysis

**colord library** (package.json line 97):
- Already in dependencies
- Used in termutil.ts (line 9) for color manipulation
- Supports luminance calculation and contrast ratios

---

## Design Decisions

### 1. Architecture Approach

**Decision**: Integrate into TermViewModel's `endIconButtons` atom
**Rationale**:
- Follows existing pattern (shell integration status)
- Minimal changes to existing code
- Automatic header integration via BlockFrame
- Reactive updates via Jotai atoms

**Alternative Rejected**: Separate header component overlay
- Would require changes to term.tsx rendering
- More complex z-index management
- Doesn't follow existing patterns

### 2. Prompt Detection Strategy

**Decision**: Analyze first visible line of terminal buffer after shell prompt markers
**Implementation**:
- Use xterm.js buffer API: `terminal.buffer.active.getLine(0)`
- Parse ANSI sequences to extract foreground colors
- Focus on first 1-3 lines (typical prompt range)
- Trigger analysis on:
  - Theme change (via TermThemeUpdater pattern)
  - Terminal resize/reflow
  - New prompt detection (via OSC 133 prompt markers)

**Alternative Rejected**: Parse terminal output via SerializeAddon
- Less efficient (serializes entire buffer)
- Includes historical data, not just current prompt
- Harder to isolate prompt vs command output

### 3. Contrast Calculation

**Decision**: Use WCAG 2.1 contrast ratio algorithm via colord
**Thresholds**:
- Good: Contrast ratio >= 4.5:1 (WCAG AA standard for normal text)
- Warning: Contrast ratio >= 3:1 but < 4.5:1
- Poor: Contrast ratio < 3:1

**Algorithm**:
```typescript
import { colord } from "colord";

function calculateContrast(fgColor: string, bgColor: string): number {
    return colord(fgColor).contrast(bgColor);
}
```

### 4. Warning Display

**Decision**: Icon button in header `endIconButtons` with tooltip
**Visual Design**:
- Icon: "triangle-exclamation" (warning icon)
- Color: `var(--warning-color)` for poor contrast
- Tooltip content: Specific colors with poor contrast + settings link
- Only show when contrast is poor (< 3:1)

**Interaction**:
- Non-clickable indicator (`noAction: true`)
- Hover shows detailed tooltip with:
  - Which colors have poor contrast
  - Specific contrast ratio
  - Link text to suggest settings/theme change

---

## Component Design

### 1. PromptContrastAnalyzer Utility

**File**: `frontend/app/view/term/prompt-contrast.ts`

**Responsibilities**:
- Parse ANSI escape sequences from terminal buffer
- Extract foreground colors from first N lines
- Calculate contrast ratios against terminal background
- Return analysis result

**Interface**:
```typescript
export interface PromptContrastAnalysis {
    status: "good" | "warning" | "poor";
    poorContrastColors: Array<{
        color: string;
        contrastRatio: number;
        location: string; // e.g., "first line", "prompt"
    }>;
    backgroundColor: string;
}

export class PromptContrastAnalyzer {
    /**
     * Analyzes the terminal prompt for color contrast issues
     * @param terminal - xterm.js Terminal instance
     * @param backgroundColor - Current terminal theme background color
     * @param linesToAnalyze - Number of lines from top to analyze (default: 3)
     * @returns Analysis result with contrast status
     */
    static analyze(
        terminal: Terminal,
        backgroundColor: string,
        linesToAnalyze: number = 3
    ): PromptContrastAnalysis;

    /**
     * Extracts ANSI foreground colors from a terminal buffer line
     * @param line - Terminal buffer line
     * @returns Array of RGB color strings
     */
    private static extractColorsFromLine(
        line: IBufferLine
    ): string[];

    /**
     * Converts xterm.js color attributes to RGB hex string
     * @param attrs - Terminal cell attributes
     * @param defaultColor - Default foreground color
     * @returns RGB color string (e.g., "#FFFFFF")
     */
    private static attrToColor(
        attrs: IBufferCellData,
        defaultColor: string
    ): string;
}
```

**ANSI Color Parsing**:
- xterm.js provides cell attributes via `line.getCell(col).getFgColor()`
- Cell colors can be:
  - Default terminal color (0)
  - Palette color (1-255)
  - RGB color (16777216+)
- Use terminal's theme palette for color resolution

### 2. TermViewModel Integration

**File**: `frontend/app/view/term/term-model.ts`

**Changes**:

```typescript
export class TermViewModel implements ViewModel {
    // ... existing properties ...

    // New atom for prompt contrast status
    promptContrastStatus: jotai.Atom<PromptContrastAnalysis | null>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        // ... existing initialization ...

        // Initialize prompt contrast status atom
        this.promptContrastStatus = jotai.atom((get) => {
            // Only analyze for basic terminal mode (not vdom, not cmd)
            if (!this.isBasicTerm(get)) {
                return null;
            }

            // Get current background color
            const bgColor = get(this.termBgColor);

            // Trigger re-analysis when theme changes
            // Actual analysis is debounced and triggered elsewhere
            return get(this.promptContrastStatusAtom);
        });

        this.promptContrastStatusAtom = jotai.atom<PromptContrastAnalysis | null>(null);
    }

    // Update endIconButtons to include contrast warning
    this.endIconButtons = jotai.atom((get) => {
        const rtn: IconButtonDecl[] = [];

        // ... existing shell integration button ...

        // Add prompt contrast warning if needed
        const contrastStatus = get(this.promptContrastStatus);
        if (contrastStatus?.status === "poor") {
            rtn.push(this.getPromptContrastWarningButton(contrastStatus));
        }

        // ... existing buttons (restart, etc.) ...

        return rtn;
    });

    /**
     * Creates the prompt contrast warning icon button
     */
    private getPromptContrastWarningButton(
        analysis: PromptContrastAnalysis
    ): IconButtonDecl {
        const colorList = analysis.poorContrastColors
            .map(c => `${c.color} (${c.contrastRatio.toFixed(1)}:1)`)
            .join(", ");

        return {
            elemtype: "iconbutton",
            icon: "triangle-exclamation",
            className: "text-warning",
            title: `Poor prompt contrast detected: ${colorList}. Consider changing terminal theme or prompt colors.`,
            noAction: true,
        };
    }

    /**
     * Analyzes prompt contrast and updates the atom
     * Called when theme changes or terminal content updates
     */
    analyzePromptContrast() {
        if (!this.termRef.current?.terminal) {
            return;
        }

        const bgColor = globalStore.get(this.termBgColor);
        const analysis = PromptContrastAnalyzer.analyze(
            this.termRef.current.terminal,
            bgColor
        );

        globalStore.set(this.promptContrastStatusAtom, analysis);
    }
}
```

### 3. TermWrap Integration

**File**: `frontend/app/view/term/termwrap.ts`

**Changes**:

```typescript
export class TermWrap {
    // ... existing properties ...

    // Callback for prompt contrast analysis
    onPromptUpdate?: () => void;

    async initTerminal() {
        // ... existing initialization ...

        // Listen for prompt markers (OSC 133 A - prompt start)
        this.terminal.parser.registerOscHandler(133, (data: string) => {
            if (data.startsWith("A")) { // Prompt start
                // Trigger contrast analysis after prompt renders
                setTimeout(() => {
                    this.onPromptUpdate?.();
                }, 100);
            }
            return true;
        });

        // ... rest of initialization ...
    }
}
```

### 4. TermThemeUpdater Integration

**File**: `frontend/app/view/term/termtheme.ts`

**Changes**:

```typescript
const TermThemeUpdater = ({ blockId, model, termRef }: TermThemeProps) => {
    // ... existing theme atoms ...

    useEffect(() => {
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = theme;
            const terminal = termRef.current.terminal;
            terminal.refresh(0, terminal.rows - 1);

            // Trigger prompt contrast analysis on theme change
            setTimeout(() => {
                model.analyzePromptContrast?.();
            }, 200); // Delay to ensure theme is applied
        }
    }, [theme]);

    return null;
};
```

### 5. Terminal View Integration

**File**: `frontend/app/view/term/term.tsx`

**Changes**:

```typescript
const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    // ... existing code ...

    React.useEffect(() => {
        // ... existing TermWrap initialization ...

        // Set up prompt contrast analysis callback
        termWrap.onPromptUpdate = () => {
            model.analyzePromptContrast();
        };

        // Initial analysis after terminal loads
        termWrap.initTerminal.bind(termWrap)().then(() => {
            setTimeout(() => {
                model.analyzePromptContrast();
            }, 500);
        });

        // ... rest of initialization ...
    }, [blockId, termSettings, termFontSize, connFontFamily]);

    // ... rest of component ...
};
```

---

## Data Flow

### 1. Initial Analysis Flow

```
Terminal Initialization
  → TermWrap.initTerminal()
  → Terminal buffer populated
  → 500ms delay
  → model.analyzePromptContrast()
  → PromptContrastAnalyzer.analyze()
  → Parse buffer lines 0-2
  → Extract ANSI colors
  → Calculate contrast vs termBgColor
  → Update promptContrastStatusAtom
  → endIconButtons atom recomputes
  → BlockFrame renders warning icon
```

### 2. Theme Change Flow

```
User changes terminal theme
  → termThemeNameAtom updates
  → TermThemeUpdater effect runs
  → terminal.options.theme = newTheme
  → terminal.refresh()
  → 200ms delay
  → model.analyzePromptContrast()
  → [same analysis flow as above]
```

### 3. New Prompt Flow

```
Shell outputs new prompt
  → OSC 133 A sequence received
  → TermWrap OSC handler triggers
  → 100ms delay (wait for prompt render)
  → onPromptUpdate callback
  → model.analyzePromptContrast()
  → [same analysis flow as above]
```

---

## Implementation Phases

### Phase 1: Core Analysis Engine
**Files**: `frontend/app/view/term/prompt-contrast.ts`

1. Create `PromptContrastAnalyzer` class
2. Implement ANSI color extraction from xterm buffer
3. Implement contrast calculation using colord
4. Add unit tests for color parsing
5. Add unit tests for contrast calculation

**Exit Criteria**:
- Analyzer correctly extracts colors from buffer lines
- Contrast calculations match WCAG 2.1 standards
- Edge cases handled (default colors, palette, RGB)

### Phase 2: ViewModel Integration
**Files**: `frontend/app/view/term/term-model.ts`

1. Add `promptContrastStatus` atom
2. Add `promptContrastStatusAtom` primitive atom
3. Implement `analyzePromptContrast()` method
4. Implement `getPromptContrastWarningButton()` method
5. Update `endIconButtons` atom to include warning

**Exit Criteria**:
- Warning button appears when poor contrast detected
- Warning button disappears when contrast is good
- Button has correct icon, color, and tooltip

### Phase 3: Terminal Integration
**Files**:
- `frontend/app/view/term/term.tsx`
- `frontend/app/view/term/termwrap.ts`
- `frontend/app/view/term/termtheme.ts`

1. Add `onPromptUpdate` callback to TermWrap
2. Register OSC 133 handler for prompt detection
3. Wire up callback in TerminalView initialization
4. Add theme change trigger in TermThemeUpdater
5. Add initial analysis after terminal load

**Exit Criteria**:
- Analysis triggers on theme change
- Analysis triggers on new prompt (OSC 133)
- Analysis triggers on initial load
- No performance degradation

### Phase 4: Polish & Edge Cases

1. Add debouncing for rapid theme changes
2. Handle terminal in alt screen mode (don't analyze)
3. Handle vdom mode and cmd controller (skip analysis)
4. Add CSS styling for warning icon
5. Improve tooltip content formatting
6. Add accessibility attributes

**Exit Criteria**:
- Smooth user experience with no flicker
- Correct behavior in all terminal modes
- Accessible to screen readers
- Clear, helpful tooltip content

---

## Critical Implementation Details

### 1. ANSI Color Extraction

xterm.js cell attributes structure:
```typescript
interface IBufferCellData {
    getFgColorMode(): number; // 0=default, 1=palette, 2=rgb
    getFgColor(): number; // Color value based on mode
    isFgPalette(): boolean;
    isFgRGB(): boolean;
}
```

Color resolution logic:
```typescript
private static attrToColor(
    cell: IBufferCellData,
    terminal: Terminal
): string {
    const mode = cell.getFgColorMode();

    if (mode === 0) {
        // Default - use theme foreground
        return terminal.options.theme.foreground || "#FFFFFF";
    } else if (mode === 1) {
        // Palette (0-255)
        const index = cell.getFgColor();
        const theme = terminal.options.theme;

        // ANSI colors (0-15)
        if (index < 16) {
            const colorMap = [
                theme.black, theme.red, theme.green, theme.yellow,
                theme.blue, theme.magenta, theme.cyan, theme.white,
                theme.brightBlack, theme.brightRed, theme.brightGreen,
                theme.brightYellow, theme.brightBlue, theme.brightMagenta,
                theme.brightCyan, theme.brightWhite
            ];
            return colorMap[index] || "#FFFFFF";
        }

        // Extended colors (16-255) - convert to RGB
        return paletteIndexToRGB(index);
    } else if (mode === 2) {
        // RGB - extract from color value
        const color = cell.getFgColor();
        const r = (color >> 16) & 0xFF;
        const g = (color >> 8) & 0xFF;
        const b = color & 0xFF;
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    return "#FFFFFF";
}
```

### 2. Performance Considerations

**Debouncing**:
- Theme changes: 200ms debounce (via setTimeout in TermThemeUpdater)
- Prompt updates: 100ms debounce (via setTimeout in OSC handler)
- Resize: Skip (too frequent, minimal value)

**Optimization**:
- Only analyze first 3 lines (covers 99% of prompts)
- Only analyze when terminal is visible and focused
- Skip analysis in vdom mode or cmd controller
- Cache last analysis result, skip if theme unchanged

**Memory**:
- No persistent storage of analysis results
- Atom holds single analysis object (~200 bytes)
- No event listener leaks (cleanup in TermViewModel.dispose)

### 3. Error Handling

```typescript
analyzePromptContrast() {
    try {
        if (!this.termRef.current?.terminal) {
            console.warn("Prompt contrast: terminal not ready");
            return;
        }

        const bgColor = globalStore.get(this.termBgColor);
        if (!bgColor || bgColor === "transparent") {
            // Can't analyze without solid background
            return;
        }

        const analysis = PromptContrastAnalyzer.analyze(
            this.termRef.current.terminal,
            bgColor
        );

        globalStore.set(this.promptContrastStatusAtom, analysis);
    } catch (error) {
        console.error("Prompt contrast analysis failed:", error);
        // Fail silently - this is a nice-to-have feature
        globalStore.set(this.promptContrastStatusAtom, null);
    }
}
```

### 4. Testing Strategy

**Unit Tests** (`prompt-contrast.test.ts`):
- Color extraction from mock buffer lines
- Contrast calculation accuracy
- Edge cases (default colors, invalid colors)
- WCAG threshold validation

**Integration Tests**:
- Manual testing with different prompts:
  - bash PS1 with ANSI colors
  - starship prompt
  - oh-my-zsh themes
  - powerlevel10k
- Test with different terminal themes:
  - default-dark
  - light-default
  - solarized-dark
  - solarized-light

**Accessibility Testing**:
- Screen reader announces warning
- Tooltip content is descriptive
- Icon has proper aria-label

---

## Security Considerations

1. **No user input parsing**: Only analyzes terminal buffer content
2. **No external data**: All data from xterm.js and theme config
3. **No network calls**: Pure client-side calculation
4. **No sensitive data**: Color values are not sensitive
5. **No injection risk**: No dynamic code execution

---

## User Experience

### Success Indicators
- Warning appears within 500ms of poor contrast condition
- Warning disappears when contrast improves
- Tooltip provides actionable guidance
- No performance impact on terminal rendering

### User Workflow
1. User opens terminal with default dark theme
2. User's shell prompt uses yellow text (configured in .bashrc)
3. Warning icon appears in terminal header
4. User hovers over icon, sees: "Poor prompt contrast: #FFFF00 (2.1:1). Consider changing terminal theme or prompt colors."
5. User clicks terminal settings → changes theme to light theme
6. Warning disappears (yellow on light bg has good contrast)

---

## Future Enhancements

### Post-MVP Improvements

1. **Automatic Suggestions**:
   - Suggest specific themes with good contrast
   - Suggest prompt color adjustments
   - "Fix it for me" button to auto-adjust theme

2. **User Preferences**:
   - Setting to disable contrast warnings
   - Setting to adjust contrast threshold
   - Setting to show warnings for "warning" level (3:1-4.5:1)

3. **Advanced Analysis**:
   - Analyze entire visible buffer, not just prompt
   - Warn about background colors (not just foreground)
   - Detect color blindness issues (deuteranopia, etc.)

4. **Documentation**:
   - Help docs on configuring prompt colors
   - Guide on choosing terminal themes
   - Examples of good prompt configurations

---

## Implementation Checklist

### Phase 1: Core Analysis Engine
- [ ] Create `prompt-contrast.ts` file
- [ ] Implement `PromptContrastAnalysis` interface
- [ ] Implement `PromptContrastAnalyzer` class
- [ ] Implement `extractColorsFromLine()` method
- [ ] Implement `attrToColor()` method
- [ ] Implement `analyze()` method
- [ ] Add palette index to RGB conversion
- [ ] Write unit tests for color extraction
- [ ] Write unit tests for contrast calculation

### Phase 2: ViewModel Integration
- [ ] Add `promptContrastStatus` atom to TermViewModel
- [ ] Add `promptContrastStatusAtom` primitive atom
- [ ] Implement `analyzePromptContrast()` method
- [ ] Implement `getPromptContrastWarningButton()` method
- [ ] Update `endIconButtons` atom
- [ ] Test warning button appears/disappears
- [ ] Verify tooltip content

### Phase 3: Terminal Integration
- [ ] Add `onPromptUpdate` callback to TermWrap
- [ ] Register OSC 133 handler in TermWrap
- [ ] Wire callback in TerminalView
- [ ] Add theme change trigger in TermThemeUpdater
- [ ] Add initial analysis on terminal load
- [ ] Test all trigger conditions

### Phase 4: Polish & Edge Cases
- [ ] Add debouncing for theme changes
- [ ] Skip analysis in alt screen mode
- [ ] Skip analysis in vdom/cmd mode
- [ ] Add CSS styling for warning icon
- [ ] Improve tooltip formatting
- [ ] Add accessibility attributes
- [ ] Test with real prompts (bash, starship, etc.)
- [ ] Performance testing
- [ ] Documentation

---

## File Manifest

### New Files
1. `frontend/app/view/term/prompt-contrast.ts` - Core analyzer utility
2. `frontend/app/view/term/prompt-contrast.test.ts` - Unit tests

### Modified Files
1. `frontend/app/view/term/term-model.ts` - ViewModel integration
2. `frontend/app/view/term/term.tsx` - Terminal view integration
3. `frontend/app/view/term/termwrap.ts` - OSC handler, callback
4. `frontend/app/view/term/termtheme.ts` - Theme change trigger

### CSS Changes
- Add `.text-warning` class usage (already exists in project)
- No new CSS required (uses existing icon button styles)

---

## Dependencies

### Existing (No Changes Required)
- `colord@^2.9.3` - Color manipulation and contrast calculation
- `@xterm/xterm@^6.1.0-beta.106` - Terminal buffer access
- `jotai@2.9.3` - Reactive state management

### No New Dependencies Required

---

## Estimated Effort

- Phase 1 (Core Engine): 4-6 hours
- Phase 2 (ViewModel): 3-4 hours
- Phase 3 (Integration): 3-4 hours
- Phase 4 (Polish): 2-3 hours
- **Total**: 12-17 hours

---

## References

### Code References
- `frontend/app/view/term/term-model.ts:345-389` - Shell integration status pattern
- `frontend/app/view/waveconfig/provider-status-badge.tsx` - Tooltip warning pattern
- `frontend/app/view/term/termutil.ts:13-16` - colord usage example
- `frontend/app/view/term/termwrap.ts:505-600` - TermWrap structure

### External References
- [WCAG 2.1 Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [xterm.js API Documentation](https://xtermjs.org/docs/)
- [colord Documentation](https://github.com/omgovich/colord)
- [OSC 133 Shell Integration](https://gitlab.freedesktop.org/Per_Bothner/specifications/-/blob/master/proposals/semantic-prompts.md)

---

## Appendix A: ANSI Color Reference

### Standard ANSI Colors (0-15)
```
0  = Black       8  = Bright Black (Gray)
1  = Red         9  = Bright Red
2  = Green       10 = Bright Green
3  = Yellow      11 = Bright Yellow
4  = Blue        12 = Bright Blue
5  = Magenta     13 = Bright Magenta
6  = Cyan        14 = Bright Cyan
7  = White       15 = Bright White
```

### Extended Colors (16-255)
- 16-231: 6x6x6 RGB cube
- 232-255: Grayscale ramp

### Contrast Ratio Examples
- Black on White: 21:1 (maximum)
- Blue (#0000FF) on White: 8.6:1 (good)
- Yellow (#FFFF00) on White: 1.07:1 (poor)
- Yellow (#FFFF00) on Black: 19.6:1 (good)
- Gray (#808080) on White: 3.9:1 (marginal)

---

**End of Specification**
