# Implementation Review: Disk-Backed Stream History

## Verified Against

- Spec: `.pi/specs/disk-backed-stream-history.md`

## Files Reviewed

- `pkg/jobmanager/streammanager.go` — core disk buffering implementation
- `pkg/jobmanager/cirbuf.go` — `SetTotalSize` addition
- `pkg/jobmanager/mainserverconn.go` — timeout-based `SendData`
- `pkg/jobmanager/jobmanager.go` — stale file cleanup, disconnect/reconnect integration
- `pkg/jobmanager/streammanager_test.go` — test coverage

---

## Bugs

### Bug 1 (CRITICAL): `drainRunning` atomic race — stale drain goroutine prevents new drain from starting

**Location**: `streammanager.go:176-184`

**Cause**: `ClientConnected` checks `drainRunning.Load()` to decide whether to start a new drain goroutine or update `diskReadPos` on an existing one. When the old drain goroutine is about to exit (saw `connected=false`, pending `return` + `defer drainRunning.Store(false)`), `ClientConnected` sees `Load() == true`, skips spawning a new goroutine, and only updates `diskReadPos`. The old goroutine then exits, `drainRunning` becomes `false`, but no new goroutine starts. Disk data from the client's `clientSeq` forward is never delivered.

**Impact**: Breaks Edge Case 4 (multiple reconnect cycles). Reconnected client never receives buffered data.

**Fix**: Replace `drainRunning atomic.Bool` with a `drainGen int64` generation counter. `ClientDisconnected` increments it (kills old drain). `ClientConnected` always starts a new goroutine (no gate). The drain goroutine captures its generation at start and exits on mismatch.

### Bug 2 (DESIGN): Disk buffer deactivates on catch-up, not at terminal event

**Location**: `streammanager.go:535-540`

**Cause**: `drainDiskToCirBuf` calls `deactivateDiskBuffering()` as soon as `diskReadPos >= diskEndSeq`, regardless of whether the terminal event has fired. The spec (Edge Case 13, line 475-483) says drain should run in catch-up mode for live processes and only complete when *both* `diskReadPos >= diskEndSeq` AND the terminal event is set.

**Impact**: After reconnect, once the backlog is drained to CirBuf, disk buffering is dismantled. All subsequent PTY output goes to the 64KB CirBuf directly with no disk protection. A second disconnect during the same session loses all data beyond 64KB.

**Fix**: Gate `deactivateDiskBuffering()` on `terminalEvent != nil` at both the caught-up spin path and the post-write completion path.

### Bug 3 (MEDIUM): Race — `handleReadData` writes to deactivated file descriptor

**Location**: `streammanager.go:361-383`

**Cause**: `handleReadData` captures `diskFile` under lock, releases lock, then calls `diskFile.Write(data)`. `deactivateDiskBuffering` closes the file and sets `sm.diskFile = nil` under lock during this window. If the write succeeds (fd still points to the deleted inode on Linux), `diskEndSeq` is incremented on a zombie file that will never be read.

**Impact**: Data written to a deleted file is permanently lost.

**Fix**: After the write, re-check `sm.diskFile == diskFile` under lock. If they differ, discard the write result and fall through to CirBuf instead.

### Bug 4 (LOW): Overestimated goroutine leak — actual risk is bounded (1 leaked goroutine per disconnect)

**Location**: `mainserverconn.go:45-62`, spec lines 72-79

**Analysis**: The spec warns of ~500 goroutines/second leak during sustained output under disconnect. In practice, after the first `SendData` timeout, `handleSendFailure` calls `ClientDisconnected()`, which sets `connected=false`. The `senderLoop` then blocks in `drainCond.Wait()` and makes no further `SendData` calls. So the leak is bounded to **1 goroutine per disconnect event**, not 500/s.

**Impact**: Negligible. ~5 goroutines/hour under pathological reconnect cycling.

**Fix**: No code change needed. Spec analysis was overly pessimistic.

