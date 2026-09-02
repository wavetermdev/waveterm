# Stream Data-Path Resilience & Remote Stream-State Visibility

**Status:** Draft — not implemented
**Date:** 2026-08-24
**Branch target:** `feat/files-widget` (deferred until files-widget bugfix work lands)
**Predecessors:** [[decisions.md § 2026-08-22: Stream freeze — A1 ACK retry + B2 lock-free recv metadata]] (commit `57422a08`), [[stream-freeze-diagnosis.md]] (on `odds-and-ends`)

## Problem statement

On 2026-08-24 a terminal block (`c3aa8703` / job `4db086dd` / stream `0b01fc59`, conn `mimo-code@192.168.100.164`) froze silently after ~12:54:49. Post-mortem findings:

1. **A1+B2 worked.** All 23 ACK send timeouts in the session recovered via retry; zero dropped ACKs. Goroutine dump at 12:52:07 captured the failing ACK inline: `Seq=34010318, RWnd=65536` — the reader buffer was empty and the window fully open. All output loops parked cleanly in `Reader.Read()`. No lock contention. Backend provably healthy and begging for data.
2. **The remote stopped sending anyway.** Same-conn RPC traffic (files widget) kept working throughout. Silence began immediately after a congestion window (~12:41–12:52, three ACK timeouts = three separate saturation episodes).
3. **The remote side is mute.** The jobmanager process's stdout/stderr hit EOF at spawn (`RemoteStartJobCommand: stderr EOF / stdout EOF`), so remote-side `STALL-WATCH`, `handleSendFailure`, and disk-buffering logs never reach wavesrv. The one component that knows what happened cannot report it.

### Root cause (high confidence)

Mirror image of the bug A1 fixed, on the **data** path, with worse failure semantics:

- Remote `Broker.processSendData` → `StreamDataCommand` → `SendComplexRequest` **blocks up to 5 s** (`SendDataTimeout` / `DefaultTimeoutMs`) on a full bare-client `OutputCh`.
- The broker `sendQueue` is a single worker: one blocked data send stalls all streams' data for 5 s each (cascade).
- On timeout, `handleSendFailure()` fires → `ClientDisconnected()` → `activateDiskBuffering()`. The remote silently stops sending PTY output and buffers to `<jobid>.stream` on disk, awaiting a reconnect that nothing triggers — because locally everything looks healthy (conn green, no errors, streamhealth says "idle or wedged").

One transient congestion blip (e.g., a large files-widget copy sharing the SSH channel — `RemoteFileCopyCommand` ran at 12:34 and 12:55) is sufficient to sever a session.

## Goals

1. A single transient data-send failure must not disconnect the stream or switch to disk buffering.
2. Data delivery must remain **strictly in-order and gapless** under retry (see Invariants).
3. When the remote does degrade (disconnected / disk-buffering / stalling), wavesrv must know — in logs at minimum, ideally in `streamHealthInfo`.
4. Old remote binaries must degrade gracefully (no protocol breakage during rollout).

## Non-goals

- Reworking the frontend BlockFile event path (separate concern, deferred per A1+B2 decision).
- UI indicators for stream state (follow-up once backend states are trustworthy).
- Changing SSH-layer flow control or compression (rejected earlier: see files-widget transfer decision).
- Fixing the ~97-min goroutine cohort observed in dumps (separate investigation).

## Invariants (must hold)

