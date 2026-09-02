// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Send retry tuning. A single send failure is treated as transient congestion
// (e.g., SSH channel saturation from a concurrent file transfer); only SUSTAINED
// failure disconnects the stream and activates disk buffering.
// Spec: .pi/specs/stream-data-path-resilience.md
var (
	SendRetryInterval        = 25 * time.Millisecond
	MaxConsecutiveSendFails  = 20
	MaxSendFailureDuration   = 30 * time.Second
	SendDataEnqueueTimeoutMs = int64(10) // fail-fast enqueue timeout for StreamData RPCs
)

const (
	CwndSize      = 64 * 1024       // 64 KB window for connected mode
	CirBufSize    = 2 * 1024 * 1024 // 2 MB max buffer size
	DisconnReadSz = 4 * 1024        // 4 KB read chunks when disconnected
	MaxPacketSize = 4 * 1024        // 4 KB max data per packet
)

type DataSender interface {
	SendData(dataPk wshrpc.CommandStreamData) error
}

type streamTerminalEvent struct {
	isEof bool
	err   string
}

// StreamManager handles PTY output buffering with ACK-based flow control
type StreamManager struct {
	lock      sync.Mutex
	drainCond *sync.Cond

	streamId string
	jobId    string

	// this is the data read from the attached reader
	buf           *CirBuf
	terminalEvent *streamTerminalEvent
	eofPos        int64 // fixed position when EOF/error occurs (-1 if not yet)

	reader io.Reader

	cwndSize int
	rwndSize int
	// invariant: if connected is true, dataSender is non-nil
	connected  bool
	dataSender DataSender

	// unacked state (reset on disconnect)
	sentNotAcked      int64
	terminalEventSent bool

	// track max acked to handle out-of-order ACKs (reset on disconnect)
	maxAckedSeq  int64
	maxAckedRwnd int64

	// lastAckAt tracks the last time a valid ACK was processed; used by the
	// stall watchdog to detect a flow-control deadlock (window full, no ACKs).
	lastAckAt time.Time
	// lastRejectLogAt rate-limits logging of rejected/stale ACKs.
	lastRejectLogAt time.Time

	// send-failure gate: consecutive failures / cumulative duration must both
	// stay under threshold before we declare the client disconnected.
	sendFailStreak int
	sendFailSince  time.Time
	// statusFn (optional) reports stream state transitions to wavesrv via the
	// StreamStatusReport RPC. Wired by jobmanager Setup; nil disables reporting.
	statusFn func(wshrpc.CommandStreamStatusData)

	// terminal state - once true, stream is complete
	terminalEventAcked bool
	closed             bool

	// disk-backed history
	diskFile     *os.File // nil when not using disk
	diskStartSeq int64    // totalSize at which disk writing began
	diskEndSeq   int64    // last byte written to disk (= totalSize of last write)
	diskReadPos  int64    // next byte to read from disk during drain (absolute Seq)
	drainGen     int64    // generation counter: incremented on disconnect to kill old drain goroutines

	// UX-1.7: drain progress tracking for catch-up indicator
	DrainActive         bool
	DrainTotalBytes     int64
	DrainRemainingBytes int64
}

// SetJobId sets the job ID for disk file path generation. Must be called before
// disk buffering is activated.
func (sm *StreamManager) SetJobId(jobId string) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.jobId = jobId
}

func MakeStreamManager() *StreamManager {
	return MakeStreamManagerWithSizes(CwndSize, CirBufSize)
}

func MakeStreamManagerWithSizes(cwndSize, cirbufSize int) *StreamManager {
	sm := &StreamManager{
		buf:      MakeCirBuf(cirbufSize, true),
		eofPos:   -1,
		cwndSize: cwndSize,
		rwndSize: cwndSize,
	}
	sm.drainCond = sync.NewCond(&sm.lock)
	go sm.senderLoop()
	go sm.stallWatchdog()
	return sm
}