### Bug 5 (MEDIUM): `dataInBuf` guard in `ClientConnected` prevents disk drain

**Location**: `streammanager.go:176-191` (post-round-1 fix, now removed)

**Cause**: The round-1 fix added a `dataInBuf` guard (checking `clientSeq >= headPos && clientSeq < headPos + count`) to "prevent duplicate drain when CirBuf already has data." This guard skips drain goroutine startup when `clientSeq` falls within CirBuf's current window — even when the disk has additional data beyond CirBuf. If `clientSeq < diskEndSeq` AND `dataInBuf`, no drain starts and no deactivation occurs. `readLoop` continues writing new data to disk, `senderLoop` empties CirBuf and blocks, and the remaining disk data is never delivered.

**Impact**: Client reconnects but never receives disk-buffered data beyond CirBuf's contents. Violates Edge Case 4 (multiple reconnect cycles) and can break reconnect recovery entirely.

**Fix**: Remove the `dataInBuf` guard. The drain goroutine should always start when `clientSeq < diskEndSeq`. Use `diskReadPos` (which only advances, never moves backward) to avoid re-reading already-drained data. The new logic:

```go
if sm.diskFile != nil && clientSeq < sm.diskEndSeq {
    if sm.diskReadPos < sm.diskStartSeq {
        sm.diskReadPos = sm.diskStartSeq
    }
    if clientSeq > sm.diskReadPos {
        sm.diskReadPos = clientSeq
    }
    sm.drainGen++
    go sm.drainDiskToCirBuf(sm.drainGen)
} else if sm.diskFile != nil {
    sm.deactivateDiskBuffering()
}
```

`diskReadPos` is set to `max(diskStartSeq, diskReadPos_prev, clientSeq)` — it never moves backward, preventing re-delivery of data already written to CirBuf. If the client needs data before `diskReadPos`, it either has it in CirBuf (from prior drain) or a gap will be recorded.

---

## Spec Errors

### S1: `ClientConnected` effective head formula is wrong

**Location**: `.pi/specs/disk-backed-stream-history.md:148-149`

The spec says `effectiveHead = max(headPos, diskEndSeq)`. This over-counts the gap and causes the client to drop data during drain. See Issue N1 below for details. The code correctly returns `max(headPos_after_consume, clientSeq)`.

## Design Deviations from Spec

### D1: Early deactivation overrides spec's "disk till terminal" policy

**Fixed by Bug 2 fix.**

### D2: `diskFile.Close()` while holding `sm.lock`

**Location**: `streammanager.go:550` (deactivateDiskBuffering), `streammanager.go:323` (Close), `streammanager.go:381-382` (handleReadData error path)

**Issue**: `diskFile.Close()` is called while holding `sm.lock`. On NFS or under I/O pressure this could block the lock, stalling `readLoop`/`senderLoop`/`ClientConnected`.

**Fix (round 1)**: `deactivateDiskBuffering` and `Close()` spawn goroutines for close+remove. **However**, the `handleReadData` error path (ENOSPC fallback) still called `Close()` under the lock — claim that it was moved to a goroutine was inaccurate.

**Fix (round 2)**: `handleReadData` error path now also uses a goroutine for `diskFile.Close()` + `os.Remove(diskPath)`. The local `diskFile` variable (captured before the lock) is used for the close call, so the lock can be released before blocking I/O.

---

## Gaps

### Gap 1: Missing test coverage (partially addressed)

