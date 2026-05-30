## 1. Guard Implementation

- [x] 1.1 Modify copy-on-select guard in `termwrap.ts` to check for `.search-container` DOM presence instead of only checking `document.activeElement`
- [x] 1.2 Verify the fix works in all scenarios: search open + terminal focus, search closed, search open + search focus

## 2. Verification

- [x] 2.1 Manual test: enable `term:copyonselect`, open search, navigate results, verify clipboard is NOT overwritten
- [x] 2.2 Manual test: with search open, manually select terminal text, verify copy-on-select does NOT fire (acceptable trade-off per design)
- [x] 2.3 Manual test: close search, manually select terminal text, verify copy-on-select still works
