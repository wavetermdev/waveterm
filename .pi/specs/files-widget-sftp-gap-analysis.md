# Files Widget — SFTP Client Gap Analysis

Date: 2026-07-24
Branch: `feat/files-widget` (off `odds-and-ends`)
Scope: review only — no code changes made.

## What the "files widget" actually is

The files widget is the Wave "preview" block. When its target path is a
directory, `preview-model.tsx` renders the directory browser
(`preview-directory.tsx`). File reads/writes/copies/renames flow through the
WSH RPC layer, not through the OpenSSH SFTP subsystem:

- **Frontend**: `frontend/app/view/preview/` (model, directory table, utils, entry-manager)
- **Local WSH shim**: `pkg/remote/fileshare/wshfs/wshfs.go` (parses `wsh://` URIs, routes RPCs to the remote host)
- **Remote handler**: `pkg/wshrpc/wshremote/wshremote_file.go` (actually does `os.Stat`/`os.ReadFile`/`os.Rename`/`io.Copy` on the remote)
- **Wire types**: `pkg/wshrpc/wshrpctypes_file.go`
- **Transport**: the existing SSH connection's stream broker (`CreateStreamReader`/`CreateStreamWriter`), payloads base64-encoded.

This is important context for the gap analysis: it is *not* SFTP. It is a
custom RPC-over-SSH file protocol. That gives us editor/preview integration
"for free", but it means every SFTP-style feature must be built on top of this
protocol rather than inherited from libssh/sftp.

## Capability inventory (what exists today)

| Area | Feature | Where |
|------|---------|-------|
| Browse | Streaming dir listing, chunked (128/chunk), no entry cap (reads all) | `RemoteListEntriesCommand` |
| Browse | Columns: icon, name, perm, mtime, size, type | `preview-directory.tsx` |
| Browse | Client-side sort (name/mtime), resizable columns | TanStack table |
| Browse | Hidden-file toggle, type-to-filter (name substring, in-memory) | `preview-directory.tsx` |
| Navigate | History back/forward, parent dir, home/terminal-cwd, bookmarks (hardcoded), directory dropdown | `preview-model.tsx` |
| Open | Text/code editor (Monaco), markdown, CSV, image/video/audio/pdf streaming | `getSpecializedView` |
| Edit | Save/revert, read-only detection, word-wrap, font size | `handleFileSave` |
| Create | New File, New Folder | `newFile`/`newDirectory` |
| Rename | File/Folder rename (via move) | `handleRename` |
| Delete | Delete with recursive-confirm | `handleFileDelete` |
| Transfer | Upload: native drag-drop of files (50 MB/file, serial) | `uploadFiles` |
| Transfer | Download: single file via Electron `downloadURL` (no progress) | `downloadFile` → `emain-ipc.ts` |
| Transfer | Copy/move: drag-drop within widget; overwrite/merge confirm | `handleDropCopy` |
| Clipboard | Copy path/name (shell-quoted variants) | context menus |
| Extras | Open native path, Open in terminal here, Open preview in new block, macOS QuickLook (local only) | `previewutil.ts` |

## Gap analysis vs. a full SFTP client (Cyberduck / Mountain Duck)

Grouped by theme. Severity is relative to "can it plausibly replace Cyberduck
for SSH file management".

### 1. Transfer fundamentals (highest impact)

1. **No transfer progress, speed, or queue.** Uploads are serial
   fire-and-forget base64 writes; downloads are handed to Electron's
   `downloadURL` with no in-app feedback. There is no transfer manager
   (no list of active/completed/failed transfers, no throughput, no ETA).
2. **No recursive upload.** `uploadFiles` iterates a flat `File[]`; dropping a
   folder does nothing (directory entries are not enumerated client-side).
3. **No recursive download.** `downloadFile` only handles single files; there
   is no tar/zip streaming of a directory.
