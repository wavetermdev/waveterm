# Spec 002: Wave Terminal Branding for OMP Configurator

**Date:** 2026-01-25
**Status:** Draft
**Dependencies:** Spec 001 (Configurator Embed)

---

## 1. Objective

Restyle the OMP Configurator UI to seamlessly match Wave Terminal's design language, creating a native feel rather than an embedded third-party component.

## 2. Design Principles

### 2.1 Wave Terminal Visual Identity

| Aspect | Specification |
|--------|---------------|
| **Primary Background** | `--main-bg-color` (#222222 dark, #fafafa light) |
| **Panel Background** | `--panel-bg-color` (semi-transparent) |
| **Accent Color** | `--accent-color` (green: #58c142 dark, #2ea043 light) |
| **Text Primary** | `--main-text-color` (#f7f7f7 dark, #1a1a1a light) |
| **Text Secondary** | `--secondary-text-color` (rgb(195,200,194) dark) |
| **Border Color** | `--border-color` (rgba(255,255,255,0.16) dark) |
| **Border Radius** | 8px for cards, 6px for modals, 4px for small elements |
| **Font** | "Inter" sans-serif, 14px base |
| **Icons** | FontAwesome 6 (Solid and Regular) |

### 2.2 Contrast with ohmyposh-configurator

| ohmyposh-configurator | Wave Terminal | Change Required |
|-----------------------|---------------|-----------------|
| `bg-[#0f0f23]` | `--main-bg-color` | Yes |
| `bg-[#1a1a2e]` | `--panel-bg-color` | Yes |
| Blue/purple accents | Green accents | Yes |
| Tailwind CSS | SCSS + CSS variables | Yes |
| Fixed dark theme | Light/dark/gray/warm themes | Yes |
| Rounded-2xl (16px) | 8px border-radius | Yes |
| Shadcn-like components | Wave's custom components | Yes |

## 3. Component Styling

### 3.1 OmpConfigurator Container

```scss
// frontend/app/element/settings/omp-configurator/omp-configurator.scss

.omp-configurator {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    padding: 8px 0;

    &.loading,
    &.error {
        min-height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
}

.omp-configurator-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;

    .header-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
        color: var(--main-text-color);

        i {
            color: var(--accent-color);
        }
    }

    .header-actions {
        display: flex;
        gap: 8px;
    }
}
```

### 3.2 Config Preview Panel

```scss
.omp-config-preview {
    background: var(--block-bg-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px;
    min-height: 80px;

    &.dark-bg {
        background: #1a1a1a;
    }

    &.light-bg {
        background: #fafafa;
    }

    &.split-bg {
        background: linear-gradient(to right, #1a1a1a 50%, #fafafa 50%);
    }
}

.omp-preview-prompt {
    font-family: var(--fixed-font);
    font-size: 14px;
    line-height: 1.5;
    display: flex;
    flex-wrap: wrap;
    gap: 0;

    .segment {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;

        &.powerline {
            // Powerline styling
        }

        &.diamond {
            // Diamond styling
        }
    }
}
```

### 3.3 Block Editor

```scss
.omp-block-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.omp-block-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.omp-block-item {
    background: var(--form-element-bg-color);
    border: 1px solid var(--form-element-border-color);
    border-radius: 6px;
    padding: 12px;
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:hover {
        border-color: var(--form-element-primary-color);
    }

    &.selected {
        border-color: var(--accent-color);
        box-shadow: 0 0 0 2px rgba(88, 193, 66, 0.2);
    }

    .block-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;

        .block-type {
            font-weight: 500;
            font-size: 13px;
            color: var(--main-text-color);
            text-transform: capitalize;
        }

        .block-alignment {
            font-size: 12px;
            color: var(--secondary-text-color);
        }
    }

    .block-segments {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
}
```

### 3.4 Segment Badge

```scss
.omp-segment-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    background: var(--highlight-bg-color);
    color: var(--main-text-color);
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
        background: var(--hover-bg-color);
    }

    &.selected {
        background: var(--accent-color);
        color: white;
    }

    .segment-icon {
        font-size: 10px;
    }

    .segment-color {
        width: 12px;
        height: 12px;
        border-radius: 2px;
        border: 1px solid rgba(255, 255, 255, 0.2);
    }
}
```

### 3.5 Segment Properties Panel

```scss
.omp-segment-properties {
    background: var(--panel-bg-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px;

    .properties-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border-color);

        .segment-title {
            font-weight: 600;
            font-size: 14px;
            color: var(--main-text-color);
        }

        .segment-type {
            font-size: 12px;
            color: var(--secondary-text-color);
            background: var(--highlight-bg-color);
            padding: 2px 8px;
            border-radius: 4px;
        }
    }
}

.property-group {
    margin-bottom: 16px;

    .group-title {
        font-weight: 500;
        font-size: 12px;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
    }
}

.property-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;

    .property-label {
        flex: 0 0 120px;
        font-size: 13px;
        color: var(--main-text-color);
    }

    .property-value {
        flex: 1;
    }
}
```

### 3.6 Action Buttons

```scss
.omp-action-buttons {
    display: flex;
    gap: 8px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);

    .btn-primary {
        background: var(--accent-color);
        color: var(--button-text-color);
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 500;
        font-size: 13px;
        cursor: pointer;
        transition: opacity 0.15s ease;

        &:hover {
            opacity: 0.9;
        }

        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }

    .btn-secondary {
        background: var(--button-grey-bg);
        color: var(--main-text-color);
        border: 1px solid var(--button-grey-border-color);
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 500;
        font-size: 13px;
        cursor: pointer;
        transition: background-color 0.15s ease;

        &:hover {
            background: var(--button-grey-hover-bg);
        }

        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }
}
```

### 3.7 Advanced Options Section

```scss
.omp-advanced-section {
    margin-top: 16px;

    .advanced-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        cursor: pointer;
        color: var(--secondary-text-color);
        font-size: 13px;

        &:hover {
            color: var(--main-text-color);
        }

        i {
            font-size: 10px;
            transition: transform 0.15s ease;
        }

        &.expanded i {
            transform: rotate(90deg);
        }
    }

    .advanced-content {
        display: none;
        padding: 12px 0;
        border-top: 1px solid var(--border-color);

        &.visible {
            display: block;
        }
    }

    .advanced-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .advanced-action {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--form-element-bg-color);
        border: 1px solid var(--form-element-border-color);
        border-radius: 6px;
        cursor: pointer;
        transition: border-color 0.15s ease;

        &:hover {
            border-color: var(--form-element-primary-color);
        }

        i {
            width: 20px;
            text-align: center;
            color: var(--secondary-text-color);
        }

        .action-label {
            font-size: 13px;
            color: var(--main-text-color);
        }

        .action-description {
            font-size: 12px;
            color: var(--secondary-text-color);
        }
    }
}
```

### 3.8 Loading and Error States

```scss
.omp-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 20px;
    color: var(--secondary-text-color);

    i {
        font-size: 24px;
        color: var(--accent-color);
    }

    span {
        font-size: 13px;
    }
}

.omp-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 20px;
    text-align: center;

    i {
        font-size: 32px;
        color: var(--error-color);
    }

    .error-title {
        font-weight: 600;
        font-size: 14px;
        color: var(--main-text-color);
    }

    .error-message {
        font-size: 13px;
        color: var(--secondary-text-color);
        max-width: 400px;
    }

    .error-action {
        margin-top: 8px;
    }
}

.omp-no-config {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 40px 20px;
    text-align: center;

    i {
        font-size: 48px;
        color: var(--secondary-text-color);
    }

    .no-config-title {
        font-weight: 600;
        font-size: 16px;
        color: var(--main-text-color);
    }

    .no-config-message {
        font-size: 13px;
        color: var(--secondary-text-color);
        max-width: 400px;
    }

    .no-config-actions {
        display: flex;
        gap: 12px;
        margin-top: 8px;
    }
}
```

## 4. Icon Mapping

| Purpose | FontAwesome Icon | Class |
|---------|-----------------|-------|
| Configurator | wand-magic-sparkles | `fa-solid fa-wand-magic-sparkles` |
| Block (prompt) | terminal | `fa-solid fa-terminal` |
| Block (rprompt) | align-right | `fa-solid fa-align-right` |
| Segment | puzzle-piece | `fa-solid fa-puzzle-piece` |
| Save | check | `fa-solid fa-check` |
| Cancel | times | `fa-solid fa-times` |
| Edit | pen | `fa-solid fa-pen` |
| Delete | trash | `fa-solid fa-trash` |
| Move Up | chevron-up | `fa-solid fa-chevron-up` |
| Move Down | chevron-down | `fa-solid fa-chevron-down` |
| Add | plus | `fa-solid fa-plus` |
| Import | file-import | `fa-solid fa-file-import` |
| Export | file-export | `fa-solid fa-file-export` |
| Copy | copy | `fa-solid fa-copy` |
| Share | share-nodes | `fa-solid fa-share-nodes` |
| Settings | cog | `fa-solid fa-cog` |
| Warning | exclamation-triangle | `fa-solid fa-exclamation-triangle` |
| Info | info-circle | `fa-solid fa-info-circle` |
| Error | circle-exclamation | `fa-solid fa-circle-exclamation` |
| Loading | spinner fa-spin | `fa-solid fa-spinner fa-spin` |
| Expand | chevron-right | `fa-solid fa-chevron-right` |
| Color | palette | `fa-solid fa-palette` |

## 5. Responsive Behavior

### 5.1 Breakpoints

```scss
// Mobile-first responsive design

.omp-configurator {
    // Default: single column layout

    @media (min-width: 768px) {
        // Block editor and properties side by side
        .omp-main-content {
            display: grid;
            grid-template-columns: 1fr 320px;
            gap: 16px;
        }
    }

    @media (min-width: 1024px) {
        // Wider properties panel
        .omp-main-content {
            grid-template-columns: 1fr 400px;
        }
    }
}
```

### 5.2 Mobile Layout

On narrow screens (<768px):
1. Stack block editor and properties vertically
2. Collapse segment badges to icons only
3. Full-width buttons in action bar
4. Simplified preview (text-only mode)

## 6. Animation and Transitions

```scss
// Consistent transition timing
$transition-fast: 0.15s ease;
$transition-normal: 0.2s ease;

// Hover effects
.interactive-element {
    transition:
        border-color $transition-fast,
        background-color $transition-fast,
        box-shadow $transition-fast;
}

// Expand/collapse
.collapsible {
    overflow: hidden;
    transition: max-height $transition-normal;
}

// Selection animation
.selectable {
    &.selected {
        animation: pulse 0.3s ease;
    }
}

@keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.02); }
    100% { transform: scale(1); }
}
```

## 7. Accessibility

### 7.1 Keyboard Navigation

- Tab through blocks and segments
- Enter/Space to select
- Escape to cancel/close dialogs
- Arrow keys for navigation within lists

### 7.2 Screen Reader Support

```tsx
// Example ARIA implementation
<div
    className={cn("omp-segment-badge", { selected })}
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    aria-label={`${segment.type} segment${selected ? " (selected)" : ""}`}
    onClick={handleClick}
    onKeyDown={handleKeyDown}
>
```

### 7.3 Focus Indicators

```scss
.omp-segment-badge:focus-visible,
.omp-block-item:focus-visible,
.btn-primary:focus-visible,
.btn-secondary:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
}
```

## 8. Theme Support

All styling must work across Wave's four themes:
- Dark (default)
- Light
- Light Gray
- Light Warm

Use CSS variables exclusively for colors. Test each theme during development.

## 9. Build Checklist

- [ ] Create `omp-configurator.scss` with all component styles
- [ ] Import SCSS in main app.scss or component
- [ ] Test in all four Wave themes
- [ ] Test responsive behavior at 320px, 768px, 1024px widths
- [ ] Verify keyboard navigation works
- [ ] Test with screen reader (VoiceOver/NVDA)
- [ ] Ensure animations respect `prefers-reduced-motion`
- [ ] Compare visually with existing OmpThemeControl for consistency
