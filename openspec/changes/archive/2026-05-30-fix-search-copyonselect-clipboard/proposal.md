## Why

When search is open with results, navigating through search results programmatically changes the terminal selection. If `term:copyonselect` is enabled, this triggers `navigator.clipboard.writeText()` which overwrites the user's clipboard content without their knowledge. Users lose clipboard data when they navigate search results, causing confusion and data loss.

## What Changes

- Add a guard in the copy-on-select handler to skip clipboard writes when the search bar is open (not just when it has focus)
- The existing guard only checks if `document.activeElement` is within `.search-container`, which allows clipboard overwrites when search is open but focus is on the terminal

## Capabilities

### New Capabilities

- `search-clipboard-guard`: Prevent copy-on-select from overwriting clipboard when search is actively open, regardless of focus state

### Modified Capabilities

- `<existing-name>`: no spec-level requirement changes — this is a behavioral fix to existing implementation

## Impact

- `frontend/app/view/term/termwrap.ts:386-407` — copy-on-select onSelectionChange handler
- No API changes, no dependency changes
