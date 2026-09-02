# Files Widget — Multi-Select & Multi-File Operations

Date: 2026-08-16
Branch: `feat/files-widget`
Status: planning complete — ready for implementation
Intended for: `/skill:phased-implement .pi/specs/files-widget-multiselect.md`

## Context

The directory preview (`frontend/app/view/preview/preview-directory.tsx`) is
single-select today: a single `focusIndex`/`selectedPath`, `onClick` ignores
modifiers, and drag-out carries exactly one `DraggedFile`. Users need
multi-select (Cmd-click, Shift-click, Shift-arrows, Cmd+A) and multi-file
operations (drag-out, in-app move/copy, delete, clipboard copy/cut/paste).

This also fixes two drag-out defects reported from testing the prior spec:

- **"Widget shown as the drag image"** — `handleDragStart` never calls
  `e.preventDefault()`, so the browser starts a default HTML5 drag whose preview
  is a snapshot of the row. Fix: `preventDefault()` and let Electron's
  `startDrag` (which already gets a real file + icon) own the drag.
- **"Uploading" overlay on drag** — `handleDragStart` calls
  `setBlockUploadState(...)`, driving the block's "Uploading {fileName}…"
  overlay during a drag-*out*. Fix: remove it from the drag path.

## Decisions

- **Selection model** (model-scoped atoms on `PreviewModel`, cleared on
  directory change):
  - `selectedPaths: PrimitiveAtom<Set<string>>` — keyed by each row's `path`
    value (stable across sort/filter). The `..` row is never selectable.
  - `selectionAnchor: PrimitiveAtom<string | null>` — anchor path for
    Shift-range selection.
  - `focusIndex` stays component-local (it is index-based and drives focus
    styling + scroll; it is already drilled down as a prop).
  - Selection and anchor are cleared when the listed directory changes (the
    existing listing effect keyed on `[conn, dirPath, refreshVersion]`) and on
    refresh.
- **Interactions**: plain click = select single (and set anchor); Cmd/Ctrl-click
  = toggle; Shift-click = range (anchor → clicked in current visible order);
  Shift+↑/↓ = extend range from anchor; Cmd/Ctrl+A = select all visible rows;
  Escape = clear selection. **No rubber-band marquee** — it is an icon/grid-view
  interaction that doesn't fit a table/list view, and "empty space" is undefined
  when the list fills the viewport. Deferred/out of scope.
- **Drag source becomes a list.** `dragSource: PrimitiveAtom<DragSourceState | null>`
  where `DragSourceState = { files: DraggedFile[]; move: boolean }`. `move` is
  captured at `dragstart` from `e.metaKey || e.ctrlKey`. On `dragstart`, if the
  grabbed row is in `selectedPaths`, the whole selection becomes the drag source;
  otherwise just that row (after selecting it).
- **Drag-out is files-only.** Directories are excluded from OS drag-out (Electron
  folder drags are flaky, and we would have to recursively materialize the tree
  locally). A mixed selection drags only its files to the OS. Directories remain
  fully supported for in-app move/copy/delete (RPC handles recursion).
- **In-app drop: copy by default, move on modifier.** The modifier is read at
  `dragstart` (into `dragSource.move`) rather than at drop, to avoid depending on
  the drop event's modifier state. Plain drag = `FileCopyCommand`; Cmd/Ctrl-held
  drag = `FileMoveCommand`.
- **Clipboard** is per-block (a `PreviewModel` atom): `fileClipboard:
  PrimitiveAtom<{ sources: DraggedFile[]; cut: boolean } | null>`. Copy = sources
  + `cut:false`; Cut = sources + `cut:true`; Paste = `FileCopyCommand`/`FileMoveCommand`
  into the current directory, then refresh, and clear the clipboard after a cut
  (move) paste.
- **Delete** confirms multi-file deletion (existing error/confirm button pattern),
  then issues `FileDeleteCommand` per item (`recursive: true` for directories).

## Build Order

1. **Selection model + interactions** — `selectedPaths`/`selectionAnchor` atoms,
   click/Cmd-click/Shift-click/Shift-arrows/Cmd+A/Escape, selected-row styling,
   clear on directory change.
2. **Multi-file drag-out** — `dragSource` → list, `e.preventDefault()`, remove the
   upload overlay, `startFileDrag` array-based with `startDrag({ files, icon })`.
3. **Multi-file in-app drop** — `decideNativeDropRoute` + `handleNativeDrop`
   copy/move the whole selection (files + dirs).
4. **Multi-file delete** — context menu + Delete key, batch delete with confirm.
5. **Multi-file clipboard copy/cut/paste** — Cmd+C/X/V + context-menu items.

## Phase scope & test cases

### Phase 1 — Selection model + interactions

Scope:
- Add `selectedPaths: PrimitiveAtom<Set<string>>` and
  `selectionAnchor: PrimitiveAtom<string | null>` to `PreviewModel`
  (init: `new Set()`, `null`).
- Extract pure selection logic into `preview-directory-utils.tsx` (exported,
  unit-testable) so handlers stay thin. Suggested signatures (worker may refine):
  ```ts
  type SelectionUpdate = { selectedPaths: Set<string>; anchor: string | null };
  function applySelectionClick(prev: SelectionUpdate, path: string, opts: { cmd: boolean; shift: boolean }, visiblePaths: string[]): SelectionUpdate;
  function applySelectAll(visiblePaths: string[]): SelectionUpdate;
  function applyClearSelection(): SelectionUpdate;
  ```
  Semantics: plain click → `{path}`, anchor `path`; cmd-click → toggle `path`,
  anchor `path`; shift-click → range from anchor to `path` over `visiblePaths`
  (anchor unchanged); select-all → all `visiblePaths`.
