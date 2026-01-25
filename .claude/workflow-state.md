---
workflow: phased-dev
workflow_status: in_progress
current_phase: Design Review
started: 2026-01-25
last_updated: 2026-01-25
tool_uses_count: 35
---

# Phased Development Workflow State

## Project: Unified Appearance Panel

### Objective
Create unified Appearance Panel - Move OMP components from settings to new Appearance tab, merge with Tab Backgrounds, create unified theming experience for UI theme, Terminal color scheme, and OMP theme selection. Settings registry should only have: 1) OMP theme detection (from $POSH_THEME), 2) OMP Color Theme selector similar to terminal theme selector, 3) Link to Appearance Panel for advanced config.

### Key Requirements
1. **Detect OMP installation** - Check if Oh-My-Posh is installed
2. **Detect current theme** - Read `$POSH_THEME` environment variable
3. **Detect color schema compatibility** - Light/dark theme support
4. **Visual theme selector** - Like terminal theme selector
5. **Palette comparison** - Show current OMP palette AND target palette
6. **Apply functionality** - Button to apply Wave palette to OMP config
7. **Merge with Tab Backgrounds** - Unified appearance panel
8. **Link from settings** - Hardware Acceleration style link to Appearance Panel
9. **Live OMP Theme Reload** - Support hot-reloading of OMP theme via shell re-init (per https://ohmyposh.dev/docs/installation/customize)
10. **Theme Preview with Background Toggle** - Show OMP themes on both light AND dark backgrounds in selector
11. **"High Contrast Compatible" Mode** - Auto-add contrasting background to transparent segments (white font → black bg, black font → white bg)

### Completed Stages
- [x] Discovery (Phase 1) - 10 tasks identified
- [x] Planning (Phase 1) - 10 specs created by planning agents

### In Progress
- [ ] Worktree Setup (Phase 1) - Creating isolated branches for parallel development

### Completed
- [x] Design Review (Phase 1) - REQUEST_CHANGES: Created specs 011-013 for new requirements
- [x] Architecture Review (Phase 1) - APPROVED with conditions: 5 implementation phases defined

### Pending Stages
- [ ] Execution (Phase 1)
- [ ] Code Review (Phase 1)
- [ ] QA Testing (Phase 1)
- [ ] Integration & Merge (Phase 1)

## Specs Created (Planning Agent Outputs)

| Spec # | Task | Agent ID | Status |
|--------|------|----------|--------|
| spec-001 | Appearance Panel Component | a5ae424 | Complete |
| spec-002 | Move OMP Theme Selector | a6bce6d | Complete |
| spec-003 | UI Theme Selector | a107a56 | Complete |
| spec-004 | Terminal Theme in Appearance | a190878 | Complete |
| spec-005 | Tab Backgrounds Integration | a949437 | Complete |
| spec-006 | OMP Detection | a54ddcb | Complete |
| spec-007 | Palette Comparison | af44685 | Complete |
| spec-008 | Apply Palette to OMP | a1e18ff | Complete |
| spec-009 | Settings Registry Update | ac3b170 | Complete |
| spec-010 | IPC Handlers for OMP | aaa7834 | Complete |

## Key Architecture Decisions

1. **AppearanceContent** - New unified panel component in waveconfig
2. **Collapsible Sections** - UI Theme, Terminal, OMP, Tab Backgrounds
3. **UIThemeSelector** - Visual cards for 5 themes (dark, light, light-gray, light-warm, system)
4. **Reuse existing controls** - TermThemeControl, OmpThemeControl, BgPresetsContent
5. **New IPC commands** - OmpGetConfigInfoCommand, OmpWritePaletteCommand
6. **Backend utilities** - pkg/wshutil/omputil.go for OMP config detection/merging
7. **Backup system** - Use existing filebackup for OMP config modifications

## Key Files to Create/Modify

### Frontend (Create)
- frontend/app/view/waveconfig/appearance-content.tsx
- frontend/app/view/waveconfig/appearance-content.scss
- frontend/app/element/settings/ui-theme-selector.tsx
- frontend/app/element/settings/omp-apply-button.tsx
- frontend/app/element/settings/omp-palette-comparison.tsx

### Frontend (Modify)
- frontend/app/view/waveconfig/waveconfig-model.ts (add Appearance tab)
- frontend/app/store/settings-registry.ts (update OMP entries)

### Backend (Create)
- pkg/wshutil/omputil.go (OMP utilities)

### Backend (Modify)
- pkg/wshrpc/wshrpctypes.go (add OMP command types)
- pkg/wshrpc/wshserver/wshserver.go (add OMP handlers)

## Next Steps
1. Launch Design Review agents for each spec
2. Check for completeness, edge cases, security
3. Proceed to Architecture Review if all approved
