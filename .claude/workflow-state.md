---
workflow: phased-dev
workflow_status: in_progress
current_phase: 5-execution
started: 2026-01-26
last_updated: 2026-01-26T00:00:00
branch: feat/UI-Theme-System-Redesign
base_branch: feat/experimental-upstream-fixes
---

# UI Theme System Redesign - Phased Development

## Plan Summary

Separate the theme system into two dimensions:
- **Mode**: Dark / Light / System (structural colors)
- **Accent/Style**: Green / Warm / Blue / Purple / Teal (accent colors, secondary tints)

Two CSS data attributes: `data-theme` and `data-accent`

## Phases

### Phase 1: Backend + CSS Foundation
- Task 1: Go backend - new `app:accent` setting
- Task 2: CSS variable restructuring (theme.scss + tailwindsetup.css)
- Task 3: Theme hook update (usetheme.ts)

### Phase 2: UI Components
- Task 4: Mode Selector component (Dark/Light/System)
- Task 5: Accent Selector component (card grid)
- Task 6: Theme Palette Preview component

### Phase 3: Appearance Panel Integration
- Task 7: Appearance panel redesign
- Task 8: Move display settings from General to Appearance
- Task 9: Settings registry updates (hideFromSettings flags)

## Workflow Stages

- [x] Discovery - Tasks identified from plan
- [x] Planning - Create specs for each task
- [x] Design Review - Validate specs
- [x] Architecture Review - Phase coherence check (REQUEST_CHANGES -> fixed)
- [ ] Execution - Implement tasks
- [ ] Code Review - Security + functional review
- [ ] QA Testing - Electron MCP verification
- [ ] Integration & Merge

## Key Files

| File | Change |
|------|--------|
| pkg/wconfig/settingsconfig.go | Add AppAccent field |
| pkg/wconfig/metaconsts.go | Add ConfigKey_AppAccent |
| schema/settings.json | Add app:accent |
| frontend/types/gotypes.d.ts | Add app:accent type |
| frontend/app/store/settings-registry.ts | Update entries, hideFromSettings |
| frontend/app/theme.scss | Major restructure - accent blocks |
| frontend/tailwindsetup.css | Accent palette overrides |
| frontend/app/hook/usetheme.ts | Dual attribute, migration |
| frontend/app/view/waveconfig/appearance-content.tsx | Full redesign |
| frontend/app/view/waveconfig/appearance-content.scss | New styles |
| frontend/app/view/waveconfig/settings-visual.tsx | Filter hideFromSettings |
