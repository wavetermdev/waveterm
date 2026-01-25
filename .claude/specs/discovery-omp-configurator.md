# Discovery Report: OMP Theme Configurator Integration

**Date:** 2026-01-25
**Status:** Discovery Complete
**Project:** OMP Theme Configurator for Wave Terminal

---

## Executive Summary

This document analyzes the feasibility of integrating the [ohmyposh-configurator](https://github.com/jamesmontemagno/ohmyposh-configurator) into Wave Terminal's Appearance Panel. The analysis covers the source project architecture, Wave Terminal's existing OMP infrastructure, and the integration approach.

**Key Finding:** Direct integration is feasible but requires substantial adaptation. The ohmyposh-configurator is a standalone React 19 + Vite application with different styling (Tailwind CSS) and state management (Zustand) than Wave Terminal (React 18 + Electron, SCSS, Jotai). A pragmatic approach is to **extract the core configuration logic** and **rebuild the UI using Wave Terminal's design system**.

---

## 1. ohmyposh-configurator Analysis

### 1.1 Technology Stack

| Component | Technology | Wave Terminal Uses |
|-----------|------------|-------------------|
| Framework | React 19.2.0 | React 18.x |
| Build Tool | Vite 6.4 | Vite (Electron) |
| Styling | Tailwind CSS 4.1 | SCSS + CSS Variables |
| State | Zustand 5.0.5 | Jotai |
| Storage | idb-keyval (IndexedDB) | Wave's settings service |
| DnD | @dnd-kit | Not currently used |

### 1.2 Component Architecture

The configurator uses a **three-panel layout**:

```
┌────────────────────────────────────────────────────────────────────┐
│                           Header                                   │
├──────────────┬─────────────────────────────────┬──────────────────┤
│              │                                 │                  │
│  Segment     │         Canvas                  │   Properties     │
│  Picker      │    (drag-drop editing)          │   Panel          │
│  (left)      │                                 │   (right)        │
│              ├─────────────────────────────────┤                  │
│              │       PreviewPanel              │                  │
│              │   (light/dark preview)          │                  │
│              │                                 │                  │
├──────────────┴─────────────────────────────────┴──────────────────┤
│                        ExportBar                                   │
└────────────────────────────────────────────────────────────────────┘
```

**Key Components (18 directories + 1 file):**

| Component | Purpose | Size | Priority for Integration |
|-----------|---------|------|-------------------------|
| `PreviewPanel/` | Live preview with light/dark toggle | 5 files | **High** |
| `Canvas/` | Drag-drop prompt builder | - | Medium |
| `PropertiesPanel/` | Edit segment/block properties | 17 files | **High** |
| `SegmentPicker/` | Browse and select segments | - | Medium |
| `ExportBar/` | Export to JSON/YAML/TOML | - | Low (collapse) |
| `ImportDialog/` | Import configuration | - | Low (collapse) |
| `ShareDialog/` | Share configuration | - | Low (collapse) |
| `Header/` | App header | - | Rebrand to Wave |

### 1.3 State Management (Zustand Stores)

| Store | Purpose | Lines | Key State |
|-------|---------|-------|-----------|
| `configStore.ts` | Main configuration state | 16,988 | blocks, segments, palette, settings |
| `savedConfigsStore.ts` | Persistence | 14,028 | saved configs, auto-save |
| `advancedFeaturesStore.ts` | Advanced features | 10,395 | tooltips, extra prompts |
| `toastStore.ts` | UI notifications | 764 | toast messages |

**Key configStore actions:**
- `setBlocks()` - Set prompt blocks
- `addSegment()` / `removeSegment()` - Manage segments
- `updateSegmentProperty()` - Edit segment properties
- `setPalette()` - Set color palette
- `importConfig()` / `exportConfig()` - Import/export

### 1.4 Light/Dark Preview Implementation

Location: `src/components/PreviewPanel/PreviewPanel.tsx`

The PreviewPanel uses:
- Toggle between dark (`#0f0f23`) and light (`#fafafa`) backgrounds
- Tailwind CSS for theme switching
- Renders segments with actual OMP styling (powerline, diamond, etc.)
- Uses `templateUtils.tsx` (19KB) for template rendering

**Key insight:** The preview rendering logic is complex and handles:
- Powerline symbols (with proper glyphs)
- Diamond segment styles
- Template variable resolution
- Color palette resolution

### 1.5 Utility Functions

| Utility | Purpose | Size |
|---------|---------|------|
| `configExporter.ts` | Export to JSON/YAML/TOML | 6,869 |
| `configImporter.ts` | Import with feature detection | 6,520 |
| `configLoader.ts` | Load configurations | 4,166 |
| `officialThemeLoader.ts` | Load official OMP themes | 4,652 |
| `paletteResolver.ts` | Resolve palette colors | 11,619 |
| `segmentLoader.ts` | Dynamic segment loading | 4,713 |

### 1.6 Data Files

Segment definitions in `public/segments/`:
- `system.json` (14 segments)
- `languages.json` (26 segments)
- `cloud.json` (12 segments)
- `cli.json` (30 segments)

Sample configs in `public/configs/samples/`

---

## 2. Wave Terminal's Existing OMP Infrastructure

### 2.1 Current OMP Features

Wave Terminal already has significant OMP infrastructure:

| Feature | Implementation | Status |
|---------|---------------|--------|
| Theme Selection | `OmpThemeControl` component | Complete |
| Theme Preview | Color swatch grid with light/dark toggle | Complete |
| High Contrast Mode | Automatic background injection | Complete |
| Palette Export | Export terminal colors to OMP palette | Complete |
| Config Detection | `OmpGetConfigInfo` RPC | Complete |
| Config Backup/Restore | `OmpBackup/Restore` RPCs | Complete |
| Live Reload | `OmpReinit` in all terminals | Complete |

### 2.2 Existing RPC Commands

```go
// pkg/wshrpc/wshrpctypes.go

// Existing OMP Commands
OmpGetConfigInfoCommand(ctx)                                // Get config path, format, exists
OmpWritePaletteCommand(ctx, data CommandOmpWritePaletteData)  // Write palette to config
OmpAnalyzeCommand(ctx, data CommandOmpAnalyzeData)            // Detect transparent segments
OmpApplyHighContrastCommand(ctx, data)                        // Apply high contrast backgrounds
OmpRestoreBackupCommand(ctx, data)                            // Restore from backup
```

### 2.3 Frontend Components

| Component | File | Purpose |
|-----------|------|---------|
| `OmpThemeControl` | `omptheme-control.tsx` | Visual theme grid selector |
| `OmpHighContrast` | `omp-high-contrast.tsx` | Transparent segment warning/fix |
| `OmpPaletteExport` | `omp-palette-export.tsx` | Export terminal colors |
| `PreviewBackgroundToggle` | `preview-background-toggle.tsx` | Dark/Light/Split toggle |

### 2.4 Backend Utilities

```go
// pkg/wshutil/omputil.go

// Config parsing
ParseOmpConfig(content []byte) (*OmpConfig, error)
SerializeOmpConfig(config *OmpConfig) ([]byte, error)

// Path handling
GetOmpConfigPath() (string, error)        // Find $POSH_THEME or defaults
ValidateOmpConfigPath(path string) error   // Security validation

// Modification
MergePaletteIntoConfig(path, palette) ([]byte, error)
ApplyHighContrastMode(config) *OmpConfig

// Backup
CreateOmpBackup(path) (string, error)
RestoreOmpBackup(path) error
```

### 2.5 Wave Terminal Design System

**CSS Variables (from theme.scss):**
```scss
:root {
    --main-text-color: #f7f7f7;
    --main-bg-color: rgb(34, 34, 34);
    --accent-color: rgb(88, 193, 66);
    --border-color: rgba(255, 255, 255, 0.16);
    --form-element-border-color: rgba(241, 246, 243, 0.15);
    --form-element-bg-color: var(--main-bg-color);
    --modal-bg-color: #232323;
    // ... light/dark/light-gray/light-warm theme variants
}
```

**Existing UI Patterns:**
- `CollapsibleSection` - For grouping controls
- Theme card grid (from `TermThemeControl`)
- Settings controls with labels and descriptions
- Icon buttons with FontAwesome

---

## 3. Integration Analysis

### 3.1 Integration Approaches

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **A) Embed as iframe** | Minimal code changes | Style isolation issues, communication overhead | Low |
| **B) Copy/adapt source** | Full control, Wave styling | Significant rewrite, maintenance burden | High |
| **C) Extract logic, rebuild UI** | Native Wave feel, reuse existing patterns | Most work upfront, but cleaner | Medium-High |
| **D) NPM package** | Clean separation | Package doesn't exist, would need to create | High |