- **I1 — Ordered, gapless delivery:** reader-side ACKs are cumulative; a lost data packet wedges the reader forever (OOO buffer waits for the gap). Retries MUST be strict FIFO; head-of-line blocking is correct here, skipping is never allowed.
- **I2 — Accounting consistency:** `sentNotAcked` is incremented in `prepareNextPacket` before send. A failed send means the packet never reached `OutputCh`; retrying the same packet keeps accounting correct without decrement/re-increment races.
- **I3 — Bounded retry memory:** unsent-unacked data is already bounded by the 64 KB window (`sentNotAcked ≤ CwndSize`). Retry state must stay within that bound (hold slice refs, don't copy).
- **I4 — Disconnect still happens:** genuine client death (ACKs stop for good) must still reach `ClientDisconnected` → disk buffering within a bounded time. We are raising the bar, not removing it.

## Change 1 — Resilient remote data send (`pkg/jobmanager`)

### Design

Mirror A1's shape, adapted for ordered data:

1. **Fail-fast enqueue.** Give the writer-side adapter for `StreamDataCommand` a short enqueue timeout (`~10 ms`, analogous to `AckSendTimeoutMs` in `wshstreamadapter.go`). A full `OutputCh` returns an error immediately instead of parking the sole `sendQueue` worker for 5 s.
   - Implementation note: unlike the ACK adapter (which wraps `SendComplexRequest` directly), the remote's data sender is `mainserverconn.go`'s `SendData` — apply the fail-fast + short timeout there or in the `DataSender` impl it exposes.
2. **FIFO retry, same packet.** On send failure, re-enqueue the *same* work item (payload slice retained per I3 — naturally ≤ window). Retry on a short interval (~25–50 ms) rather than hot-spinning. Order preserved by construction (single queue, head-of-line).
3. **Sustained-failure gate for disconnect.** Replace the single-timeout trigger with: consecutive-failure count AND/OR cumulative failure duration (suggest: ≥ 20 consecutive failures or ≥ 30 s continuous failure, whichever first) before calling `handleSendFailure` → `ClientDisconnected` → `activateDiskBuffering`. Any successful send resets the counter.
4. **Log transitions.** On entering retry mode, on recovering, and on finally disconnecting: rate-limited `log.Printf` with jobId, streamId, seq, failure duration. These go to jobmanager stdout — which leads into Change 2.

### What deliberately does NOT change

- Disk-buffering machinery itself (`activateDiskBuffering`, `drainDiskToCirBuf`, replay reconciliation) — it remains the correct answer for true disconnects and worked correctly in the incident (reconnect replayed the backlog).
- ACK path (already hardened by A1).
- Local (backend) broker — already hardened.

### Rollout caveat

Per repo policy, remotes only pick up new `wsh` binaries on a version bump. Change 1 lives entirely in code that runs on the remote (`wsh jobmanager` side), so it **requires `node version.cjs patch` (or minor)** to actually reach remote hosts. Until then, remotes keep the old fragile behavior. No protocol/type changes are involved, so old-client/new-remote and new-client/old-remote mixes are safe.

## Change 2 — Remote stream-state visibility

### Problem

Jobmanager logs are invisible (stdout/stderr EOF at spawn). `STALL-WATCH` (10 s ticker), `handleSendFailure`, and disk-buffer transitions happen blind. Backend `streamHealthWatchdog` can only say "idle or wedged" because it cannot see the remote's state.

### Design (chosen: structured status RPC over stdout piping)

Piping jobmanager stdout into connserver logs was considered and rejected for v1: multiline interleaving noise, auth-key material risk, and it only helps when someone greps. Instead:

1. **New wsh RPC: `StreamStatusReport`** (jobmanager → connserver → wavesrv), payload:
   ```go
   type CommandStreamStatusData struct {
       JobId         string `json:"jobid"`
       StreamId      string `json:"streamid"`
       State         string `json:"state"`   // "connected" | "retrying" | "disconnected-diskbuffer" | "stalled"
       SentNotAcked  int64  `json:"sentnotacked"`
       BufCount      int64  `json:"bufcount"`
       RWnd          int    `json:"rwnd"`
       LastAckAgeMs  int64  `json:"lastackagems"`
       RetryCount    int    `json:"retrycount"`     // since last success
       DiskBufBytes  int64  `json:"diskbufbytes"`   // when disk-buffering
   }
   ```
2. **Emission policy:** fire-and-forget (`NoResponse`) on every state transition, plus once per `stallWatchdog` tick (10 s) *only while stalled* (steady-state silence, matching existing log philosophy).
3. **wavesrv consumption:** log each report (`[job:%s] [stream:%s] remote state=%s …`); store latest in `streamHealthInfo` (new field `remoteState`). Upgrade the `idle-or-wedged` watchdog message to distinguish: remote reports connected (→ likely benign idle), stalled/retrying (→ real problem), disconnected-diskbuffer (→ offer/auto-trigger reconnect).
4. **Backward compatibility:** absence of reports (old remote) = `remoteState == ""` = today's behavior verbatim. New remote + old wavesrv: connserver accepts and drops unknown commands gracefully (existing RPC routing handles this).

### Version bump

New RPC command ⇒ **version bump required** (`node version.cjs minor` — new feature), bundled with Change 1's patch-level requirement into one bump.

## Implementation phases

| Phase | Content | Files | Protocol change |
|---|---|---|---|
| 1 | Fail-fast data send + FIFO retry + sustained-failure gate + transition logs | `pkg/jobmanager/streammanager.go` (`senderLoop`, `prepareNextPacket`, `handleSendFailure`, `ClientDisconnected`, `activateDiskBuffering`), `pkg/jobmanager/mainserverconn.go` (`SendData`) | None (but version bump needed for remotes to receive it) |
| 2 | `StreamStatusReport` RPC + wavesrv consumption + `streamHealthInfo.remoteState` | `pkg/wshrpc/wshrpctypes*.go`, `pkg/wshrpc/wshserver/`, `cmd/wsh/cmd/*jobmanager*`, `pkg/jobmanager/`, `pkg/jobcontroller/jobcontroller.go` | Yes — minor bump |

Phase 1 and Phase 2 can land independently; Phase 1 alone converts silent death into logged (if unseen) resilience; Phase 2 makes it observable.

## Test plan

Unit tests follow existing patterns in `pkg/jobmanager/streammanager_test.go` (hand-written fakes, table-driven, manual assertions). All concurrency tests run under `-race`.

### Change 1

| # | Test | Setup | Expected |
|---|---|---|---|
| T1 | Happy path unchanged | Connected writer, normal writes | Behavior identical to today; no retry state |
| T2 | Transient failure recovers | Fake `DataSender` fails N=2 sends, then succeeds | Same packet retried in order; no `ClientDisconnected`; no disk buffering; reader receives exact byte sequence |
| T3 | Ordering under repeated failure | Fails sends intermittently across 5 packets | Reader observes packets strictly in seq order, no gaps, no duplicates (I1) |
| T4 | Accounting consistency | Failure between `prepareNextPacket` and retry success | `sentNotAcked` never double-counts or under-counts (I2); ACK reconciliation converges |
| T5 | Sustained failure disconnects | All sends fail continuously past threshold | `ClientDisconnected` + `activateDiskBuffering` fire exactly once, at (not before) threshold (I4) |
| T6 | Recovery resets gate | 19 failures → 1 success → failures again | Counter reset; disconnect delayed accordingly |
| T7 | Retry memory bound | Window-sized burst with failing transport | Pending retry state ≤ CwndSize (I3); no unbounded growth |
| T8 | Multi-stream isolation | 2 streams, one failing transport | Healthy stream unaffected (single-worker cascade eliminated) |
| T9 | True-death timing | Transport dead from t=0 | Disconnect declared within threshold + jitter, well under old-style indefinite wait |

### Change 2

| # | Test | Setup | Expected |
|---|---|---|---|
| T10 | Transition emits report | Force connected → retrying → disconnected-diskbuffer | One `StreamStatusReport` per transition, correct fields |
| T11 | Stall tick emits, healthy doesn't | Run stallWatchdog 3 ticks stalled, 3 ticks healthy | Exactly 3 reports |
| T12 | wavesrv consumes | Deliver report via fake RPC | Log line written; `streamHealthInfo.remoteState` updated |
| T13 | Old remote (no reports) | No RPC ever arrives | `remoteState == ""`; watchdog message unchanged from today |
| T14 | Report RPC failure tolerated | Conn down when emitting | Fire-and-forget error swallowed; jobmanager unaffected |

### Manual verification (post-CI build)

1. Repro original conditions: heavy TUI output (long pi/claude session) + concurrent large files-widget copy on same conn. Expect zero freezes; `[job:…] remote state=retrying` lines (with Change 2) during congestion, then `state=connected`.
2. Kill network briefly mid-stream: expect retry-mode logs, then disk-buffer after sustained threshold, clean replay on heal.
3. Confirm `streamhealth` messages now name the cause instead of "idle or wedged".

## Open questions

1. Exact disconnect thresholds (T5): propose 20 consecutive / 30 s; tunable consts, fine to adjust after soak.
2. Should wavesrv auto-trigger `restartStreaming` on receiving `disconnected-diskbuffer` from a healthy-looking conn? (Today's convergence logic would likely catch it on next attention heartbeat, but explicit is faster.) Leaning yes behind the same cooldown guards — decide at implementation.
3. Whether to also route the existing `STALL-WATCH` log content through the status RPC (it carries the same fields) rather than maintaining both — implementation detail, leaning yes.