// stallWatchdog periodically checks for a flow-control deadlock: the stream is
// connected, we have unacked/sent data, but no ACK has arrived recently. This is
// the signature of a wedged output stream (window full, ACKs stopped). Logs are
// rate-limited to once per tick (10s).
func (sm *StreamManager) stallWatchdog() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		sm.lock.Lock()
		connected := sm.connected
		sentNotAcked := sm.sentNotAcked
		bufCount := sm.buf.Size()
		if !connected || (sentNotAcked == 0 && bufCount == 0) {
			sm.lock.Unlock()
			continue
		}
		stalled := !sm.lastAckAt.IsZero() && time.Since(sm.lastAckAt) > 10*time.Second
		if stalled {
			log.Printf("[streammanager] STALL-WATCH jobid=%s connected=%v sentNotAcked=%d rwndSize=%d bufCount=%d bufTotal=%d headPos=%d maxAckedSeq=%d maxAckedRwnd=%d lastAckAgo=%s",
				sm.jobId, connected, sentNotAcked, sm.rwndSize, bufCount, sm.buf.TotalSize(), sm.buf.HeadPos(), sm.maxAckedSeq, sm.maxAckedRwnd, time.Since(sm.lastAckAt))
			sm.emitStatusLocked(wshrpc.StreamStateStalled)
		}
		sm.lock.Unlock()
	}
}

// AttachReader starts reading from the given reader
func (sm *StreamManager) AttachReader(r io.Reader) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if sm.reader != nil {
		return fmt.Errorf("reader already attached")
	}

	sm.reader = r
	go sm.readLoop()

	return nil
}

// ClientConnected transitions to CONNECTED mode
func (sm *StreamManager) ClientConnected(streamId string, dataSender DataSender, rwndSize int, clientSeq int64) (int64, error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if sm.closed || sm.terminalEventAcked {
		return 0, fmt.Errorf("stream is closed")
	}

	if sm.connected {
		return 0, fmt.Errorf("client already connected")
	}

	if dataSender == nil {
		return 0, fmt.Errorf("dataSender cannot be nil")
	}

	headPos := sm.buf.HeadPos()
	effectiveEnd := headPos + int64(sm.buf.Size())
	if sm.diskEndSeq > effectiveEnd {
		effectiveEnd = sm.diskEndSeq
	}
	// If the client reports a seq ahead of our stream, don't hard-fail: the
	// client's term file has phantom bytes from a seq-tracking drift (totalGap
	// over-count, supersession double-append). Hard-failing here leaves the job
	// "Connected without active stream" (invisible typing). Clamp to the server's
	// authoritative end; the returned seq lets the client truncate its file (see
	// restartStreaming's rtnData.Seq < currentSeq path).
	if clientSeq > effectiveEnd {
		log.Printf("ClientConnected: client seq %d ahead of stream end %d (headPos=%d bufSize=%d totalSize=%d diskEndSeq=%d) — clamping",
			clientSeq, effectiveEnd, headPos, sm.buf.Size(), sm.buf.TotalSize(), sm.diskEndSeq)
		clientSeq = effectiveEnd
	}

	if clientSeq > headPos {
		bytesToConsume := int(clientSeq - headPos)
		available := sm.buf.Size()
		if bytesToConsume > available {
			// Client is ahead of CirBuf but within disk range — sync totalSize
			sm.buf.SetTotalSize(clientSeq)
			sm.buf.Consume(sm.buf.Size())
			headPos = sm.buf.HeadPos()
		} else if bytesToConsume > 0 {
			if err := sm.buf.Consume(bytesToConsume); err != nil {
				return 0, fmt.Errorf("failed to consume buffer: %w", err)
			}
			headPos = sm.buf.HeadPos()
		}
	}

	sm.streamId = streamId
	sm.dataSender = dataSender
	sm.connected = true
	sm.rwndSize = rwndSize
	sm.sentNotAcked = 0
	sm.sendFailStreak = 0
	sm.sendFailSince = time.Time{}
	sm.lastAckAt = time.Now()
	effectiveWindow := sm.cwndSize
	if sm.rwndSize < effectiveWindow {
		effectiveWindow = sm.rwndSize
	}
	sm.buf.SetEffectiveWindow(true, effectiveWindow)
	sm.drainCond.Signal()

	startSeq := headPos
	if clientSeq > startSeq {
		startSeq = clientSeq
	}

	// Start disk drain if disk data exists and client is behind
	if sm.diskFile != nil && clientSeq < sm.diskEndSeq {
		if sm.diskReadPos < sm.diskStartSeq {
			sm.diskReadPos = sm.diskStartSeq
		}
		if clientSeq > sm.diskReadPos {
			sm.diskReadPos = clientSeq
		}
		// UX-1.7: track drain progress for catch-up indicator
		totalBytes := sm.diskEndSeq - sm.diskReadPos
		sm.DrainActive = true
		sm.DrainTotalBytes = totalBytes
		sm.DrainRemainingBytes = totalBytes
		sm.drainGen++
		go sm.drainDiskToCirBuf(sm.drainGen)
	} else if sm.diskFile != nil {
		// Client is caught up or ahead — no drain needed.
		// Deactivate disk so readLoop resumes writing to CirBuf directly.
		sm.deactivateDiskBuffering()
	}

	return startSeq, nil
}