**Recommended: Approach C - Extract logic, rebuild UI**

Rationale:
1. Wave already has OMP infrastructure to build upon
2. ohmyposh-configurator's Tailwind styling won't match Wave's SCSS
3. Wave's Jotai state management is incompatible with Zustand
4. We can reuse ohmyposh-configurator's segment data and template logic
5. Wave's existing `OmpThemeControl` provides a template for the UI pattern

### 3.2 What to Extract from ohmyposh-configurator

**High Value (port directly):**
1. Segment metadata (`public/segments/*.json`)
2. Template rendering logic (`templateUtils.tsx`)
3. Palette resolution (`paletteResolver.ts`)
4. Config import/export utilities

**Medium Value (adapt concepts):**
1. PropertiesPanel structure (segment editing)
2. Preview rendering approach
3. Block/segment data model

**Low Value (skip or collapse):**
1. Import dialog (secondary action)
2. Share dialog (secondary action)
3. Onboarding tutorial
4. Tailwind styling

### 3.3 New RPC Commands Needed

```go
// New commands for full configurator support

// Read the full OMP config as JSON
OmpReadConfigCommand(ctx) (CommandOmpReadConfigRtnData, error)

// Write the full OMP config (with backup)
OmpWriteConfigCommand(ctx, data CommandOmpWriteConfigData) error

// Validate OMP config syntax
OmpValidateConfigCommand(ctx, data CommandOmpValidateData) (bool, error)
```

