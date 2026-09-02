# Files Widget — Large Transfers

Follow-up to [[files-widget-qa-fixes.md]] Phase 6. Chunked uploads removed the transport bottlenecks (5MB WS cap, per-RPC size checks); this spec removes the remaining limits around large uploads/downloads. Target: **5GB uploads by default**, configurable.

## Design decisions

1. **Streaming chunk reads (not bigger buffers)** — read each chunk lazily via `File.slice(off, off+len).arrayBuffer()`. Peak memory becomes ~one chunk (~3MB × small factor) regardless of file size.
2. **Chunk size 3MB** (~4MB base64, safely under the 5MB WS send cap) — cuts WAN round-trip overhead by a third vs 2MB (512→342 round trips per GB).
3. **Cancellation is immediate, not timeout-bound**: each chunk RPC is raced against the cancellation signal (`Promise.race`). On cancel, the loop throws immediately (the in-flight append may still land server-side; the partial-file cleanup deletes it right after). The per-chunk timeout is therefore only a stall backstop, not the cancel mechanism.
4. **Per-chunk timeout 120s + single retry + stat reconciliation**: a failed chunk is retried once. If the retry also fails, `FileStatCommand` the destination: if remote size == bytes sent so far, treat the chunk as delivered and continue (lost-ACK case); otherwise fail cleanly ("upload interrupted at N%") — positional resume is impossible because existing RPCs force either Truncate (write) or O_APPEND (append), and re-sending over O_APPEND risks silent duplication. Never corrupt: when in doubt, fail.
5. **Cap = 5GB default, user-configurable** — new setting key `files.maxuploadsize` (bytes) read from `fullConfigAtom` with 5GB fallback. Validate positive integer (floor 3MB, ceiling e.g. 100GB) with fallback to default on garbage.
6. **Download progress via `will-download`** — emain hooks `session.on("will-download")`, forwards progress/completion events to the renderer (implementer picks cheapest safe channel), replacing the 4s heuristic with real % and terminal states.
7. Wire traffic note: base64 inflates transfers 1.33× (5GB → ~6.65GB on the wire). Accepted; binary transport stays on the far backlog.

## Build Order

### Phase 1 — Streaming chunk reads + 3MB chunks
- Rewrite the upload loop in `uploadFiles` to slice the `File` per chunk instead of one whole-file `arrayBuffer()`.
- Bump `UploadChunkSize` to 3MB.
- Add upload-speed readout (bytes/sec computed from chunk timestamps) to the progress banner.
- Keep sequential append semantics identical (first chunk write/truncate, rest append). No server changes.
- Unit tests: slicing wrapper with a mock Blob/File; speed computation helper.

### Phase 2 — Upload cancellation (immediate)
- Cancellation signal stored per upload run on PreviewModel; checked between chunks AND raced against each in-flight chunk RPC (`Promise.race`) so cancel takes effect in milliseconds even during a stalled chunk.
- Cancel button on the `dir-transfer-banner` while uploading.
- On cancel: stop, best-effort `FileDeleteCommand` the partial destination, set a transient "Upload cancelled" status, clear progress atom.
- Unit tests: token/race helper behavior (cancel-before-start / mid-chunk / after-completion no-ops).

### Phase 3 — Cap to 5GB, configurable
- Replace hardcoded `MaxUploadSize = 50MB` with `files.maxuploadsize` config lookup (fallback 5GB).
- Validate config value (positive integer; floor 3MB, ceiling 100GB) with fallback to default on garbage.
- Surface the effective cap in the too-large error message ("exceeds 5GB size limit").
- Unit tests: config resolution helper (valid/garbage/missing values).

### Phase 4 — Chunk timeout, retry, reconciliation
- Explicit per-chunk RPC timeout (120s) instead of library default.
- On chunk failure: one automatic retry; on second failure, `FileStatCommand` the destination — remote size == sent-bytes → continue (lost ACK); otherwise fail cleanly ("Upload interrupted at N%") without deleting the partial (user may retry the whole upload).
- Distinguish cancelled vs failed vs completed terminal states in the progress banner.
- Unit tests: reconciliation decision helper (sizes equal / short / long).

### Phase 5 — Real download progress
- emain: hook `will-download`; forward started/progress/done/cancelled events (item filename + bytes) to the requesting webContents.
- Renderer: consume events into `downloadProgress` atom ({sent, total} when determinate); banner shows % and terminal state; remove the 4s auto-clear heuristic.
- Keep the context-menu download flow unchanged otherwise.

## Constraints

- No new npm deps. No wsh RPC changes (no version bump). Go untouched except none expected.
- Tests run in CI only; `go build ./...` available via `/home/mimo-code/project/waveterm-remote/golang-1.26.2/bin/go` if needed (not expected).
- Never run `git push`.

## Deferred (explicitly out of scope)

- Base64-in-JSON transport replacement (streaming binary protocol) — architectural, revisit if multi-GB uploads become common.
- Directory drag-out to OS (needs recursive temp materialization).