4. **No recursive copy.** `RemoteFileCopyCommand` rejects `Recursive`
   ("directory copying is not supported"); `DisableRecursiveFileOpts` is
   `true`; `RemoteListEntriesCommand` rejects `All` ("recursive directory
   listings are not supported"). Copying a folder — local↔remote or
   remote↔remote — is impossible.
5. **Hard size limits.** Backend `RemoteFileTransferSizeLimit = 32 MB`
   (base64 → ~43 MB in memory per op), frontend upload cap 50 MB, preview
   10 MB, CSV 1 MB. A real SFTP client streams arbitrary-size files.
6. **No resume / retry on interrupted transfers.** No partial-transfer
   tracking, no byte-offset resume (the stream layer supports byte ranges but
   transfers don't use them for resume).
7. **No integrity verification** (checksum comparison after copy).

### 2. Selection & batch operations

8. **Single selection only.** The table keeps one `focusIndex`/`selectedPath`.
   No multi-select (shift/ctrl-click, rubber-band), so no batch
   delete/copy/move/download/upload of N items.
9. **No clipboard cut/copy/paste.** The core Cyberduck workflow — copy on one
   host/path, paste into another — does not exist. Transfers are only possible
   via drag-drop, which does not work between two app windows or to/from the
   OS clipboard (only OS file drop-in is supported).

### 3. Remote file metadata & operations

10. **No chmod / chown / permissions editing.** `FileInfo.Mode`/`ModeStr` are
    display-only; there is no permission RPC and no UI.
11. **No symlink awareness.** No link-target display, no follow-option, no
    create-symlink. Symlink handling is implicit `os.Stat` behavior.
12. **No owner/group columns** (uid/gid not exposed; `ModeStr` only).
13. **No "Duplicate"** operation (copy-in-place) though it's a one-liner on
    top of `FileCopyCommand`.
14. **No touch/metadata edit UI** (backend `RemoteFileTouchCommand` exists but
    is not surfaced).

### 4. Conflict resolution

15. **Minimal overwrite UX.** Copy conflicts offer only "Delete Then Copy" /
    "Sync". Missing the standard "Skip", "Rename", "Overwrite", and
    "Apply to all" choices. Uploads and moves have no conflict dialog at all
    (upload just overwrites via `Truncate: true`; move errors out if dest
    exists).

### 5. Browsing UX

16. **No clickable breadcrumb bar.** Header shows a flat path string; only a
    dropdown offers path jumps. No breadcrumb segments, no type-to-navigate
    path box.
17. **No toolbar.** Common actions (New Folder, Upload, Download, Delete,
    Refresh, New File) live only in context menus.
18. **No pagination / total count for large directories.** The normal listing
    reads all entries (`os.ReadDir`, streamed in 128-entry chunks) — it does
    *not* truncate. `MaxDirSize = 1024` is a latent cap on the recursive `All`
    path only, which is currently disabled (`DisableRecursiveFileOpts`); when
    that path is enabled it must ship with a "showing X of Y" indicator (none
    exists today) or it truncates silently. Large flat dirs (100k+ entries)
    also lack lazy loading and server-side sort.
19. **Search is client-side and shallow.** Type-to-filter only matches the
    already-loaded names; no recursive/grep search, no server-side search
    (the `FileListOpts.All` recursive path is disabled).
20. **No status bar** (item count, selection count, total size).
21. **No loading/empty states** — no spinner while listing, no "empty folder"
    message, no error-with-retry surface for listing failures beyond a toast.
22. **Bookmarks are hardcoded** (`BOOKMARKS` const) with no add/edit/remove.
23. **No persistent column layout / no column show-hide.**
24. **No trash/recycle bin** — deletes are permanent `os.RemoveAll`.

### 6. Keyboard & accessibility

25. **No Delete-key / Cmd+C / Cmd+X / Cmd+V / Cmd+A** shortcuts for file ops.
    Navigation keys exist (arrows, page, enter, backspace, Cmd+f/o/e), but
    transfer/clipboard shortcuts do not.

### 7. Architecture notes (not UI gaps, but constraints)

26. **base64 wire encoding** doubles memory/CPU and caps throughput vs raw
    SFTP binary streams.
27. **No progress RPC.** All file ops are single request/response commands;
    the stream broker could carry progress but nothing reports it.
28. **No cancellation of in-flight transfers from the UI** (timeouts only).
29. **Remote↔remote copy is proxied through the local machine** (streams into
    the local WSH process then back out), so it is neither server-side nor
    efficient for server-to-server moves.

## Recommended priority order

P0 (blocks "replace Cyberduck" claims):
- Transfer progress + queue + cancel (needs a progress RPC or streaming write).
- Recursive directory operations (upload, download, copy) — unlock `All`/`Recursive` paths.
- Multi-select + batch ops (delete/copy/move/download).
- Raise/remove the 32 MB transfer cap via streaming instead of base64-in-memory.

P1 (expected in a daily driver):
- Clipboard cut/copy/paste (local↔remote and remote↔remote).
- chmod (and optionally owner/group display).
- Symlink display + follow option.
- Conflict dialog: Skip / Rename / Overwrite / Apply-to-all.

P2 (polish / parity):
- Breadcrumb bar + toolbar + status bar.
- Favorites manager (persisted bookmarks).
- Recursive search / server-side search.
- Pagination / lazy loading / total-count indicator for large directories; revisit `MaxDirSize` when the recursive `All` path is enabled (it truncates silently if enabled as-is).
- Trash or at least delete confirmation depth.
- Preserve mtime on copy; optional checksum verify.
- Keyboard shortcuts (Cmd+C/X/V/A, Delete).

## Open questions for the implementation plan

- Progress: extend the existing stream broker with progress frames, or add a
  dedicated transfer-manager RPC? (The stream broker is the natural carrier.)
- Recursive transfer: stream a tar archive (like the streaming preview) or walk
  the tree over RPC entry-by-entry? Tar is fewer round-trips and handles
  symlinks/modes/mtimes.
- Should this stay on the WSH protocol, or is there appetite to add a real
  SFTP subsystem path for large/binary transfers?