| Test | Status |
|------|--------|
| Live-process drain catch-up (no terminal event) | ✅ `TestDrainDoesNotCompleteWithoutTerminalEvent` |
| Drain completes after terminal event injected | ✅ `TestDrainCompletesWhenTerminalEventArrives` |
| Generation counter kills stale goroutines | ✅ `TestDrainGenKillsOldGoroutineOnReconnect` |
| Write to deactivated file → CirBuf fallthrough | ✅ `TestHandleReadDataPostWriteIdentityCheck` |
| Send timeout triggers handleSendFailure | ✅ `TestSendTimeoutFiresHandleSendFailure` |
| Disk write error → fallback to CirBuf | ✅ `TestDiskWriteFallbackOnWriteError` (round 2: replaced no-op test) |
| Drain starts when clientSeq in CirBuf, disk has more data | ✅ `TestDrainStartedWhenClientSeqWithinCirBufAndDiskHasMore` (round 2) |
| Multiple reconnect cycles (Edge Case 4) | Still missing |
| `disconnectFromStreamHelper` + `activateDiskBuffering` integration | Still missing |

### Gap 2: `clientSeq` ahead of CirBuf with no drain

**Analysis**: Cannot happen in practice because `diskEndSeq > 0` implies `diskFile != nil` (the guard in `activateDiskBuffering` sets `diskEndSeq = totalSize` and `diskFile` atomically). No fix needed.

### Gap 3: No max disk file size guard

The disk file grows unbounded during long disconnects. A runaway process could exhaust the remote disk. The spec acknowledges this as out-of-scope.

### Gap 4: `drainCond` wake-spin during disconnect

`handleReadData` calls `drainCond.Signal()` on every disk write. During disconnect, `senderLoop` wakes, finds `!connected`, and blocks again. This creates a signal/wake cycle per disk write. At typical PTY rates (~100 writes/s) this is negligible, but a high-throughput process could cause excess scheduler overhead.

---

## Additional Findings

### F1: `drainCond.Signal()` missing from `activateDiskBuffering`

`activateDiskBuffering` updates `diskEndSeq` but doesn't signal `drainCond`. However, `ClientDisconnected` already signals `drainCond` before `activateDiskBuffering` is called, and `handleSendFailure` calls `ClientDisconnected` first. `disconnectFromStreamHelper` also calls `ClientDisconnected` then `activateDiskBuffering` — the signal already happened. The `ClientConnected` path also signals. Non-issue.

### F2: `handleReadData` fallthrough path in connected mode

When `diskFile == nil` and data is written to CirBuf in sync mode (connected), `WriteAvailable` may block. This is correct — flow control is working as designed.

---

## Fixes Applied — Round 1 (2025-07-01)

### Bug 1 — drainRunning race → drainGen generation counter

- Replaced `drainRunning atomic.Bool` with `drainGen int64`
- `ClientDisconnected` increments `drainGen` to kill running drain goroutines
- `drainDiskToCirBuf` accepts a `myGen int64` parameter and exits when `drainGen != myGen`
- `ClientConnected` always starts a new drain goroutine (no gate), each with a unique generation
- Removed `sync/atomic` import

### Bug 2 — Deactivation gated on terminal event

- `drainDiskToCirBuf` now only calls `deactivateDiskBuffering()` when **both** `terminalEvent != nil` and `diskReadPos >= diskEndSeq`
- Live processes: drain spins in catch-up mode (10ms sleep) when caught up
- Exited processes: drain completes and deactivates disk as soon as all data is drained

### Bug 3 — Post-write `diskFile` identity check

- `handleReadData`: after `diskFile.Write()`, re-checks `sm.diskFile == diskFile` under lock
- If the file was deactivated between capture and write, discards the result and falls through to CirBuf

### D2 — Partial: Moved `diskFile.Close()` out of lock

- `deactivateDiskBuffering`: spawns a goroutine for `diskFile.Close()` + `os.Remove()` instead of doing it under lock
- `Close()`: same pattern — goroutine for close+remove
- `handleReadData` error path: **NOT moved — Close() remained under lock** (fixed in round 2)

### ClientConnected drain start guard (BUGGY — reverted in round 2)

- Added `dataInBuf` check: only starts drain when `clientSeq` is NOT already in CirBuf
- **Introduced Bug 5**: prevented drain when CirBuf had partial data

### New tests (round 1)