// GetStreamId returns the current stream ID (safe to call with lock held by caller)
func (sm *StreamManager) GetStreamId() string {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return sm.streamId
}

// GetDrainProgress returns UX-1.7 catch-up counters. When remaining hits 0,
// DrainActive is cleared so callers stop showing the catch-up indicator even
// if the drain goroutine is still watching for live output.
func (sm *StreamManager) GetDrainProgress() (active bool, total int64, remaining int64) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	if sm.DrainActive && sm.DrainRemainingBytes <= 0 {
		sm.DrainActive = false
		sm.DrainTotalBytes = 0
		sm.DrainRemainingBytes = 0
	}
	return sm.DrainActive, sm.DrainTotalBytes, sm.DrainRemainingBytes
}

// GetStreamDoneInfo returns whether the stream is done and the error if there was one.
// The error is only meaningful if done=true, as the error is delivered as part of the stream otherwise.
func (sm *StreamManager) GetStreamDoneInfo() (done bool, streamError string) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	if !sm.terminalEventAcked {
		return false, ""
	}
	if sm.terminalEvent != nil && !sm.terminalEvent.isEof {
		return true, sm.terminalEvent.err
	}
	return true, ""
}

// ClientDisconnected transitions to DISCONNECTED mode
func (sm *StreamManager) ClientDisconnected() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if !sm.connected {
		return
	}

	sm.connected = false
	sm.dataSender = nil
	sm.sentNotAcked = 0
	sm.maxAckedSeq = 0
	sm.maxAckedRwnd = 0
	if !sm.terminalEventAcked {
		sm.terminalEventSent = false
	}
	sm.buf.SetEffectiveWindow(false, CirBufSize)
	sm.drainGen++ // kill any running drain goroutine
	sm.drainCond.Signal()
}

// logRejectAck rate-limits logging for ACKs that RecvAck rejects. Rejections are
// normally rare; a flood of these indicates a seq-tracking drift between the
// client and server stream positions.
func (sm *StreamManager) logRejectAck(reason string, seq, rwnd, maxAckedSeq, maxAckedRwnd, headPos, sentNotAcked int64) {
	now := time.Now()
	if !sm.lastRejectLogAt.IsZero() && now.Sub(sm.lastRejectLogAt) < time.Second {
		return
	}
	sm.lastRejectLogAt = now
	log.Printf("[streammanager] RecvAck rejected (%s) jobid=%s seq=%d rwnd=%d maxAckedSeq=%d maxAckedRwnd=%d headPos=%d sentNotAcked=%d",
		reason, sm.jobId, seq, rwnd, maxAckedSeq, maxAckedRwnd, headPos, sentNotAcked)
}

// RecvAck processes an ACK from the client
// must be connected, and streamid must match
func (sm *StreamManager) RecvAck(ackPk wshrpc.CommandStreamAckData) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if !sm.connected || ackPk.Id != sm.streamId {
		return
	}

	if ackPk.Fin {
		sm.terminalEventAcked = true
		sm.drainCond.Signal()
		return
	}

	seq := ackPk.Seq
	rwnd := ackPk.RWnd

	// Ignore stale ACKs using tuple comparison (seq, rwnd)
	if seq < sm.maxAckedSeq || (seq == sm.maxAckedSeq && rwnd <= sm.maxAckedRwnd) {
		sm.logRejectAck("stale", seq, rwnd, sm.maxAckedSeq, sm.maxAckedRwnd, sm.buf.HeadPos(), sm.sentNotAcked)
		return
	}

	// Update max acked tuple
	sm.maxAckedSeq = seq
	sm.maxAckedRwnd = rwnd
	sm.lastAckAt = time.Now()

	headPos := sm.buf.HeadPos()
	if seq < headPos {
		sm.logRejectAck("seq-behind-head", seq, rwnd, sm.maxAckedSeq, sm.maxAckedRwnd, headPos, sm.sentNotAcked)
		return
	}

	ackedBytes := seq - headPos
	if ackedBytes > sm.sentNotAcked {
		sm.logRejectAck("ack-exceeds-sent", seq, rwnd, sm.maxAckedSeq, sm.maxAckedRwnd, headPos, sm.sentNotAcked)
		return
	}

	if ackedBytes > 0 {
		if err := sm.buf.Consume(int(ackedBytes)); err != nil {
			return
		}
		sm.sentNotAcked -= ackedBytes
	}

	prevRwnd := sm.rwndSize
	sm.rwndSize = int(ackPk.RWnd)
	effectiveWindow := sm.cwndSize
	if sm.rwndSize < effectiveWindow {
		effectiveWindow = sm.rwndSize
	}
	sm.buf.SetEffectiveWindow(true, effectiveWindow)

	if sm.rwndSize > prevRwnd || ackedBytes > 0 {
		sm.drainCond.Signal()
	}
}

