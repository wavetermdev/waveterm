# Files Widget — QA Punch List Fixes

Spec for the 2026-08-17 QA pass of `feat/files-widget` (multi-select build 0.16.2). Each finding was root-caused during QA; this spec turns the agreed punch list into phases.

## Background — confirmed root causes

1. **Stale closure in row context menu** (`preview-directory.tsx`, row-menu `handleFileContextMenu`): deps are `[setRefreshVersion, conn]`; `allRows`, `dirPath`, `model` are captured stale. After navigating, right-click Copy/Cut builds `sources: []` from stale rows → empty clipboard → greyed-out Paste. Delete-after-navigation is suspect too (`resolveDeleteItems` gets stale entries).
2. **Cut+paste always fails**: `pasteClipboard` / in-app drop pass the *target directory* as `desturi`. Backend `RemoteFileMoveCommand` stats dest and errors if it exists ("destination already exists") — no basename-append. Copy tolerates dir destinations (`prepareDestForCopy` appends basename); Move does not.
3. **Directories can't be dragged in-app**: `buildDragFileItems` filters out dirs (Phase-2 OS-drag-out exclusion) so dragging a dir starts no drag at all. Additionally `RemoteFileCopyCommand` refuses `opts.Recursive` ("directory copying is not supported"), so directory copy needs a backend path investigation.
4. **No drop targeting onto rows**: only the widget container has `onDrop`; drops always target the widget's current directory; same-dir guard silently rejects.
5. **Upload path**: whole-file base64 in one WS message; renderer silently drops messages >5MB (`MaxWebSocketSendSize`, `ws.ts`) → hung promise, no feedback. `PutFile` truncates existing files without prompting.
6. **Delete UX**: single files delete with no confirmation (remote deletes are permanent — decided: always confirm); confirm text lacks names; confirm banner causes layout shift flash; no click-empty-space selection clear.

## Build Order

### Phase 1 — Context-menu state correctness
Fix the row context-menu stale closures in `preview-directory.tsx`:
- Add missing deps to the row-menu `handleFileContextMenu` useCallback (`allRows`, `dirPath`, `model`, `connName`), or preferably read fresh state via `globalStore.get(...)` inside each `click` handler at invocation time.
- Audit every menu item handler in both menus (row menu and container/empty-space menu) plus the Delete keyboard branch for stale captures; fix all found.
- Verify multi-select Delete after navigation resolves the correct items (`resolveDeleteItems` receives fresh entries).

Test cases:
- Manual QA matrix: right-click Copy/Cut/Delete in dir A → navigate to B → verify Paste enabled and operations target correct paths; repeat in reverse order; select-multiple in B → right-click "Delete N Items" lists correct count.
- Existing unit tests still pass (`resolveDeleteItems`, `buildSelectionItems` unchanged behaviorally).

### Phase 2 — Clipboard paste destination fix
Make paste and in-app drop use full-file destinations:
- In `pasteClipboard` and the in-app drop branch of `handleNativeDrop`: build `desturi` as `<targetDir>/<relName>` per source item (both copy and cut/move).
- Confirm overwrite/merge retry flow: after the change, moving onto an existing file surfaces backend error strings that match the `overwriteError`/`mergeError` constants used by the retry buttons; align constants if needed.
- Keep same-dir no-op guard unchanged.

Test cases:
- Unit test a small `joinRemoteDir(destDir, relName)` pure helper if extracted (happy path, trailing slash on dirPath, relName containing no slash).
- Manual QA: Cmd+C→Cmd+V copies file into other dir; Cmd+X→Cmd+V moves it; paste onto existing name shows overwrite prompt and both options work; drag-drop between two directories still works for copy and move.

### Phase 3 — Directory drag in-app + transfer backend
- `buildDragFileItems`: include directories (`isdir` items kept, `isDir: true`), still excluding `..`.
- OS boundary filter: `startFileDrag` call sites pass only non-dir items (C15 regression guard).
- Investigate and wire directory transfer support:
  - Same-host move of a directory likely works via rename (verify `RemoteFileMoveCommand` tail; recursive flag semantics).
  - Directory COPY: `RemoteFileCopyCommand` refuses `opts.Recursive`. Investigate available mechanisms (stream-based transfer RPCs, wsh cp implementation). If a supported path exists, wire it; if genuinely unsupported, surface a clean "directory copy not supported" message instead of a raw error.
- Update `buildDragFileItems` unit tests for the new dir-inclusive behavior; add case asserting OS-filter helper excludes dirs.

