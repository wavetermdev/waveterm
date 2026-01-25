---
workflow: phased-dev
workflow_status: in_progress
current_phase: Implementation
started: 2026-01-25
last_updated: 2026-01-25
orchestrator_session: active
---

# Phased Development Workflow - OMP Theme Configurator Integration

## Project: OMP Theme Configurator

### Objective
Integrate the OMP Theme Configurator (based on https://github.com/jamesmontemagno/ohmyposh-configurator) into Wave Terminal's Appearance Panel, with the following requirements:

1. **Theme Integration**: Dynamically load the current OMP theme into the configurator
2. **Rebranded UI**: Change the configurator theme to match Wave Terminal's design language
3. **Primary Focus**: Theme modification should be the main action (Save/Cancel workflow)
4. **Secondary Actions**: Import/Share/Copy should be collapsed/hidden secondary options
5. **Preview Support**: Must support light/dark preview (already exists in the source)

### Current Status: Ready for Implementation Phase

## Planning Summary

**Recommended Approach:** Extract logic from ohmyposh-configurator, rebuild UI using Wave's design system

**Key Decisions:**
1. Use Jotai (not Zustand) for state management
2. Use SCSS with CSS variables (not Tailwind)
3. Support JSON configs only for MVP (YAML/TOML later)
4. Primary focus on edit/save workflow
5. Collapse Import/Export/Share into Advanced section
6. Reuse existing Wave OMP infrastructure (RPCs, reinit, backup)

**New Components Needed:**
- `OmpConfigurator` - Main container
- `OmpConfigPreview` - Rendered prompt preview
- `OmpBlockEditor` - Block list with selection
- `OmpSegmentEditor` - Segment properties panel
- `AdvancedSection` - Collapsed secondary actions

**New RPC Commands Needed:**
- `OmpReadConfigCommand` - Read full config as JSON
- `OmpWriteConfigCommand` - Write full config with backup

**Estimated Effort:** 14-19 days total (see discovery report)

## Phase Tracking

### Phase 0: Discovery & Research
- [x] Clone and analyze ohmyposh-configurator source
- [x] Identify key components and architecture
- [x] Document integration points with Wave Terminal
- [x] Map out UI changes needed for Wave branding
- [x] Created discovery report: `.claude/specs/discovery-omp-configurator.md`

### Phase 1: Planning
- [x] Create specs for each integration task
    - spec-001-configurator-embed.md - Component embedding and RPC commands
    - spec-002-wave-branding.md - Styling and design system
    - spec-003-theme-loading.md - Dynamic theme loading from $POSH_THEME
    - spec-004-save-workflow.md - Save/Cancel workflow with validation
    - spec-005-secondary-actions.md - Collapsed Import/Export/Share
- [x] Design review with ultrathink
- [x] Architecture review

### Phase 2: Implementation
**Status: IN PROGRESS**

#### Phase 2.1: Backend RPC Commands (Go) - COMPLETE
- [x] Add OmpReadConfigCommand RPC (read full config as JSON)
- [x] Add OmpWriteConfigCommand RPC (write full config with backup)
- [x] Regenerate TypeScript bindings
- [ ] Test RPC commands (will test with frontend)

#### Phase 2.2: Frontend Components (React/TypeScript) - COMPLETE
- [x] OmpConfigurator main component shell
- [x] OmpConfigPreview (visual preview)
- [x] OmpBlockEditor (block/segment editing)
- [x] ActionButtons (Save/Cancel with keyboard shortcuts)
- [x] AdvancedSection (collapsed Import/Export/Copy/Restore)

#### Phase 2.3: Integration & Styling - COMPLETE
- [x] Wire up to appearance-content.tsx
- [x] Apply Wave branding (SCSS)
- [ ] Test with existing OMP infrastructure (requires runtime testing)

### Phase 3: Review & QA
- [ ] Code review
- [ ] QA testing with Electron MCP
- [ ] Integration verification

## Reference
- Source repo: https://github.com/jamesmontemagno/ohmyposh-configurator
- Target location: Wave Terminal Appearance Panel
- Existing context: Prior work in unified Appearance Panel (completed)
