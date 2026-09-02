# Stream Gap on Reconnect — 55-Byte Loss Diagnosis & Fix Spec

**Status:** Draft — not implemented. **Revised 2026-08-24** after full log review: v1 misdiagnosed the incident mechanism (see below). The proposed race fix is retained — it targets a real secondary hazard — but the incident itself was a **process-restart loss**, which that fix cannot prevent.
**Date:** 2026-08-25 (v1), revised 2026-08-24
**Build:** 0.17.0 (includes `22bfc8a9` data-path retry + `9cbb88bf` streamstatusreport)
**Related:** [[stream-data-path-resilience.md]] (A1/B2 predecessor work), `.pi/stream-freeze-diagnosis.md` (on `odds-and-ends`)

## Incident (reconstructed from `waveapp copy.log`)

One mimo-code terminal block showed:

```
[stream gap: 55 bytes lost - terminal state reset]
```

Job `70353a96` / block `319061ab` / conn `mimo-code@192.168.100.164`. Verified timeline (log line numbers from the user's copy):

| Time | Event |
|---|---|
| 20:15:30 | Job started, stream `2adc37ff`, output loop running (L455) |
| 20:19–20:28 | 4 ACK timeout+recovery pairs on this stream (A1 retry), seqs 350270, 540872, 1838684, 2971656 (L568…949). 18 pairs across all streams in the surviving copy, **all recovered** — no dropped ACKs |
| 20:31:18 | streamhealth: loop active, `totalBytes=4065611` (L990); loop keeps reading afterwards (fileSize reaches 4706530, ~641 KB more, no errors logged) |
| **20:40:49.7** | **Old process: `shutting down: got signal interrupt` (L1114)** → `doShutdown` runs → `shutdown complete` 20:40:50.2 (L1127). Graceful — but `doShutdown` does **not** drain `jobReaders` |
| **20:41:19.3** | **New process cold-starts: `wave version: 0.17.0 (202608241254)` (L1141)** — the build-to-build app restart. All in-memory stream state (`jobReaders`, `jobStreamHealth`, `jobStreamIds`) is empty |
| 20:41:34 | Startup reconcile **skips this job**: conn `mimo-code@192.168.100.164` still flapping (L1934) |
| 20:44:31 | Two other jobs on this conn reconnect (conn briefly up) |
| 20:45:26.241 | Conn reconnects (ConnectCount 24, ReconnectAttempt 2) → sweep finds 3 jobs |
| 20:45:26.297 | `restartStreaming`: `sending JobPrepareConnectCommand with seq=4706530 (fileSize=4706530, totalGap=0)` (L2892) |
| 20:45:26.303 | `detected gap: our seq=4706530, server seq=4706585, gap=55, new totalGap=55` (L2896) → marker injected |
| 20:45:46.877 | User clicks **Reconnect Stream** (L2935): old stream superseded cleanly (`totalBytes=0`, idle shell), `seq=4706585 (fileSize=4706530, totalGap=55)`, **no new gap** (L2938) |

The prior freeze-case job `4db086dd` reconnected cleanly in the same sweep (92 MB, `totalGap=0`, L2893–2899) — its reader buffer happened to be fully consumed by its output loop at process death.

## Root cause (this incident): acked-but-unwritten bytes destroyed at process restart

The remote cannot be the source of the hole: `headPos` advances only via `Consume` from `RecvAck` (streammanager.go:380) or from `ClientConnected`'s clientSeq-ahead branch (:207–221), and the latter is capped by the client's own reported position. Server seq (4706585) > client seq (4706530) therefore proves the 55 bytes were **ACKed and consumed remotely** but never written to the term file. Loss is client-side, between "ACKed" and "appended".

The mechanism:

1. `Reader.RecvData` buffers incoming bytes and **ACKs on arrival** (streamreader.go:84), before `runOutputLoop` ever `Read()`s them. So the client-side invariant is `acked ⊆ buffered-or-persisted` — **not** `acked ⊆ persisted`.
2. A1 retry made those tail ACKs reliable through the congestion episode, so the remote consumed the bytes. Consumed bytes leave the CirBuf for good; replay (`ClientDisconnected` resets only *unacked* accounting) cannot cover them.
3. At 20:40:49 the app restarted for the build update. `doShutdown` (cmd/server/main-server.go:63) stops block controllers and calls `WFS.FlushCache`, but **never drains `jobReaders`** (note the existing `TODO deal with flush in progress` at :69). The 55 bytes sitting in reader `2adc37ff`'s in-memory buffer died with the process.
4. In the new process, `restartStreaming` found `jobReaders` empty → `prevReaderOk=false` → **no pre-drain, no Close, no race**. It computed `currentSeq=4706530`, the remote's `ClientConnected` returned `startSeq=headPos=4706585` (clientSeq < headPos → no consume; streammanager.go:238–241), and the gap path correctly detected and honestly reported a hole that had existed since the process died ~4.5 minutes earlier.

Evidence this was **not** a live supersession race:

- The old `runOutputLoop` never logged `output loop finished` — it died with the old process. (Contrast L2936–2937: the 20:45:46 manual reconnect logs both the supersession line and the finish line for stream `16da6501`.)
- The route-up event at 20:45:26.297 read `jobStreamHealth` and printed `(stream active=false, streamId="")` (L2891) — no entry existed. Nothing in-process deletes or blanks that map; only a fresh process explains the empty entry.
- No `error appending data to WaveFS` for this job anywhere (rules out the append-failure path); no `adjusted stream seq` or `did not exit` warnings.

The gap marker did its job: the loss was real, the terminal resynced, accounting absorbed it into `totalGap`, and the manual reconnect 20 s later confirmed stability (no repeat).

## Secondary hazard (verified in code, still unfixed): the T0→T3 supersession race

v1's race analysis is **real but did not occur in this incident**. It applies when the old stream is still delivering while `restartStreaming` supersedes it — i.e. the **manual `RestartBlockStream` path** (the remote keeps streaming on the old streamId until `JobPrepareConnectCommand` → `connectToStreamHelper` → `ClientDisconnected`, jobmanager.go:193–203 — which lands *after* the old reader is closed), and fast same-process reconnects where the remote hasn't yet noticed the route drop.

```
pkg/jobcontroller/jobcontroller.go, restartStreaming:

T0  prevReader.DrainBuffered() → handleAppendJobFile      // rescue buffered bytes (:2292)
T1  WFS.Stat → currentSeq = fileSize + totalGap           // snapshot after drain (:2303)
T2  CreateStreamReaderWithSeq(startSeq=currentSeq)        // (:2317)
    jobStreamIds.Set(jobId, newId)                        // (:2318)
T3  prevReader.Close()                                    // (:2327)
        ⚡ RACE WINDOW (T0 … T3): old reader still alive and receiving.
        • RecvData buffers incoming bytes AND ACKs them on arrival.
        • If the old runOutputLoop Read()s them before T3 → appended
          (append happens before the supersession check, :1791–1808) →
          caught by the waitForStreamLoopExit + re-stat adjustment ✓
        • If Close() lands first → Read() returns io.ErrClosedPipe
          WITHOUT draining the buffer (streamreader.go:175–177) → the loop
          exits via the SUPERSESSION path (:1809–1812, checked before the
          error branch; jobStreamIds moved on at T2) → bytes are acked +
          consumed remotely but never written locally ✗
T4  waitForStreamLoopExit(oldStreamId, 1s); re-stat; adjust currentSeq (:2336–2345)
    ← catches case ✓, cannot recover case ✗
```

`Reader.DrainBuffered()` exists for exactly this hazard and works after `Close()` (`TestDrainBufferedAfterClose`), but is only called at T0.

Same-process connection-drop reconnects are mostly safe from this race: the route death triggers the remote's `disconnectFromStreamHelper` (jobmanager.go:452 defer) → `ClientDisconnected` → the old stream stops delivering, and the T0 pre-drain catches whatever was buffered pre-drop. The race needs **live delivery during T0→T3**.

## Fix A (proposed): post-close drain in `restartStreaming`

In `restartStreaming`, after `waitForStreamLoopExit`, add a second drain **before** the existing re-stat/adjust block:

```go
waitForStreamLoopExit(jobId, oldStreamId, 1*time.Second)

// Post-close drain: bytes that arrived (and were ACKed) between the pre-drain
// and Close(), and lost the Read-vs-Close race, are still in prevReader's
// buffer. DrainBuffered works after Close (TestDrainBufferedAfterClose).
if prevReaderOk {
    if drained := prevReader.DrainBuffered(); len(drained) > 0 {
        log.Printf("[job:%s] post-close drain recovered %d buffered byte(s)", jobId, len(drained))
        appendErr := handleAppendJobFile(ctx, jobId, JobOutputFileName, drained)
        ...
    }
}

waveFile2, statErr2 := filestore.WFS.Stat(...)   // existing re-stat / adjust
```

Properties:

- Closes the race completely: any byte either (a) was read+appended pre-close (covered by wait/re-stat), or (b) sat in the buffer at close (recovered post-close). No double-append: `Read` removes bytes from the buffer, so the drain only returns what was never read.
- No protocol change, no version bump (client-side only — safe for mixed old-remote/new-client fleets).
- Order matters: post-drain must run **before** the re-stat so recovered bytes count toward `currentSeq`.
- **Scope limit: this fix would NOT have prevented the incident** — with `prevReaderOk=false` after a process restart there is nothing to drain. It targets the supersession race only.
- Placement (v1 open question 1, answered): inside `restartStreaming` — both restart paths funnel through it (`RestartBlockStream` :2240, `ReconnectJob` :2149); the initial `StartJob` path has no prevReader. A `jobReaders` teardown helper is moot for the restart class: no teardown runs at process death.
- Marker copy (v1 open question 2, answered): unchanged — keep the muted marker purely as the failure signal; recovered-byte counts go to the log only.

## Fix options for the restart class (DECISION REQUIRED)

The incident's actual class — acked-but-unwritten bytes lost when the client process exits — needs a separate decision:

- **B1 — ACK-after-append (complete fix, follow-up spec).** Grant ACK seq credit only after `handleAppendJobFile` succeeds, so ACK means "persisted". The remote then replays tail bytes after any client-side loss (restart, crash, update). Still client-side behavior only (no RPC format change; old remotes unaffected), but it redefines flow-control semantics: `sendAckLocked` call sites (RecvData :84, Read :190–202, Close :242) and rwnd accounting need redesign (rwnd already shrinks as the buffer grows, so backpressure survives; EOF/Fin and Cancel ack semantics need care). Defer to its own spec.
- **B2 — shutdown drain (cheap, partial).** In `doShutdown`, before `WFS.FlushCache`: iterate `jobReaders`, `DrainBuffered` → `handleAppendJobFile`. Would have saved these exact 55 bytes — this shutdown was graceful (SIGINT). Does nothing for crash / kill -9 / power loss. ~20 LoC, client-side only.
- **B3 — accept-and-document.** The marker already does the right thing (resync + honest accounting, no repeat). Document that app updates/restarts with actively-repainting TUIs can produce small gap markers.
- **Telemetry (regardless of choice).** When a gap is detected, log whether a previous reader existed: `prevReader=true` (supersession class) vs `prevReader=false — likely process-restart buffer loss`. This incident required reconstructing process history to classify; one log line settles it next time.

Recommendation: **Fix A + telemetry + B2** now (small, covers the update/quit path that actually occurred); pursue B1 only if gap markers remain frequent after that.

## Why it surfaced now (revised)

- The loss class **predates A1/B2**: ack-on-arrival has always made `acked ⊄ persisted`; any restart with a non-empty reader buffer could produce it.
- A1's real contribution is **ACK reliability**, not supersession reachability (v1's narrative — disproven by the log: there was no live supersession). Pre-A1, congestion could drop/timeout the tail ACK → the remote never consumed the bytes → replay after reconnect → no gap. Post-A1, the ACK gets through → consumed → a restart converts "buffered" into "lost". Consistent with the incident: all 4 of this stream's ACK timeouts recovered.
- What the restart did was make the loss **visible and permanent** on a build where streams otherwise survive congestion.