### 3.4 UI Component Plan

```
Appearance Panel
└── Oh-My-Posh Integration (CollapsibleSection)
    ├── Theme Selector (existing OmpThemeControl)
    ├── Preview Background Toggle (existing)
    ├── High Contrast Mode (existing OmpHighContrast)
    ├── Palette Export (existing OmpPaletteExport)
    └── Theme Configurator (NEW - collapsed by default)
        ├── Config Preview (rendered prompt)
        ├── Block Editor (edit current config blocks)
        ├── Segment Properties Panel
        ├── [Save] [Cancel] buttons (primary actions)
        └── Advanced Options (collapsed)
            ├── Import from file
            ├── Export/Copy config
            └── Share link
```

---

## 4. Key Technical Challenges

### 4.1 Template Rendering
The ohmyposh-configurator's `templateUtils.tsx` (19KB) contains complex logic for rendering OMP templates with:
- Variable substitution (`{{ .Git.Branch }}`)
- Conditional segments
- Powerline/Diamond glyphs
- Nerd Font icons

**Mitigation:** We don't need full template rendering for editing. We can show a simplified preview using color swatches and segment types, similar to the existing `OmpThemeControl`.

### 4.2 Drag-and-Drop Reordering
ohmyposh-configurator uses `@dnd-kit` for drag-drop segment reordering.

**Mitigation:** For MVP, use simple up/down buttons or a reorderable list without full drag-drop. Can add @dnd-kit later if needed.

### 4.3 State Synchronization
Changes in the configurator need to:
1. Update local state for preview
2. Optionally save to OMP config file
3. Trigger OMP reinit in terminals

**Solution:** Use Wave's existing patterns:
- Jotai atoms for local state
- RPC commands for file operations
- Existing `reinitOmpInAllTerminals()` function

### 4.4 Config Format Support
OMP supports JSON, YAML, and TOML config files.

**Mitigation:** Start with JSON only (most common). Wave's backend already detects format. Add YAML/TOML support later using js-yaml and @iarna/toml (same deps as ohmyposh-configurator).

---

## 5. Implementation Recommendations

### 5.1 Phase 1: Enhanced Theme Selection (MVP)
**Goal:** Load current OMP theme and display editable preview

1. Add `OmpReadConfigCommand` RPC to read full config JSON
2. Create `OmpConfigPreview` component showing current config
3. Add edit mode that loads config into editable state
4. Add Save/Cancel buttons

