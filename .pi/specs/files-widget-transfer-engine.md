# Files Widget — Transfer Engine (Phase 2)

Date: 2026-08-16
Branch: `feat/files-widget`
Status: design (no code yet)
Depends on: gap analysis in `files-widget-sftp-gap-analysis.md`, ADR in `../decisions.md#2026-08-16`

## Goals

- Remove the 32 MB whole-file transfer cap (upload/write path).
- Support **recursive** upload, download, and copy (directories + multi-file batches).
- Give the user **visible progress, speed, phase, and cancel** for every transfer.
- Make **bulk/archive transfers legible** as a single operation, distinct from
  scp-style file-by-file transfer (see "Transparency" below).

## Non-goals (this phase)

- SSH channel compression (deferred — see ADR).
- Binary wire framing (still base64-in-JSON over the stream broker).
- Server-side remote↔remote copy (still proxied through the local box).
- Transfer resume after cancel/disconnect (later).
- chmod/chown, symlink *creation*, checksum verify (Phase 4).

## Transport decisions (summary)

| Concern | Decision |
|---------|----------|
| Wire transport | Existing stream broker (`pkg/streamclient/`), chunked + ACK flow-control. No total-size limit. |
| Compression | **tar.gz at the application layer**, only for archive/bulk transfers. |
| Recursive mechanism | tar archive of the tree (handles modes/mtimes/symlinks/dirs in one stream). |
| Progress | Derived from `Writer.GetAckState()` (bytes acked) on the sending side, bytes-read on the receiving side. |
| Cancel | `Writer.GetCanceledChan()` / `Reader.Close()` — cancels the stream; receiver deletes the partial output. |
| Throughput tuning | Raise receive window (256 KB → configurable, default ~4 MB); larger chunks. |

## Transfer paths

| Path | Today | Target |
|------|-------|--------|
| Upload (local→remote) | frontend reads whole file → base64 → `FileWriteCommand` (32 MB cap, no progress) | Electron streams file to Go server → Go streams to remote via stream broker → remote writes temp file + atomic rename |
| Download (remote→local) | Electron `downloadURL` (streams, no in-app progress) | Go server pulls stream broker → serves HTTP; transfer manager tracks bytes + speed + cancel |
| Remote↔remote copy | local WSH proxies `io.Copy` over stream broker (legacy 32 MB check) | same stream-broker proxy, minus the 32 MB check; archive path for directories |
| Recursive (any direction) | unsupported (`DisableRecursiveFileOpts`) | tar.gz stream of the tree, extract on the destination |

### New/changed RPC surface

- `RemoteFilePutStreamCommand` (inverse of `RemoteFileStreamCommand`): remote
  receives stream chunks and writes to a destination path (temp + rename), so
  the whole-file base64 `FileWriteCommand` is no longer the upload path.
- Extend `RemoteFileCopyCommand` to accept `Recursive` and stream a tar.gz when
  the source is a directory (or multi-file batch).
- Progress + phase events to the frontend (see "Progress & cancellation").

## Progress & cancellation

- The Go transfer goroutine owns a `TransferState` (phase, bytesDone, bytesTotal,
  speed, error) and publishes it to the frontend via a lightweight RPC/event
  (`settransferstate` or a per-transfer stream).
- **Determinate vs indeterminate total:** if we pre-archive to a temp file we
  know `bytesTotal` upfront (determinate bar); if we stream-compress on the fly
  the total is unknown until the stream ends (indeterminate bar).
- Cancel closes the stream; the receiver deletes the partial temp file so no
  half-written file is left in the destination.

## Transfer manager UI (the "how the user knows" part)

A queue surfaced in the files widget (footer panel or side list) — **not** just
the existing `UploadOverlay` spinner, which stays as the single-file stopgap.

Each transfer entry shows:

1. **Kind label** — distinguishes the mental model explicitly:
   - `Upload folder · 1,234 files · 3.2 GB` (archive/bulk)
   - `Upload file · report.pdf · 4.1 MB` (single)
   - `Download folder · 856 files · 1.1 GB`
   - `Copy 12 items · 40 MB` (batch)
2. **Phase** — for archive transfers: `Preparing archive…` → `Transferring…`
   (with progress bar + speed + ETA) → `Extracting…` (file counter).
   Single-file transfers show a plain byte progress bar.
3. **Progress** — bytes + percentage + speed + ETA where total is known.
4. **Cancel** button per entry.
5. **Completion state** — success (✓) or failure (✗ + error), retained briefly
   so users can see the outcome of a queue.

### Why this addresses the scp-misread problem