// SetRwndSize dynamically updates the receive window size
func (sm *StreamManager) SetRwndSize(rwndSize int) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	if rwndSize < 0 {
		return fmt.Errorf("rwndSize cannot be negative")
	}
	if !sm.connected {
		return fmt.Errorf("not connected")
	}
	sm.rwndSize = rwndSize
	effectiveWindow := sm.cwndSize
	if sm.rwndSize < effectiveWindow {
		effectiveWindow = sm.rwndSize
	}
	sm.buf.SetEffectiveWindow(true, effectiveWindow)
	sm.drainCond.Signal()
	return nil
}

// Close shuts down the sender loop. The reader loop will exit on its next iteration
// or when the underlying reader is closed.
func (sm *StreamManager) Close() {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.closed = true
	if sm.diskFile != nil {
		diskFile := sm.diskFile
		diskPath := sm.diskFile.Name()
		sm.diskFile = nil
		go func() {
			diskFile.Close()
			os.Remove(diskPath)
		}()
	}
	sm.drainCond.Signal()
}

// readLoop is the main read goroutine
func (sm *StreamManager) readLoop() {
	readBuf := make([]byte, MaxPacketSize)
	for {
		sm.lock.Lock()
		closed := sm.closed
		sm.lock.Unlock()

		if closed {
			return
		}

		n, err := sm.reader.Read(readBuf)

		if n > 0 {
			sm.handleReadData(readBuf[:n])
		}

		if err != nil {
			if err == io.EOF {
				sm.handleEOF()
			} else {
				sm.handleError(err)
			}
			return
		}
	}
}

func (sm *StreamManager) handleReadData(data []byte) {
	sm.lock.Lock()
	diskFile := sm.diskFile
	sm.lock.Unlock()

	if diskFile != nil {
		n, err := diskFile.Write(data)
		sm.lock.Lock()
		if err != nil || sm.diskFile != diskFile {
			if err != nil && sm.diskFile == diskFile {
				// Disk write failed (e.g. ENOSPC) or file was deactivated mid-write.
				// Nil the file and reset disk seq state so stale diskEndSeq does not
				// inflate ClientConnected's effectiveEnd bound. Bump drainGen to kill
				// any running drain goroutine before the file is closed.
				diskPath := diskFile.Name()
				sm.diskFile = nil
				sm.diskStartSeq = 0
				sm.diskEndSeq = 0
				sm.diskReadPos = 0
				sm.drainGen++
				go func() {
					diskFile.Close()
					os.Remove(diskPath)
				}()
			}
			sm.lock.Unlock()
		} else {
			sm.diskEndSeq += int64(n)
			// Only signal senderLoop when connected. During disconnect, senderLoop is
			// parked in drainCond.Wait() and each signal wakes it uselessly. The disk
			// write does not touch CirBuf, so senderLoop has nothing to read.
			if sm.connected {
				sm.drainCond.Signal()
			}
			sm.lock.Unlock()
			return
		}
	}

	offset := 0
	for offset < len(data) {
		n, waitCh := sm.buf.WriteAvailable(data[offset:])
		offset += n

		if n > 0 {
			sm.lock.Lock()
			sm.drainCond.Signal()
			sm.lock.Unlock()
		}

		if waitCh != nil {
			<-waitCh
		}
	}
}