### 5.2 Phase 2: Segment Editing
**Goal:** Allow editing individual segment properties

1. Port segment metadata from ohmyposh-configurator
2. Create `SegmentPropertiesEditor` component
3. Implement block/segment selection
4. Add `OmpWriteConfigCommand` RPC

### 5.3 Phase 3: Advanced Features
**Goal:** Full configurator functionality

1. Add drag-drop segment reordering
2. Add segment picker (add new segments)
3. Collapse Import/Export/Share into advanced section
4. Add template preview rendering

### 5.4 Branding Changes

**Colors:**
| ohmyposh-configurator | Wave Terminal |
|-----------------------|---------------|
| `#0f0f23` (bg) | `var(--main-bg-color)` |
| `#1a1a2e` (panel) | `var(--panel-bg-color)` |
| Blue accents | `var(--accent-color)` (green) |

**UI Elements:**
- Replace Tailwind classes with Wave SCSS
- Use Wave's `CollapsibleSection` for organization
- Use Wave's button styles
- Use Wave's toggle component
- Use FontAwesome icons (already in Wave)

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Template rendering complexity | Medium | Medium | Use simplified preview for MVP |
| State management conflicts | Low | High | Build on Wave's Jotai patterns |
| Config format incompatibility | Low | Medium | Validate against OMP schema |
| Performance with large configs | Low | Low | Lazy load segment details |
| Breaking user configs | Medium | High | Always create backups, validate before write |

---

## 7. Effort Estimates

| Phase | Scope | Estimated Days |
|-------|-------|----------------|
| Phase 1: MVP | Read config, preview, save/cancel | 3-4 |
| Phase 2: Segment Editing | Properties panel, segment editing | 4-5 |
| Phase 3: Advanced | Drag-drop, segment picker, import/export | 5-7 |
| Testing & Polish | Edge cases, responsive, accessibility | 2-3 |
| **Total** | | **14-19 days** |

---

## 8. Conclusion

Integrating the OMP Theme Configurator into Wave Terminal is **feasible and valuable**. The recommended approach is to:

1. **Extract** the data models and utility logic from ohmyposh-configurator
2. **Rebuild** the UI using Wave Terminal's design system
3. **Build upon** Wave's existing OMP infrastructure (RPCs, components)
4. **Prioritize** theme modification workflow with Save/Cancel
5. **Collapse** Import/Share/Copy into a secondary section

This approach delivers the most polished user experience while maintaining Wave Terminal's visual consistency and code quality.

---

## 9. Next Steps

1. [ ] Create spec documents for each integration phase
2. [ ] Set up segment metadata import
3. [ ] Implement `OmpReadConfigCommand` RPC
4. [ ] Create `OmpConfiguratorPanel` component skeleton
5. [ ] Begin Phase 1 implementation

---

## Appendix A: File References

**ohmyposh-configurator key files:**
- `src/App.tsx` - Main app layout
- `src/components/PreviewPanel/PreviewPanel.tsx` - Preview implementation
- `src/components/PropertiesPanel/` - Segment editing (17 files)
- `src/store/configStore.ts` - State management
- `src/utils/templateUtils.tsx` - Template rendering

**Wave Terminal key files:**
- `frontend/app/view/waveconfig/appearance-content.tsx` - Appearance panel
- `frontend/app/element/settings/omptheme-control.tsx` - Theme selector
- `frontend/app/element/settings/omp-high-contrast.tsx` - High contrast mode
- `pkg/wshutil/omputil.go` - OMP backend utilities
- `pkg/wshrpc/wshrpctypes.go` - RPC type definitions

---

## Appendix B: ohmyposh-configurator Dependencies

```json
{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "zustand": "^5.0.5",
    "@dnd-kit/core": "^6.x",
    "@dnd-kit/sortable": "^8.x",
    "@dnd-kit/utilities": "^3.x",
    "js-yaml": "^4.x",
    "@iarna/toml": "^2.x",
    "idb-keyval": "^6.2.2"
  }
}
```

**Dependencies to potentially add to Wave:**
- None for MVP (use JSON only)
- `js-yaml` + `@iarna/toml` for Phase 3 YAML/TOML support
- `@dnd-kit/*` for Phase 3 drag-drop (if needed)