Test cases:
- Unit: `buildDragFileItems` returns mixed files+dirs with correct `isDir`; OS-filter helper drops dirs.
- Manual QA: drag folder onto another folder in-app → move works (rename semantics); copy folder → either succeeds or clean unsupported message; drag mixed selection out to Finder → files only.

### Phase 4 — Drop targeting onto rows + own-drag banner
- Directory rows get `onDragEnter/onDragOver/onDrop` handlers: stopPropagation, drop routes to copy/move into THAT row's directory (respecting `dragSource.move`), reusing the Phase 2 dest construction.
- File rows and `..` fall through (no row-level drop) to the widget default.
- Own-drag banner (#5): when `dragSource != null`, replace "Drop files here to upload" with "Drop to copy/move here" (or hide); never show upload wording for internal drags.

Test cases:
- Manual QA matrix: drag selection onto subfolder row → lands inside it (copy plain / move with modifier); onto `..` or file row → widget-default behavior; banner text correct for external vs internal drags.

### Phase 5 — Delete UX bundle
- Always confirm deletes, including single files (collapse `shouldConfirmDelete` branching into one confirmation path; keep helper only if still meaningful).
- Confirmation text includes names: e.g. `Delete "reports" and all its contents?` / `Delete 5 items? ("a.txt", "b.txt", "notes/", +2 more)` — extract a pure formatter with cap (show first ~3 names + "+N more").
- Fix layout-shift flash: render confirmations as an overlay that does not push/reflow the table (dedicated confirm overlay or CSS positioning change for warning-level prompts).
- Click on empty container space clears selection + focus index + anchor (must not fire when opening context menu or interacting with child widgets).

Test cases:
- Unit tests: name-list formatter (0/1/few/many items, dirs marked, long-list capping).
- Manual QA: delete flows show named confirmations; no visible list jump when dialog appears; click-below-list deselects; Escape still clears; right-click empty space does NOT deselect before showing menu.

### Phase 6 — Chunked upload, progress overlay, loud transport failures
- Chunked upload in `uploadFiles`: split files into chunks (~2MB), first chunk via `FileWriteCommand` (truncate), subsequent via `FileAppendCommand` with byte offset. Every WS message stays well under the 5MB send cap → large uploads work again.
- Make oversized-message failure loud: `sendMessage` in `frontend/app/store/ws.ts` must not silently drop — return failure so pending RPCs reject with a sensible error instead of hanging forever (coordinate with how `rpcResponseGenerator` handles rejection).
- Upload progress: progress state (bytes/percent) surfaced in the files-widget UI while uploading; indeterminate spinner acceptable fallback but prefer percent.
- Download progress: investigate emain download IPC; if streaming progress is cheaply available, show it; otherwise indeterminate indicator.

Test cases:
- Unit: chunk-splitting helper (empty file, file smaller than chunk, exact multiple, remainder), offset math correctness.
- Manual QA: upload 20MB file succeeds (previously silent-fail >~3.7MB); progress visible; failed chunk produces visible error not a hang; terminal paste path unaffected.

### Phase 7 — Small features
- **Cmd+R refresh**: bind `Cmd:r` in `directoryKeyDownHandler` → same refresh as header button (block-scoped dispatch prevents cross-block collision; verify editor/webview blocks unaffected when they have focus).
- **Editable path input**: clicking the directory name in the selector turns it into an inline input; Enter navigates (support absolute paths, `~` expansion, relative segments); Escape cancels. Type-to-filter for the dropdown list is dropped per product decision.
- **About dialog**: GitHub link → `https://github.com/whoisjeremylam/waveterm-remote`; Website link → fork GitHub; Sponsor → fork GitHub (placeholder until sponsorship exists); acknowledgements → credit upstream WaveTerm (`wavetermdev/waveterm`); copyright → `2026 LannaCo Contributors`.

Test cases:
- Manual QA: Cmd+R refreshes directory and clears nothing unexpectedly; typed path navigation incl. `~/x`, `/abs/path`, bad path → clean error; About dialog links point where specified.

## Constraints

- No new npm dependencies. No new wsh RPC commands unless Phase 3 investigation proves one is required (version bump would then be REQUIRED — flag to user before adding).
- Tests run in CI only (no local node_modules); `go build ./...` locally with `/home/mimo-code/project/waveterm-remote/golang-1.26.2/bin/go`.
- Never run `git push`.
