# Files Widget — Browser Fixes & Native Drag-Out

Date: 2026-08-16
Branch: `feat/files-widget`
Status: bugs 1 & 2 implemented (commit `09ab3200`, pending review); bug 3 not implemented
Intended for: `/skill:phased-implement .pi/specs/files-widget-browser-fixes.md`

## Context

Three browser defects were reported:

1. **Refresh does not re-read a previewed file.** The header refresh button
   delegated to a per-view `refreshCallback` that was missing for CSV, a no-op
   for streaming (the media URL never changed), and absent entirely for the
   code-edit view.
2. **Sort order / column sizing lost on navigate-back.** TanStack table state
   was component-local; navigating into a file unmounted the directory view and
   reset sorting and column widths.
3. **Drag from the widget to the OS desktop rubber-bands back (macOS).** The
   row uses react-dnd, which does not populate a native `dataTransfer` payload
   the OS accepts, so Finder rejects the drop and the icon animates back; only
   then does the `handleNativeDragEnd` download fallback fire.

## Status

- Bug 1 (refresh) — **implemented** in commit `09ab3200`; **pending review**.
- Bug 2 (sort/column persistence) — **implemented** in commit `09ab3200`; **pending review**.
- Bug 3 (native drag-out) — **not implemented**; this is the Build Order below.

## Decisions

- **Bug 3 transport: option (a).** Pre-download the remote file to a local temp
  path at drag start, then call Electron `webContents.startDrag({ file, icon })`
  for a true native file drag. (Option (b) URL drag rejected — produces a
  `.webloc` shortcut, not a real file.)
- **Native, no modifier.** `startDrag` is the sole drag-out path. Consequence:
  react-dnd is removed from the directory view entirely; in-app move/copy is
  re-implemented with native drag/drop handlers plus a **drag-source registry**
  (a model atom recording the source URI at `dragstart`, cleared on
  `dragend`/drop). Every drag pre-downloads the source to a temp file
  (including in-app moves); that cost is accepted for v1 and mitigated by
  progress + temp cleanup.
- **Cross-platform.** `startDrag` is native on macOS/Windows/Linux; only the
  "rubber band back" symptom is macOS-specific.
- **Verification note:** confirm that a `startDrag`-initiated drag dropped back
  into the same window fires DOM `dragenter`/`dragover`/`drop` (Electron
  forwards native drags into the DOM — the existing OS-upload handlers already
  rely on this). If it does not, in-app drop (Phase 3) needs a fallback; stop
  and report rather than guessing.

## Build Order

1. **Electron IPC for native file drag** — preload + `ElectronApi` type + a main
   handler that downloads a remote URI to a temp file and calls `startDrag`.
2. **Native drag-out trigger + drag-source registry** — replace the row's
   react-dnd `useDrag` with a native `onDragStart` that records the source and
   invokes `startFileDrag`.
3. **Native in-app drop re-implementation** — replace the directory's react-dnd
   `useDrop` with native handlers that route our own drags to move/copy while
   preserving OS-file upload.
4. **Temp-file lifecycle & progress** — progress during pre-download and
   temp-file cleanup on drop/cancel/app-quit.

## Phase scope & test cases

### Phase 1 — Electron IPC for native file drag

Scope:
- `emain/preload.ts`: expose `startFileDrag(remoteUri, fileName, isDir)` →
  `ipcRenderer.send("start-file-drag", { remoteUri, fileName, isDir })`.
- `frontend/types/custom.d.ts`: add `startFileDrag` to the `ElectronApi` type.
- `emain/emain-ipc.ts`: `ipcMain.on("start-file-drag", ...)` handler that:
  - rejects directories (`isDir`) early;
  - streams `GET <web-server>/wave/stream-file?path=<remoteUri>` to a temp file
    under `app.getPath("temp")` (reuse the existing `getWebServerEndpoint`);
  - calls `event.sender.startDrag({ file: tempPath, icon: <file-type icon> })`;
  - registers the temp file for cleanup (app-quit sweep + TTL).

Tests:
- Happy path: a valid remote file URI → temp file created with matching bytes,
  `startDrag` invoked with that path.
- Error path: invalid/unreachable URI → error logged, `startDrag` not called, no
  temp file left behind.
- Directory rejection: `isDir` request → handled without download/startDrag.

### Phase 2 — Native drag-out trigger + drag-source registry

Scope:
- `frontend/app/view/preview/preview-directory.tsx` `TableRow`: remove the
  react-dnd `useDrag`; add native `draggable` + `onDragStart` that:
  - records the dragged item (`uri`, `name`, `isDir`, source dir) in a
    model-scoped "drag source" atom (add to `PreviewModel`);
  - calls `getApi().startFileDrag(uri, name, isDir)`.
- Clear the drag-source atom on `dragend` (and on drop in Phase 3).

Tests:
- Dragging a file row → `startFileDrag` called with the correct URI and the
  drag-source atom is populated.
- Drag ends without a drop → the drag-source atom is cleared.

### Phase 3 — Native in-app drop re-implementation

Scope:
- `frontend/app/view/preview/preview-directory.tsx` `DirectoryPreview`: remove
  the react-dnd `useDrop`; extend the existing native
  `handleNativeDragOver/Enter/Leave/Drop` handlers so a drop:
  - routes to **in-app move/copy** (reuse `handleDropCopy`) when the
    drag-source atom is set for this drag;
  - routes to **OS-file upload** (existing `uploadFiles`) otherwise.
- Preserve the existing `canDrop` guard (don't drop into the source's own
  parent directory) and the drag-over visual (`isDragOver`).

Tests:
- Dragging a row onto a directory → `FileCopyCommand`/`FileMoveCommand` issued
  and the directory refreshes (move/copy path).
- Dragging a Finder/Explorer file into the widget → uploads (existing behavior
  preserved).
- Dropping into the source's own parent directory → rejected (no-op).

### Phase 4 — Temp-file lifecycle & progress

Scope:
- During pre-download, drive the existing block upload overlay via
  `setBlockUploadState` (from `@/app/store/global`) so large files do not
  appear hung.
- Ensure temp files are cleaned up when the drag ends (drop, cancel) and on app
  quit; repeated drags must not accumulate temp files.

Tests:
- A slow/large drag shows the overlay during download and clears it after.
- Repeated drags do not accumulate temp files (temp dir holds only in-flight
  drags).

## Review notes (bugs 1 & 2 — already committed, must be reviewed)

- Run a TypeScript build/typecheck (CI). The worktree had no `node_modules`, so
  the fixes were only manually type-verified.
- Confirm refresh semantics per view: `refresh()` clears the saved-content
  buffer but leaves unsaved edits (`newFileContent`) intact; verify markdown,
  CSV, streaming (cache-bust), and code-edit each re-read correctly from disk.
- Confirm persistence: sort order, column widths, and column visibility survive
  navigating into a file and back (and block hide/show), and initialize from
  `preview:defaultsort`.