func (sm *StreamManager) handleEOF() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	eofPos := sm.buf.TotalSize()
	if sm.diskEndSeq > eofPos {
		eofPos = sm.diskEndSeq
	}
	log.Printf("handleEOF: PTY reached EOF, totalSize=%d, diskEndSeq=%d, eofPos=%d", sm.buf.TotalSize(), sm.diskEndSeq, eofPos)
	sm.eofPos = eofPos
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.drainCond.Signal()
}

func (sm *StreamManager) handleError(err error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	eofPos := sm.buf.TotalSize()
	if sm.diskEndSeq > eofPos {
		eofPos = sm.diskEndSeq
	}
	log.Printf("handleError: PTY error=%v, totalSize=%d, diskEndSeq=%d, eofPos=%d", err, sm.buf.TotalSize(), sm.diskEndSeq, eofPos)
	sm.eofPos = eofPos
	sm.terminalEvent = &streamTerminalEvent{err: err.Error()}
	sm.drainCond.Signal()
}

func (sm *StreamManager) handleSendFailure() {
	log.Printf("handleSendFailure: sends failing sustained, transitioning to disconnected mode")
	sm.ClientDisconnected()
	sm.activateDiskBuffering()
	sm.lock.Lock()
	sm.emitStatusLocked(wshrpc.StreamStateDiskBuffer)
	sm.lock.Unlock()
}

// SetStatusFn installs the remote-state reporting hook (jobmanager wires this
// to the StreamStatusReport RPC). Fire-and-forget; nil disables reporting.
func (sm *StreamManager) SetStatusFn(fn func(wshrpc.CommandStreamStatusData)) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.statusFn = fn
}

// emitStatusLocked builds and asynchronously dispatches a status report.
// Must be called with sm.lock held. Delivery is best-effort; errors are
// swallowed by the installed statusFn.
func (sm *StreamManager) emitStatusLocked(state string) {
	if sm.statusFn == nil {
		return
	}
	data := wshrpc.CommandStreamStatusData{
		JobId:        sm.jobId,
		StreamId:     sm.streamId,
		State:        state,
		SentNotAcked: sm.sentNotAcked,
		BufCount:     int64(sm.buf.Size()),
		RWnd:         sm.rwndSize,
		RetryCount:   sm.sendFailStreak,
	}
	if !sm.lastAckAt.IsZero() {
		data.LastAckAgeMs = time.Since(sm.lastAckAt).Milliseconds()
	}
	if sm.diskFile != nil {
		data.DiskBufBytes = sm.diskEndSeq - sm.diskStartSeq
	}
	fn := sm.statusFn
	go func() {
		defer func() {
			panichandler.PanicHandler("StreamManager:emitStatus", recover())
		}()
		fn(data)
	}()
}

func (sm *StreamManager) activateDiskBuffering() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if sm.diskFile != nil {
		return // already activated
	}
	if sm.reader == nil {
		return // no PTY data flowing
	}
	if sm.terminalEvent != nil {
		return // process already exited
	}

	diskPath := wavebase.GetRemoteJobFilePath(sm.jobId, "stream")
	f, err := os.Create(diskPath)
	if err != nil {
		log.Printf("activateDiskBuffering: failed to create disk file %s: %v", diskPath, err)
		return
	}
	sm.diskFile = f
	sm.diskStartSeq = sm.buf.TotalSize()
	sm.diskEndSeq = sm.buf.TotalSize()
	sm.diskReadPos = sm.buf.TotalSize()
	log.Printf("activateDiskBuffering: disk buffering activated at path=%s startSeq=%d", diskPath, sm.diskStartSeq)
}

