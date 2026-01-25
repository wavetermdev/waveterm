---
workflow: phased-dev
workflow_status: complete
current_phase: 3-integration
started: 2026-01-25
last_updated: 2026-01-25T11:15:00
tool_uses_count: 25
---

# Phased Development Workflow - Connections Auto-Detection & AI Modes Pre-fill

## Overview

Two features to implement:

### Feature 1: Connections Auto-Detection
- Auto-detect shells/terminals like Windows Terminal does
- Cross-platform support: Windows, macOS, Linux
- Triggered by button/icon, auto-triggered when connections list is empty
- Auto-populates connections.json with detected shells

### Feature 2: AI Modes Pre-fill
- Pre-fill AI providers from docs (https://docs.waveterm.dev/waveai-modes)
- Non-opensource providers show warning/incomplete icon for missing API keys
- Hover or click reveals the incomplete status details

## Current Phase: Planning

### Completed Stages
- [x] Discovery (Phase 1) - Research completed, tasks identified
  - Windows Terminal detection mechanisms researched
  - AI providers analyzed from documentation and source code
  - 3 tasks created in todos/

### Completed
- [x] Integration (Phase 3) - Changes committed
  - `1e92844a` feat(connections): add auto-detection of available shells
  - `e0de65a4` feat(ai-modes): add pre-filled provider templates with status indicators
  - `9312d298` docs: add specs and reviews for connections/AI modes features

### Completed
- [x] QA Testing (Phase 3) - Static analysis complete
  - TypeScript compilation: PASS
  - Go compilation: PASS
  - QA report: `.claude/reviews/qa-report-connections-ai-modes.md`
- [x] Code Review (Phase 3) - Security + functional review
  - Shell detection backend: PASS
  - AI modes prefill: PASS
  - Connections UI: CONDITIONAL PASS → Fixed H-1 (connection name validation)

### Completed
- [x] Execution (Phase 3) - Implement with parallel agents
  - [x] TODO-001: Backend shell detection - COMPLETE
  - [x] TODO-003: AI modes prefill - COMPLETE
  - [x] `task generate` - TypeScript bindings regenerated
  - [x] TODO-002: Connections auto-detection UI - COMPLETE

### Completed Stages
- [x] Architecture Review (Phase 2) - COHERENT
  - Dependency order verified: TODO-001 before TODO-002, TODO-003 independent
  - Type consistency verified across all specs
  - Pattern consistency verified (loading, error, accessibility)
  - Parallel execution plan: TODO-001 + TODO-003 in parallel, then TODO-002
- [x] Design Review (Phase 2) - All 3 specs PASSED
  - Backend spec: Minor fixes applied (ID generation, shell types, RPC signature)
  - UI spec: Minor fixes applied (accessibility, loading message, icons)
  - AI modes spec: Minor fixes applied (Anthropic model, Google secret name, isLocalEndpoint)
- [x] Planning (Phase 2) - Detailed specs created
  - `spec-connections-autodetect-backend.md` - RPC command, platform detection
  - `spec-connections-autodetect-ui.md` - UI components, state management
  - `spec-ai-modes-prefill.md` - Provider templates, status indicators

### Pending Stages
- [ ] Architecture Review (Phase 2) - Phase coherence check
- [ ] Execution (Phase 3) - Implement with parallel agents
- [ ] Code Review (Phase 3) - Security + functional review
- [ ] QA Testing (Phase 3) - Electron MCP testing
- [ ] Integration (Phase 3) - Merge and cleanup

## Discovery Summary

### Research Documents Created
1. `.claude/specs/research-windows-terminal-detection.md`
   - Windows Terminal dynamic profile generator architecture
   - WSL registry detection at `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`
   - PowerShell Core multi-source detection
   - SSH config file parsing
   - Git Bash registry detection
   - Cross-platform considerations

2. `.claude/specs/research-ai-providers.md`
   - All supported providers: Wave, OpenAI, Anthropic, Google, OpenRouter, Azure, Perplexity, Ollama, LM Studio
   - Provider classification: Commercial (API key required) vs Local (no key needed)
   - Configuration schema for each provider
   - Pre-fill strategy with status indicators

### Tasks Identified
1. **TODO-001**: Connections Auto-Detection Backend Service
   - New RPC command: `DetectAvailableShellsCommand`
   - Platform-specific detection logic
   - Files: `pkg/util/shellutil/shelldetect*.go`, RPC types

2. **TODO-002**: Connections Auto-Detection UI
   - Auto-detect button in toolbar
   - Enhanced empty state
   - Detection results dialog with checkboxes
   - Duplicate detection

3. **TODO-003**: AI Modes Pre-fill with Providers
   - Pre-filled provider templates
   - Status indicators (✅/⚠️/🔧)
   - Tooltip/popover for status details
   - Quick link to Secrets page

## Key Decisions
- Use registry-based WSL detection (faster than `wsl.exe`)
- Cross-platform detection via `/etc/shells` on Unix
- Pre-fill common providers with incomplete status
- Status badge shows API key requirement

## Next Steps
1. Launch planning agents to create detailed specs for each task
2. Use Opus model with ultrathink for deep analysis
3. Gate progression until specs are approved