| Test | What it verifies |
|------|-----------------|
| `TestDrainDoesNotCompleteWithoutTerminalEvent` | Drain spins in catch-up for live process |
| `TestDrainCompletesWhenTerminalEventArrives` | Drain completes after terminal event injected |
| `TestDrainGenKillsOldGoroutineOnReconnect` | Generation counter kills stale goroutines |
| `TestHandleReadDataPostWriteIdentityCheck` | Race: write to deactivated file → CirBuf fallthrough |
| `TestSendTimeoutFiresHandleSendFailure` | Real `DataSender` timeout triggers disconnect |

---

## Fixes Applied — Round 2 (2025-07-01)

### Bug 5 — Removed `dataInBuf` guard, fixed `diskReadPos` logic

- Removed the `dataInBuf` guard in `ClientConnected` that prevented drain goroutine startup
- Changed `diskReadPos` update logic to never move backward: `diskReadPos = max(diskStartSeq, diskReadPos_prev, clientSeq)`
- This prevents re-delivering already-drained data while ensuring drain always starts when disk data exists that the client hasn't seen

### D2 (complete) — `handleReadData` error path Close() moved out of lock

- Changed the ENOSPC/error fallback path in `handleReadData` to use a goroutine for both `diskFile.Close()` and `os.Remove(diskPath)`
- Uses the local `diskFile` variable (captured before the lock) so the lock is released before any blocking I/O

### Test fixes

- `TestDiskWriteFallbackOnWriteError`: replaced the no-op `TestDiskWriteFallbackOnENOSPC` with a genuine test that closes the file descriptor before writing, verifying diskEndSeq not incremented, diskFile nil'd, data falls through to CirBuf, and disk file cleaned up
- `TestDrainStartedWhenClientSeqWithinCirBufAndDiskHasMore`: verifies that when `clientSeq` is within CirBuf's range but disk has more data, a drain goroutine starts and `diskReadPos` is not moved backward

### Version bump

`node version.cjs patch` → 0.15.3

---

## Fixes Applied — Round 3 (2025-07-01)

### Issue N1: Spec error — `ClientConnected` effective head formula

**Location**: `.pi/specs/disk-backed-stream-history.md:148-149`

The spec says `effectiveHead = max(headPos, diskEndSeq)` and returns that as `serverSeq`. The code returns `max(headPos_after_consume, clientSeq)` (`streammanager.go:171-174`).

The spec's formula over-counts the gap. If `clientSeq=100`, `diskEndSeq=200`, the spec returns 200. The client sees gap=100 and sets `expectedNextSeq=200` — then drops all drained data starting at `seq=100` because `100 < 200`. The code returns 100, correctly yielding gap=0 for a client with `clientSeq=100` that just needs disk data from 100→200.

**Status**: **CODE IS CORRECT. SPEC IS WRONG.** The spec's Part C reconnect flow diagram should say `effectiveHead = max(headPos_after_consume, clientSeq)`.

### Issue N2: Theoretical duplication — drain goroutine generation check after `WriteAvailable`

**Location**: `streammanager.go:517-540`

The inner write loop in `drainDiskToCirBuf` checks `stillConnected` BEFORE `WriteAvailable` but checks `drainGen` only AFTER the write. If `drainGen` is incremented between the `stillConnected` snapshot and `WriteAvailable`, the old drain goroutine writes data to CirBuf but does NOT advance `diskReadPos`. A new drain goroutine starting from the old `diskReadPos` re-reads the same bytes from disk and writes them again, producing CirBuf data with incorrect Seq values (the same bytes appear at two different absolute positions in the stream).

**Window size**: Extremely narrow — `ClientConnected`/`ClientDisconnected` hold `sm.lock` while changing `drainGen`, and the goroutine re-checks `connected` on each inner-loop iteration. In practice `ClientDisconnected` → `ClientConnected` happen within a single lock-held block in `connectToStreamHelper_withlock`, so no interleaving.

