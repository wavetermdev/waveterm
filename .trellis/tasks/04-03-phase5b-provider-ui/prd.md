# Phase 5b: Provider Settings UI Integration into Main Panel

## Overview

The `ProviderSettings` component (436 lines) is fully implemented with CRUD + Test functionality, but it is NOT integrated into the main `ZeroAIPanel`. There is no header, no settings button, and no way for users to access provider configuration from the UI. This task adds a header with a settings toggle and conditionally renders `ProviderSettings`.

## Current Panel Structure

```
ZeroAIPanel
├── StatusBar (provider/model/thinking/workdir info)
└── zeroai-content
    ├── SessionList (sidebar)
    └── chat-area-wrapper
        ├── ChatArea
        └── ResizableInput
```

## Requirements

- [ ] Create `ZeroAIHeader` component with title and "Providers" toggle button
- [ ] Add `showProviderSettingsAtom` to `ui-model.ts` for state persistence
- [ ] Modify `ZeroAIPanel` in `index.tsx` to:
  - Import and render `ZeroAIHeader` between StatusBar and content
  - Conditionally render `<ProviderSettings>` (full-width) when settings mode is active
  - Conditionally render the normal chat view (SessionList + ChatArea + Input) when not in settings mode
- [ ] Export `ZeroAIHeader` from `components/index.ts`
- [ ] Add SCSS styles for the header and smooth transition between chat/settings views
- [ ] Ensure `task check:ts` passes with no errors

## Target Panel Structure

```
ZeroAIPanel
├── StatusBar
├── ZeroAIHeader  ← NEW: "ZeroAI" title + [🔌 Providers] toggle button
└── zeroai-content
    ├── [if showSettings] ProviderSettings (full-width)
    └── [else]
        ├── SessionList
        └── chat-area-wrapper
            ├── ChatArea
            └── ResizableInput
```

## Design Reference

Follow the `AIPanelHeader` pattern from `frontend/app/aipanel/aipanelheader.tsx`:

- Left: icon + title ("ZeroAI")
- Right: action button with icon ("Providers" + gear/plug icon)
- Clean, minimal header that doesn't waste vertical space

## ZeroAIHeader Component Design

```tsx
export const ZeroAIHeader = React.memo(({ onToggleSettings, showSettings }: HeaderProps) => {
  return (
    <div className="zeroai-header">
      <div className="zeroai-header-title">
        <i className="fa-solid fa-robot" />
        <span>ZeroAI</span>
      </div>
      <button
        className={cn("zeroai-header-btn", showSettings && "active")}
        onClick={onToggleSettings}
        title="Custom Providers"
      >
        <i className="fa-solid fa-plug" />
        <span>Providers</span>
      </button>
    </div>
  );
});
```

## Acceptance Criteria

- [ ] Clicking "Providers" button toggles between chat view and settings view
- [ ] ProviderSettings renders full-width in settings mode
- [ ] Chat view (SessionList + ChatArea + Input) is fully functional when not in settings mode
- [ ] Header has proper styling consistent with ZeroAI panel theme
- [ ] Smooth visual transition between views
- [ ] No TypeScript errors

## Technical Notes

- Use Jotai atom (`showProviderSettingsAtom`) in `ui-model.ts` for state
- Use Tailwind v4 or SCSS (check what the existing ZeroAI components use)
- The `ProviderSettings` component is already exported from `components/index.ts`
- Do NOT modify `ProviderSettings` component itself — only integrate it
- Copyright header: `// Copyright 2026, Command Line Inc.` + `// SPDX-License-Identifier: Apache-2.0`
- Use `cn` from `@/util/util` for class merging
- Use `cursor-pointer` on clickable elements
- Use `React.memo` + `displayName` for new components

## Out of Scope

- Modifying ProviderSettings component internals
- Adding new provider management features
- Backend changes
- Registering ZeroAIPanel into WaveTerm main layout (separate task)