The user's concern is that a tar.gz stream makes the destination fill up as a
single "pop" (or in archive order) rather than file-by-file as scp does. The
mitigation is **explicit phase labeling**: the entry announces *up front* that
this is a bulk archive operation ("Upload folder · N files"), and the
`Extracting…` phase shows a file counter so the user sees files materializing as
a consequence of extraction, not one-at-a-time transfer. No scp-style
expectation is left ambiguous.

### Archive strategy (resolved: hybrid)

Pre-archive to a temp tar.gz when the tree crosses **either** threshold
(OR-trigger):

- `totalSize > sizeThreshold` (default ~64 MB) — network-bound cost.
- `fileCount > fileCountThreshold` (default ~1,000 files) — archive/extract
  syscall cost (stat/open/close per file), which size alone under-predicts
  (e.g. `node_modules`-shaped trees).

Above either threshold the transfer bar is determinate (compressed size is
known); below both, stream-compress on the fly (no temp file, faster start,
indeterminate bar). Both thresholds are configurable. File count is free to
measure — it is counted during the tree walk we already perform to tar.

## Phase breakdown

1. **Streaming write path** — `RemoteFilePutStreamCommand`; upload of single
   files with no size cap; progress + cancel. (Unblocks the cap.)
2. **tar.gz recursive engine** — tar/untar + gzip on the Go side; recursive
   upload/download/copy; stream-extract on destination.
3. **Transfer manager** — queue UI, phase/progress/speed/cancel, transparency
   labeling (the UX above).
4. **Window/chunk tuning** — configurable receive window + chunk size; measure
   throughput on a high-latency link.

## Test cases

### Streaming write path (Go unit tests)

- **Happy path:** write a 64 MB file through the stream broker → file lands
  byte-identical (checksum) — proves the 32 MB cap is gone. Use `t.TempDir()`
  for source/dest.
- **Cancel mid-stream:** cancel after N chunks → destination temp file removed,
  no partial file left at final path.
- **Stream error:** remote returns error after M chunks → writer surfaces it,
  receiver cleans up.
- **Flow control:** writer blocks when the receive window is full and resumes
  after ACKs (existing `streambroker_test.go`/`stream_test.go` patterns).

### tar.gz recursive engine (Go unit tests)

- **Round-trip:** tar a tree (nested dirs, symlink, empty dir, unicode/spaced
  names, +x mode) → untar → tree identical (walk + compare). Symlink recreated
  as symlink, not followed.
- **Empty directory:** archive of an empty dir extracts to an empty dir.
- **Single already-compressed file:** gzip level 0 path (or tar-without-gzip)
  skips compression — no wasted CPU.
- **Large file in tree:** >32 MB file inside a directory round-trips.
- **Hybrid threshold:** a tree above the size threshold OR the file-count
  threshold is pre-archived (determinate `bytesTotal` == archive size); a tree
  below both streams without a temp file. Verify the file-count trigger fires
  for a many-small-files tree whose total size is under the size threshold.
- **Destination conflict:** extract onto existing files honors overwrite/skip
  (ties into the conflict dialog, Phase 3).

### Progress & cancellation (integration)

- **Determinate progress:** pre-archive path reports bytesTotal == archive size;
  progress reaches 100% at stream end.
- **Speed/ETA:** with a throttled reader, speed is sane and ETA decreases.
- **Cancel propagation:** cancel from frontend → stream closes → partial output
  removed → entry shows ✗.

### Transfer manager (frontend)

- **Labeling:** an archive upload renders `Upload folder · N files · size` and
  walks `Preparing → Transferring → Extracting`; a single-file upload renders
  `Upload file · name · size` with no archive phases.
- **Queue:** 3 concurrent entries render independently; canceling one does not
  affect the others.
- **Completion:** success shows ✓, failure shows ✗ + error, both persist for the
  configured retention window.

### Manual smoke test

- Drop a folder onto a remote directory → verify `Preparing/Transferring/
  Extracting` phases, file counter during extraction, and all files present
  after completion (including hidden files, respecting the show-hidden toggle).

## Deferred to later phases

- Conflict dialog (Skip / Rename / Overwrite / Apply-to-all) — Phase 3.
- Resume after disconnect — post-Phase 2.
- Binary framing, SSH compression, server-side copy — revisit after profiling.
- **Directory-browser pagination (note):** the normal listing reads all entries
  (no 1024 cap — `os.ReadDir` + 128-entry chunked streaming). `MaxDirSize = 1024`
  is a latent cap on the *disabled* recursive `All` path; when that path is
  enabled it must add a "showing X of Y" / pagination indicator or it truncates
  silently. Relevant to bulk transfer because a user can only select what the
  browser can show.