func (sm *StreamManager) drainDiskToCirBuf(myGen int64) {
	for {
		sm.lock.Lock()
		generation := sm.drainGen
		connected := sm.connected
		diskFile := sm.diskFile
		curDiskEnd := sm.diskEndSeq
		readPos := sm.diskReadPos
		diskStartSeq := sm.diskStartSeq
		sm.lock.Unlock()

		if generation != myGen || !connected || diskFile == nil {
			return
		}
		if readPos >= curDiskEnd {
			sm.lock.Lock()
			if sm.terminalEvent != nil && sm.diskReadPos >= sm.diskEndSeq {
				// Process exited and all data drained — complete
				sm.deactivateDiskBuffering()
				sm.lock.Unlock()
				return
			}
			sm.lock.Unlock()
			// Live process, caught up — spin
			time.Sleep(10 * time.Millisecond)
			continue
		}

		// Calculate offset into disk file
		fileOffset := readPos - diskStartSeq
		toRead := curDiskEnd - readPos
		if toRead > MaxPacketSize {
			toRead = MaxPacketSize
		}

		buf := make([]byte, toRead)
		n, err := diskFile.ReadAt(buf, fileOffset)
		if err != nil && err != io.EOF {
			log.Printf("drainDiskToCirBuf: read error: %v", err)
			return
		}
		if n == 0 {
			time.Sleep(10 * time.Millisecond)
			continue
		}

		data := buf[:n]
		written := 0
		for written < len(data) {
			sm.lock.Lock()
			stillConnected := sm.connected
			stillMyGen := sm.drainGen == myGen
			sm.lock.Unlock()
			if !stillConnected || !stillMyGen {
				return
			}

			nw, waitCh := sm.buf.WriteAvailable(data[written:])
			written += nw

			if nw > 0 {
				sm.lock.Lock()
				if sm.drainGen == myGen {
					sm.diskReadPos += int64(nw)
					// UX-1.7: update remaining bytes for catch-up indicator
					remaining := sm.diskEndSeq - sm.diskReadPos
					if remaining < 0 {
						remaining = 0
					}
					if remaining < sm.DrainRemainingBytes {
						sm.DrainRemainingBytes = remaining
					}
					// Clear active once caught up so UI does not linger while
					// the goroutine waits for a terminal event / more disk data.
					if sm.DrainRemainingBytes <= 0 && sm.DrainActive {
						sm.DrainActive = false
						sm.DrainTotalBytes = 0
						sm.DrainRemainingBytes = 0
					}
				}
				sm.drainCond.Signal()
				sm.lock.Unlock()
			}

			if waitCh != nil {
				<-waitCh
			}
		}

		// Check if drain is complete (process exited + all data drained)
		sm.lock.Lock()
		if sm.terminalEvent != nil && sm.diskReadPos >= sm.diskEndSeq {
			sm.deactivateDiskBuffering()
			sm.lock.Unlock()
			return
		}
		sm.lock.Unlock()
	}
}

func (sm *StreamManager) deactivateDiskBuffering() {
	// Called with sm.lock held
	if sm.diskFile == nil {
		return
	}
	sm.buf.SetTotalSize(sm.diskEndSeq)
	diskFile := sm.diskFile
	diskPath := sm.diskFile.Name()
	sm.diskFile = nil
	sm.diskStartSeq = 0
	sm.diskEndSeq = 0
	sm.diskReadPos = 0
	// UX-1.7: clear drain progress tracking
	sm.DrainActive = false
	sm.DrainTotalBytes = 0
	sm.DrainRemainingBytes = 0
	sm.drainGen++
	sm.drainCond.Signal()
	go func() {
		diskFile.Close()
		os.Remove(diskPath)
	}()
	log.Printf("deactivateDiskBuffering: disk drain complete, file deleted")
}

func (sm *StreamManager) senderLoop() {
	for {
		done, pkt, sender := sm.prepareNextPacket()
		if done {
			return
		}
		if pkt == nil {
			continue
		}
		if sender == nil {
			sm.lock.Lock()
			sm.drainCond.Signal()
			sm.lock.Unlock()
			continue
		}
		if err := sender.SendData(*pkt); err != nil {
			// A failed send does NOT mean the client is gone: transient congestion
			// (e.g., SSH channel saturation from a concurrent file transfer) can
			// backpressure OutputCh for seconds. Retry the same packet FIFO until
			// delivered or sustained failure (spec: stream-data-path-resilience.md).
			sm.retrySendLoop(pkt, sender)
		} else {
			sm.noteSendSuccess()
		}
	}
}

