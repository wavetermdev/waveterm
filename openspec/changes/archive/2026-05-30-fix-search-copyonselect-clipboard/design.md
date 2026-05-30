## Context

The `copy-on-select` feature in `termwrap.ts` listens to `terminal.onSelectionChange` and writes terminal selection to clipboard. When search is open, navigating results programmatically triggers selection changes. The current guard only checks if `document.activeElement` is within `.search-container` — but when focus is on the terminal (user clicks terminal after searching), this guard passes and clipboard gets overwritten.

## Goals / Non-Goals

**Goals:**
- Prevent copy-on-select from firing when search navigation causes terminal selection changes
- Preserve copy-on-select behavior for manual user selections (mouse drag) even when search is open

**Non-Goals:**
- No changes to the search component itself
- No new settings or configuration options

## Decisions

**Decision: Check search open state via DOM query instead of atom**

The simplest and most reliable approach is to check if `.search-container` exists in the DOM when `onSelectionChange` fires. If the search container element is present, the selection change is likely from search navigation, not user action.

- Alternative considered: Using a Jotai atom to track search open state — more complex, requires cross-component wiring
- Alternative considered: Adding a flag that search sets before/after navigation — fragile, harder to maintain

The DOM query approach (`document.querySelector('.search-container')`) is:
- Zero additional state management
- Automatically in sync with the UI
- No new props or atoms needed
- Minimal performance impact (one DOM query per selection change, debounced at 50ms)

**Decision: Broaden the existing guard**

Current code (line 394-396):
```ts
const active = document.activeElement;
if (active != null && active.closest(".search-container") != null) { return; }
```

Replace with:
```ts
if (document.querySelector(".search-container") != null) { return; }
```

This catches all cases: whether focus is on search, terminal, or anywhere else.

## Risks / Trade-offs

- **[False positive]**: If user manually selects terminal text while search is open, copy-on-select will NOT fire. This is an acceptable trade-off — the user can still use Ctrl+Shift+C to copy. The search-open state implies the user is in "search mode", not "copy mode".