- Wire `TableRow.onClick` to read `e.metaKey`/`e.ctrlKey`/`e.shiftKey` and call
  the update; render selected-row styling (a `selected` class alongside `focused`).
- Extend `directoryKeyDownHandler`: Shift+↑/↓ range-extend; Cmd/Ctrl+A select
  all; Escape clears selection (and exits search as today). The `..` row is never
  selectable.
- Clear `selectedPaths`/`selectionAnchor` when the directory changes (listing
  effect) and on refresh.

Tests:
- Pure helper tests (no DOM): single click replaces selection; cmd-click toggles;
  shift-click selects a contiguous range in `visiblePaths` order (including
  reverse direction, i.e. anchor below focus); select-all; clear; toggling a
  selected path removes it.
- Model test: atoms initialize empty/null.

### Phase 2 — Multi-file drag-out

Scope:
- Change `dragSource` to `PrimitiveAtom<DragSourceState | null>`; add
  `type DragSourceState = { files: DraggedFile[]; move: boolean }` (global type
  in `custom.d.ts` alongside `DraggedFile`).
- `TableRow.handleDragStart`: `e.preventDefault()`; compute the drag source —
  if the row's path is in `selectedPaths`, drag every selected file (excluding
  directories and the `..` row); else select just this row and drag it. Capture
  `move = e.metaKey || e.ctrlKey`. Remove the `setBlockUploadState` overlay call.
- `handleDragEnd`/`handleNativeDrop` continue to clear `dragSource` and trigger
  `cleanupDragTemp()` (overlay call removed).
- `startFileDrag` becomes array-based: `ElectronApi.startFileDrag(items:
  { remoteUri: string; fileName: string }[]): void`. Preload sends
  `"start-file-drag"` with `{ items }`. Main handler downloads each item into one
  temp dir, then `event.sender.startDrag({ files: tempPaths, icon })` (icon from
  the first file via `app.getFileIcon`). Keep the per-webContents temp registry
  + TTL + app-quit sweep (already in place).
- Note: `webContents.startDrag` accepts `files: string[]` for multi-file drag;
  verify against the Electron 41 typings during implementation.

Tests:
- Pure helper for building the drag item list: single (unselected) row → one item;
  selected row with an N-item selection → N items; directories and `..` excluded.
- Main-side temp-download already covered by Phase 1/4 of the prior spec; extend
  `emain-ipc-drag.test.ts` only if the handler shape changes meaningfully.

### Phase 3 — Multi-file in-app drop

Scope:
- Update `decideNativeDropRoute(dragSource, dirPath)` to accept
  `DragSourceState | null`: reject if `dirPath` is null OR every dragged item's
  `absParent === dirPath`; `"inapp"` if `dragSource` set; `"upload"` otherwise.
- `handleNativeDrop` in-app branch: loop `dragSource.files`; issue
  `FileCopyCommand` (copy) or `FileMoveCommand` (move, when `dragSource.move`)
  per item via a small helper (reuse the overwrite/merge retry pattern in the
  existing `handleDropCopy`); then `model.refresh()` and clear `dragSource` +
  cleanup.

Tests:
- `decideNativeDropRoute` with a multi-item source: same-parent → reject,
  different-parent → inapp, null → upload, null dirPath → reject.
- Helper that maps `(files, move)` → command sequence: copy produces
  `FileCopyCommand` calls, move produces `FileMoveCommand` calls.

### Phase 4 — Multi-file delete

Scope:
- Context menu "Delete": if the right-clicked row is in the selection, delete the
  whole selection; otherwise select just that row and delete it. Label shows
  "Delete N Items" when N > 1.
- Delete key in `directoryKeyDownHandler`: delete the current selection.
- Batch delete helper: for each selected item issue `FileDeleteCommand` with
  `recursive` for directories; surface per-file failures via `errorMsgAtom`;
  confirm multi-item deletion using the existing confirm-button/error pattern;
  refresh once and clear the selection afterward.

Tests:
- Helper that builds the delete item list (dedupes, sets `recursive` for dirs,
  excludes `..`); helper that maps failures to error messages.

### Phase 5 — Multi-file clipboard copy/cut/paste

Scope:
- Add `fileClipboard: PrimitiveAtom<{ sources: DraggedFile[]; cut: boolean } | null>`
  to `PreviewModel` (init null).
- Cmd/Ctrl+C → copy selected into clipboard (`cut:false`); Cmd/Ctrl+X → cut
  (`cut:true`); Cmd/Ctrl+V → paste into current directory via `FileCopyCommand`/
  `FileMoveCommand` per source, then `model.refresh()`, and clear the clipboard
  after a cut-paste.
- Context menu: Copy / Cut / Paste (Paste enabled only when the clipboard has
  sources and the current dir differs from the source dir).
- Ensure these keybindings are intercepted by `directoryKeyDownHandler` when the
  directory view has focus and don't leak to the terminal/global clipboard.

Tests:
- Clipboard model: copy sets sources/cut=false; cut sets cut=true; paste helper
  maps to `FileCopyCommand` (copy) vs `FileMoveCommand` (cut) and returns whether
  the clipboard should be cleared (cut only).