// retrySendLoop re-attempts pkt in-order until it is delivered or the failure
// is sustained (then disconnects + activates disk buffering). Invariants:
// strict FIFO retry (a skipped data packet would wedge the reader's cumulative
// ACK window forever) and accounting consistency (sentNotAcked already counts
// this packet; it stays counted until the reader ACKs it).
func (sm *StreamManager) retrySendLoop(pkt *wshrpc.CommandStreamData, sender DataSender) {
	sm.lock.Lock()
	sm.sendFailStreak++
	first := sm.sendFailStreak == 1
	if first {
		sm.sendFailSince = time.Now()
	}
	sm.lock.Unlock()
	if first {
		log.Printf("[streammanager] send failed seq=%d, entering retry mode (interval=%s, disconnect after %d fails or %s)",
			pkt.Seq, SendRetryInterval, MaxConsecutiveSendFails, MaxSendFailureDuration)
		sm.lock.Lock()
		sm.emitStatusLocked(wshrpc.StreamStateRetrying)
		sm.lock.Unlock()
	}
	for {
		sm.lock.Lock()
		stopped := !sm.connected || sm.closed
		streak := sm.sendFailStreak
		var failDur time.Duration
		if !sm.sendFailSince.IsZero() {
			failDur = time.Since(sm.sendFailSince)
		}
		sustained := streak >= MaxConsecutiveSendFails || failDur >= MaxSendFailureDuration
		sm.lock.Unlock()
		if stopped {
			return
		}
		if sustained {
			log.Printf("[streammanager] send failures sustained (%d consecutive / %s total), seq=%d — transitioning to disconnected mode",
				streak, failDur.Round(time.Millisecond), pkt.Seq)
			sm.handleSendFailure()
			return
		}
		time.Sleep(SendRetryInterval)
		if err := sender.SendData(*pkt); err == nil {
			sm.noteSendSuccess()
			return
		}
		sm.lock.Lock()
		sm.sendFailStreak++
		sm.lock.Unlock()
	}
}

// noteSendSuccess resets the failure gate after a successful send.
func (sm *StreamManager) noteSendSuccess() {
	sm.lock.Lock()
	recovered := sm.sendFailStreak > 0
	streak := sm.sendFailStreak
	sm.sendFailStreak = 0
	sm.sendFailSince = time.Time{}
	sm.lock.Unlock()
	if recovered {
		log.Printf("[streammanager] send recovered after %d consecutive failure(s)", streak)
		sm.lock.Lock()
		sm.emitStatusLocked(wshrpc.StreamStateConnected)
		sm.lock.Unlock()
	}
}

func (sm *StreamManager) prepareNextPacket() (done bool, pkt *wshrpc.CommandStreamData, sender DataSender) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	available := sm.buf.Size()

	if sm.closed || sm.terminalEventAcked {
		return true, nil, nil
	}

	if !sm.connected {
		sm.drainCond.Wait()
		return false, nil, nil
	}

	if available == 0 {
		if sm.terminalEvent != nil && !sm.terminalEventSent && sm.diskFile == nil {
			return false, sm.prepareTerminalPacket(), sm.dataSender
		}
		sm.drainCond.Wait()
		return false, nil, nil
	}

	effectiveRwnd := sm.rwndSize
	if sm.cwndSize < effectiveRwnd {
		effectiveRwnd = sm.cwndSize
	}
	availableToSend := int64(effectiveRwnd) - sm.sentNotAcked

	if availableToSend <= 0 {
		sm.drainCond.Wait()
		return false, nil, nil
	}

	peekSize := int(availableToSend)
	if peekSize > MaxPacketSize {
		peekSize = MaxPacketSize
	}
	if peekSize > available {
		peekSize = available
	}

	data := make([]byte, peekSize)
	n := sm.buf.PeekDataAt(int(sm.sentNotAcked), data)
	if n == 0 {
		sm.drainCond.Wait()
		return false, nil, nil
	}
	data = data[:n]

	seq := sm.buf.HeadPos() + sm.sentNotAcked
	sm.sentNotAcked += int64(n)

	return false, &wshrpc.CommandStreamData{
		Id:     sm.streamId,
		Seq:    seq,
		Data64: base64.StdEncoding.EncodeToString(data),
	}, sm.dataSender
}

func (sm *StreamManager) prepareTerminalPacket() *wshrpc.CommandStreamData {
	if sm.terminalEventSent || sm.terminalEvent == nil {
		return nil
	}

	pkt := &wshrpc.CommandStreamData{
		Id:  sm.streamId,
		Seq: sm.eofPos,
	}

	if sm.terminalEvent.isEof {
		pkt.Eof = true
	} else {
		pkt.Error = sm.terminalEvent.err
	}

	sm.terminalEventSent = true
	return pkt
}
