# Spec 012: Theme Preview with Background Toggle

## Overview
Add a toggle to theme selectors (OMP and Terminal) that allows users to preview how themes look on both light and dark backgrounds.

## Problem Statement
Many terminal themes and OMP prompts look good on dark backgrounds but become unreadable on light backgrounds (and vice versa). Users need to see how their theme choice will look in both contexts before committing.

## User Story
As a user who switches between light and dark modes, I want to preview how a theme looks on both backgrounds so I can choose themes that work well in all conditions.

## Proposed Solution

### UI Design

#### Toggle Component
```
┌─────────────────────────────────────────────┐
│ Preview Background:                          │
│   [🌙 Dark] [☀️ Light] [◐ Split]            │
└─────────────────────────────────────────────┘
```

- **Dark**: Preview all themes on dark background (#1a1a1a)
- **Light**: Preview all themes on light background (#fafafa)
- **Split**: Show each theme card split 50/50 (left dark, right light)

#### Theme Card with Split View
```
┌────────────────────┐
│ ▌Dark │ Light▐    │
│ ▌████ │ ████ ▐    │  <- Color swatches
│ ▌████ │ ████ ▐    │
│    Theme Name      │
└────────────────────┘
```

### Implementation

#### 1. New PreviewBackgroundToggle Component
```typescript
// frontend/app/element/settings/preview-background-toggle.tsx

type PreviewBackground = "dark" | "light" | "split";

interface PreviewBackgroundToggleProps {
    value: PreviewBackground;
    onChange: (value: PreviewBackground) => void;
}

export const PreviewBackgroundToggle = memo(({ value, onChange }: PreviewBackgroundToggleProps) => {
    return (
        <div className="preview-bg-toggle">
            <span className="toggle-label">Preview Background:</span>
            <div className="toggle-buttons" role="radiogroup">
                <button
                    className={cn("toggle-btn", { active: value === "dark" })}
                    onClick={() => onChange("dark")}
                    aria-pressed={value === "dark"}
                >
                    <i className="fa fa-moon" />
                    <span>Dark</span>
                </button>
                <button
                    className={cn("toggle-btn", { active: value === "light" })}
                    onClick={() => onChange("light")}
                    aria-pressed={value === "light"}
                >
                    <i className="fa fa-sun" />
                    <span>Light</span>
                </button>
                <button
                    className={cn("toggle-btn", { active: value === "split" })}
                    onClick={() => onChange("split")}
                    aria-pressed={value === "split"}
                >
                    <i className="fa fa-circle-half-stroke" />
                    <span>Split</span>
                </button>
            </div>
        </div>
    );
});
```

#### 2. Modify TermThemeControl Props
```typescript
// frontend/app/element/settings/termtheme-control.tsx

interface TermThemeControlProps {
    value: string;
    onChange: (value: string) => void;
    previewBackground?: PreviewBackground; // NEW
}

// In ThemePreview component
const ThemePreview = memo(({ theme, previewBackground }: { theme: ThemeInfo; previewBackground?: PreviewBackground }) => {
    const bgColor = previewBackground === "light"
        ? "#fafafa"
        : previewBackground === "dark"
            ? "#1a1a1a"
            : theme.colors.background;

    if (previewBackground === "split") {
        return (
            <div className="termtheme-preview split">
                <div className="preview-half dark" style={{ backgroundColor: "#1a1a1a" }}>
                    {/* Color swatches */}
                </div>
                <div className="preview-half light" style={{ backgroundColor: "#fafafa" }}>
                    {/* Same swatches */}
                </div>
            </div>
        );
    }

    return (
        <div className="termtheme-preview" style={{ backgroundColor: bgColor }}>
            {/* Existing color swatches */}
        </div>
    );
});
```

#### 3. Apply to OmpThemeControl
Same pattern applies to `omptheme-control.tsx`.

#### 4. Integration in Appearance Panel
```typescript
// frontend/app/view/waveconfig/appearance-content.tsx

const AppearanceContent = () => {
    const [previewBg, setPreviewBg] = useState<PreviewBackground>("dark");

    return (
        <div className="appearance-content">
            {/* ... other sections ... */}

            <CollapsibleSection title="Terminal Color Scheme">
                <PreviewBackgroundToggle value={previewBg} onChange={setPreviewBg} />
                <TermThemeControl
                    value={termTheme}
                    onChange={handleTermThemeChange}
                    previewBackground={previewBg}
                />
            </CollapsibleSection>

            <CollapsibleSection title="Oh-My-Posh Theme">
                <PreviewBackgroundToggle value={previewBg} onChange={setPreviewBg} />
                <OmpThemeControl
                    value={ompTheme}
                    onChange={handleOmpThemeChange}
                    previewBackground={previewBg}
                />
            </CollapsibleSection>
        </div>
    );
};
```

## Acceptance Criteria
- [ ] Preview toggle appears above theme grids
- [ ] Dark mode shows all themes on dark background
- [ ] Light mode shows all themes on light background
- [ ] Split mode shows each theme on both backgrounds side-by-side
- [ ] Toggle state persists within session (not saved to config)
- [ ] Keyboard accessible (arrow keys to switch modes)
- [ ] ARIA labels for screen readers

## SCSS Styling
```scss
.preview-bg-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    margin-bottom: 12px;

    .toggle-label {
        font-size: 13px;
        color: var(--secondary-text-color);
    }

    .toggle-buttons {
        display: flex;
        gap: 4px;
        background: var(--form-element-bg-color);
        padding: 4px;
        border-radius: 6px;
    }

    .toggle-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        transition: all 0.15s ease;

        &:hover {
            background: var(--hover-bg-color);
        }

        &.active {
            background: var(--accent-color);
            color: white;
        }

        i {
            font-size: 12px;
        }
    }
}

.termtheme-preview.split {
    display: flex;
    overflow: hidden;
    border-radius: 4px;

    .preview-half {
        flex: 1;
        padding: 6px;
    }
}
```

## Edge Cases
- Very light themes may be invisible on light preview - add subtle border
- Very dark themes may be invisible on dark preview - add subtle border
- Mobile/narrow screens: Stack split view vertically