**Mitigation**: Read `drainGen` into the same lock-section snapshot as `connected` at the top of the inner loop, and guard the write body with `generation == myGen` (same pattern as the `connected` guard). Then the old goroutine exits at the guard instead of after `WriteAvailable`.

**Status**: Unfixed. Low urgency — the window is a single inner-loop iteration between `stillConnected` check and `WriteAvailable`.

### Issue N3: `drainDiskToCirBuf` doesn't check `closed`

**Location**: `streammanager.go:469-551`

`Close()` sets `closed=true` but doesn't set `connected=false`. The drain goroutine only checks `connected` and `generation` — it doesn't check `closed`. If `Close()` is called while connected, the drain goroutine continues running and performing `ReadAt` on a file descriptor that a goroutine spawned by `Close()` is about to or has already closed. The `ReadAt` eventually fails (returns an error or `os.ErrClosed`), which is handled by the error path at line 506-508 (log and return).

**Impact**: Negligible — this is the shutdown path. No data corruption, no goroutine leak. The drain goroutine exits gracefully on the next `ReadAt` error.

**Status**: Unfixed. Acceptable for shutdown path.

### Issue N4: `senderLoop` wake-spin on `drainCond.Signal()` during disconnect

**Location**: `streammanager.go:385`

During disconnect, `handleReadData` writes to disk and calls `drainCond.Signal()` on every write cycle. Meanwhile `senderLoop` is in `drainCond.Wait()` (line 607, `!connected` path). Each signal wakes `senderLoop`, which re-checks `connected` (still false), re-acquires lock, and re-enters `Wait()`. At typical PTY rates (~100 writes/s) this is negligible. A high-throughput process (e.g. `cat /dev/zero`) could cause excess scheduler overhead from the signal/wake cycle.

**Mitigation**: Gate the `drainCond.Signal()` in the disk write path on `sm.connected`:

```go
// Currently:
sm.diskEndSeq += int64(n)
sm.drainCond.Signal()  // always signals

// Better:
sm.diskEndSeq += int64(n)
if sm.connected {
    sm.drainCond.Signal()
}
```

The `drainCond.Signal()` in the CirBuf fallthrough path (line 398) already has natural rate-limiting because `WriteAvailable` in sync mode blocks when window is full — so writes happen at senderLoop drain rate, not at raw PTY rate.

**Status**: Unfixed. Low impact.

### Issue N5: Corked reconnect with no disk file

**Location**: `streammanager.go:118-193`, `jobmanager.go:341-343`

When `ClientConnected` is called with `rwndSize=0` (corked reconnect from `PrepareConnect`) and `diskFile == nil` (no disk data — initial connect or post-drain reconnect), the CirBuf enters sync mode with effective-window=0. Neither `readLoop` nor any drain goroutine writes to CirBuf. The `senderLoop` wakes, sees `available=0` and `diskFile==nil`, and may send a terminal packet if one is ready. If no terminal event and no disk data, `senderLoop` blocks in `drainCond.Wait()` until `StartStream` uncorks.

This works correctly, but the spec's reconnect flow diagram doesn't explicitly mention the `diskFile == nil` case during corked reconnect. The client-side stays corked until `StartStream` sets the real `rwnd`, and `readLoop` resumes writing directly to CirBuf once uncorked.

**Status**: Not a bug — correct behavior, spec documentation gap only.

### New test gaps identified (round 3)

| Gap | Description |
|-----|-------------|
| Generation guard before `WriteAvailable` | Test race: gen changes between connected snapshot and Write, verifies no duplicate CirBuf data |
| Corked → uncorked drain awakening | Full test: cork `ClientConnected`, verify drain blocks on `WriteAvailable`, uncork via `SetRwndSize`, verify drain proceeds |
| `senderLoop` wake-spin during disconnect | Performance test: verify `drainCond.Signal()` not called unnecessarily during disconnected mode |
| `Close()` concurrent with drain | Verify drain goroutine exits gracefully when `Close()` is called mid-drain |
