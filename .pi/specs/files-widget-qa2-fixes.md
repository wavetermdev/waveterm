# Files Widget — QA Round 2 Fixes

Implements punch list v2 from the QA pass on the qa-fixes build (`bcfc338b`…`e9879f4c`) plus large-transfers build (`4c14f14d`…`7ee40785`). All root causes were identified during QA; UX decisions below are locked with Jeremy.

## Locked UX decisions

- **Confirm dialogs**: buttons Overwrite/Delete (destructive) and Cancel. **Focused default = the destructive affirmative** (explicit user decision, overriding safe-default recommendation). Destructive button styled loudly. Keyboard while open: **Tab** cycles the highlighted button, **Space/Enter** activates it, **Esc cancels**, and all other keys are swallowed (the underlying directory keydown handler must not act — today Enter leaks through and opens the file).
- **Copy-overwrite wording**: currently "Delete Then Copy" / "Sync". New: **files → [Overwrite] [Cancel]**; **directories → propose [Merge] [Replace] [Cancel]** (merge = existing `merge=true` semantics; replace = `overwrite=true`). Flag to user if deviating.
- **Transfer banner**: two lines — line 1: filename + % (or terminal state); line 2: progress bar + speed + Cancel. Failure/interrupted states **persist until dismissed** (no 3s auto-clear); success keeps a brief auto-clear.
- **Internal drags**: no full-width banner. Directory rows self-highlight as drop targets while hovered; a small corner chip shows "Copying N items" / "Moving N items". External OS drops keep the loud upload banner.

## Build Order

### Phase 1 — Selection focus state, hidden default, confirm dialogs
1. **No-focus state (#18)**: off-grid click and Escape set `focusIndex = -1` (instead of 0). Tolerate `-1` everywhere: row `.focused` class (never matches), scroll-into-view effect (guard null row), ArrowDown/ArrowUp (move to first/last selectable row from `-1`, skipping `..`), Enter handler (no-op when no focused path), `selectedPath` sync effect (already `?? null`). Verify keyboard Delete remains a no-op with empty selection.
2. **Hidden-files default (#19)**: `preview-model.tsx` `?? true` → `?? false`. Explicit toggles still persist.
3. **Confirm-dialog focus/keyboard (#20/#23-delete)**: delete confirmation (and any ErrorOverlay-based confirm) mounts with the destructive button autofocused; Tab cycles; Space/Enter activates; Esc cancels; while open, `directoryKeyDownHandler` swallows all widget keys (no Enter-open, no search, etc.). Overlay click propagation stays contained.
4. **Copy-overwrite wording (#23-copy)**: files → [Overwrite] [Cancel]; directories → [Merge] [Replace] [Cancel]. Same focus/keyboard treatment. Align button labels with actual backend semantics (overwrite=true / merge=true).

Test cases: unit tests for any extracted pure helpers (e.g., focus-move computation from -1); manual matrix — off-grid click/Escape deselect with zero highlight; arrows re-enter list skipping `..`; Enter does nothing after off-grid; delete confirm: Tab order, Enter=Delete, Space=Delete, Esc=Cancel, no key leakage (Cmd+F/Cmd+A inert while open); overwrite prompts worded per file/dir; hidden-files unset default hides dotfiles, toggle persists.

### Phase 2 — Drag/banner redesign
1. **Stale-banner root fix (#24)**: single shared cleanup invoked by BOTH folder-row drop and container drop paths (reset `dragCounterRef`, `isDragOver=false`, clear `dragSource`, `cleanupDragTemp()`).
2. **Internal-drag chip**: during an internal drag, no container banner; small corner chip "Copying N items" / "Moving N items" (from `dragSource`); cleared with the shared cleanup.
3. **Row drop-target highlight**: hovered directory row gets accent outline/tint during internal drags (new SCSS class driven by row-level dragenter/over state).
4. **Two-line transfer banner (#26/#28)**: line 1 filename + % (or terminal status text); line 2 progress bar + speed + Cancel. Failure/interrupted statuses persist until dismissed via X; success auto-clears briefly. Remove the 3s auto-clear for failures.
5. External-drop upload banner unchanged (full-width, "Drop files here to upload").

Test cases: manual — internal drag hovers dir row (highlight + chip, no big banner), drop clears everything (no stale overlay, both onto rows and empty space); external drop shows upload banner; upload failure path leaves persistent dismissible status (simulate by killing wifi mid-large-upload; verify interrupted text persists); cancel shows transient cancelled state; two-line layout renders without truncation at narrow widths.

### Phase 3 — Terminal drop port + dropdown hidden filter
1. **Terminal drag-drop chunking (#21) — REUSE mandated**: rewrite `createRemoteTempFileFromBlob` (termutil.ts) to use `planUploadChunks` / `readChunkAsBase64` / `raceWithCancel` / `resolveMaxUploadSize` / `formatBytesSize` from preview-model-upload.ts. Semantics: first chunk `RemoteWriteTempFileCommand`, subsequent chunks append to the returned temp path via `FileAppendCommand` (verify route opts `makeConnRoute(connName)` so appends hit the right connection; verify the temp path form works with append — investigate, report). Remove the local 50MB throw and FileReader path; cap from the same `files:maxuploadsize` resolution.
2. **Terminal overlay progress/errors**: extend `setBlockUploadState` payload with sent/total; `UploadOverlay` shows % when determinate; failures render in the overlay (not console-only). Cancellation optional (note if skipped).
3. **Dropdown hidden filter (#22)**: `DirectoryDropdown` accepts `showHidden` and filters dotfile entries when false; files widget passes its `showHiddenFiles` atom value; check the SCM widget call site and give it an appropriate source (its own setting or true) — report choice.

Test cases: unit tests for any new pure glue (e.g., temp-append planning); manual — drag >50MB file onto TERMINAL block → succeeds with % in overlay, path pasted; oversized-for-cap file → visible error in overlay (not console); dropdown respects Hide Hidden Files toggle; SCM widget dropdown unaffected/broken-free.

## Constraints

- No new npm deps. No wsh RPC changes → no version bump. No Go changes expected.
- Tests run in CI only; `go build ./...` available via `/home/mimo-code/project/waveterm-remote/golang-1.26.2/bin/go` (not expected this time).
- Never run `git push`.