## Residual risks (corrected)

1. **Restart class remains first-class** unless B1 or B2 lands. App updates are this fork's distribution model — expect a small gap marker whenever the app restarts while a TUI is mid-repaint. (v1's claim that the marker becomes near-unreachable post-fix was wrong.)
2. Bytes dropped by `RecvData` on a closed reader are *not* acked (streamreader.go:55–57 returns early), remain in the remote CirBuf, and replay normally — unaffected by all fixes here.
3. Append I/O errors still surface as gaps on the next connect (logged; unchanged).
4. If `waitForStreamLoopExit`'s 1 s timeout fires with a stuck old loop, late appends landing after the re-stat can produce a spurious gap on the same restart (pre-existing, rare; not worsened by Fix A).

## Test plan

Unit tests (client-side, `pkg/jobcontroller`, hand-written fakes per repo convention):

| # | Case | Setup | Expected |
|---|---|---|---|
| T1 | Race reproduction (Fix A) | Reader with buffered bytes; close reader *before* the consumer reads (force ErrClosedPipe path) | Post-close drain recovers the bytes; file contains them; no seq gap |
| T2 | No double-append | Bytes read+appended by the loop pre-close | Second drain returns empty; re-stat accounts once |
| T3 | Empty-buffer fast path | Supersession with idle reader | Zero extra appends, currentSeq unchanged |
| T4 | Append error surfaces | Force `handleAppendJobFile` failure during post-drain | Error logged; behavior degrades to today's gap path |
| T5 | Existing suite | All jobcontroller/streamclient tests | Unchanged pass, `-race` clean |
| T6 | Gap telemetry | Gap detected with `prevReaderOk=false` vs `true` | Log line distinguishes restart class from supersession class |
| T7 (if B2) | Shutdown drain | `doShutdown` with readers holding buffered bytes | Drained + appended before `WFS.FlushCache`; empty readers no-op; append error logged, shutdown continues |

Manual verification:
- Supersession race: sustained output (`yes`/TUI) through a congested link, hit **Reconnect Stream** repeatedly; expect zero `[stream gap:` markers and byte-exact term file vs. remote stream position.
- Restart class: sustained output, SIGINT wavesrv mid-stream, relaunch, reconnect. Pre-B2: expect a gap marker ≈ the buffered bytes. Post-B2: expect none.

## Open questions

1. ~~Fix A placement~~ — answered: inside `restartStreaming`.
2. ~~Marker copy~~ — answered: unchanged; telemetry in logs.
3. **Restart class: B1 vs B2 vs B3** — recommendation above (Fix A + telemetry + B2; B1 by follow-up spec if markers persist). Needs maintainer decision before implementation.
