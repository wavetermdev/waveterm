# LESSON-0003: VS Code-Style Settings UI Patterns

**Date:** 2026-01-25
**Category:** UI/UX Design
**Severity:** INFORMATIONAL
**Applies To:** Settings panels, scrollable lists with sticky headers

---

## Context

When building a visual settings interface similar to VS Code's settings panel, several UI/UX patterns are essential for a polished experience.

## Key Patterns Implemented

### 1. Sticky Section Headers

**Problem:** Section headers should stick to the top when scrolling, but CSS `position: sticky` requires careful handling.

**Solution:**
- Use `position: sticky; top: 0` on headers
- **CRITICAL:** Do NOT use `overflow: hidden` on parent sections - this breaks sticky positioning
- Apply `border-radius` to individual children instead of using `overflow: hidden` on the container

```scss
.settings-category-section {
    border-radius: 8px;
    // DON'T: overflow: hidden; // This breaks sticky!

    .settings-category-header {
        position: sticky;
        top: 0;
        border-radius: 8px 8px 0 0; // Apply radius here instead
    }

    .setting-row:last-child {
        border-radius: 0 0 8px 8px;
    }
}
```

### 2. Opaque Backgrounds with Theme Colors

**Problem:** Using CSS variables directly may result in transparent backgrounds, causing content to show through sticky headers.

**Solution:** Layer theme colors over a solid base:

```scss
// Opaque background using layered colors
background-color: var(--main-bg-color);
background: linear-gradient(var(--highlight-bg-color), var(--highlight-bg-color)), var(--main-bg-color);
```

### 3. Visual Feedback for Stuck Headers

**Problem:** Users need visual feedback when a header is stuck at the top.

**Solution:** Use JavaScript to detect stuck state and add shadow:

```typescript
// Detect when header is stuck
const isStuck = sectionRect.top <= containerRect.top + 1 &&
                sectionRect.bottom > containerRect.top + headerRect.height;

if (isStuck) {
    header.classList.add("is-stuck");
}
```

```scss
.settings-category-header.is-stuck {
    border-radius: 0; // Square corners when stuck
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
}
```

### 4. Scroll-Spy for Sidebar Sync

**Problem:** Sidebar category selection should update as user scrolls through content.

**Solution:** Use IntersectionObserver to detect visible sections:

```typescript
const observer = new IntersectionObserver(
    (entries) => {
        // Find topmost visible category and update sidebar
    },
    {
        root: container,
        rootMargin: "-10% 0px -80% 0px", // Trigger near top
        threshold: 0,
    }
);
```

### 5. Dynamic Bottom Padding for Last Section

**Problem:** Users should be able to scroll the last section's header to the top, but content may not be tall enough.

**Solution:** Calculate padding dynamically:

```typescript
const paddingNeeded = Math.max(0, containerHeight - lastSectionHeight);
container.style.paddingBottom = `${paddingNeeded}px`;
```

### 6. Distinct Input Fields

**Problem:** Form inputs should stand out from the background, similar to VS Code.

**Solution:** Layer a dark overlay on the form background:

```scss
$setting-input-bg: rgb(0 0 0 / 0.2);

.setting-text-input {
    background: linear-gradient($setting-input-bg, $setting-input-bg),
                var(--form-element-bg-color);

    &:hover {
        border-color: var(--form-element-primary-color);
    }
}
```

## Common Pitfalls

1. **`overflow: hidden` breaks sticky** - Never use it on containers with sticky children
2. **Transparent backgrounds** - Always ensure headers are fully opaque
3. **Static padding** - Calculate dynamically based on content and container size
4. **Missing hover states** - Add explicit hover effects to both rows and inputs
5. **Scroll containers** - Ensure proper `min-height: 0` for nested flexbox scrolling

## Files Affected

- `frontend/app/view/waveconfig/settings-visual.tsx` - Main component with scroll logic
- `frontend/app/view/waveconfig/settings-visual.scss` - Visual styles
- `frontend/app/element/settings/settings-controls.scss` - Input control styles

## References

- VS Code Settings UI for design inspiration
- CSS `position: sticky` specification
- IntersectionObserver API for scroll-spy

---

## Checklist for Similar Features

- [ ] Use `position: sticky` without `overflow: hidden` on parent
- [ ] Ensure backgrounds are fully opaque (layer over solid color)
- [ ] Add visual feedback for stuck state (shadow, square corners)
- [ ] Implement scroll-spy for sidebar sync
- [ ] Calculate dynamic padding for last-item scrollability
- [ ] Add hover effects on interactive elements
- [ ] Test scrolling behavior at various container sizes
