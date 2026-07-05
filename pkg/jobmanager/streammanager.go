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

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const SendDataTimeout = 5 * time.Second

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

	// terminal state - once true, stream is complete
	terminalEventAcked bool
	closed             bool

	// disk-backed history
	diskFile     *os.File // nil when not using disk
	diskStartSeq int64    // totalSize at which disk writing began
	diskEndSeq   int64    // last byte written to disk (= totalSize of last write)
	diskReadPos  int64    // next byte to read from disk during drain (absolute Seq)
	drainGen     int64    // generation counter: incremented on disconnect to kill old drain goroutines
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
	return sm
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
	if clientSeq > effectiveEnd {
		return 0, fmt.Errorf("client seq %d beyond stream end %d", clientSeq, effectiveEnd)
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
		// log.Printf("streammanager ignoring stale ACK: seq=%d rwnd=%d (max: seq=%d rwnd=%d)",
		// 	seq, rwnd, sm.maxAckedSeq, sm.maxAckedRwnd)
		return
	}

	// Update max acked tuple
	sm.maxAckedSeq = seq
	sm.maxAckedRwnd = rwnd

	headPos := sm.buf.HeadPos()
	if seq < headPos {
		return
	}

	ackedBytes := seq - headPos
	if ackedBytes > sm.sentNotAcked {
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
				diskPath := diskFile.Name()
				sm.diskFile = nil
				go func() {
					diskFile.Close()
					os.Remove(diskPath)
				}()
			}
			sm.lock.Unlock()
		} else {
			sm.diskEndSeq += int64(n)
			sm.drainCond.Signal()
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
	log.Printf("handleSendFailure: send timeout, transitioning to disconnected mode")
	sm.ClientDisconnected()
	sm.activateDiskBuffering()
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
			sm.lock.Unlock()
			if !stillConnected {
				return
			}

			nw, waitCh := sm.buf.WriteAvailable(data[written:])
			written += nw

			if nw > 0 {
				sm.lock.Lock()
				if sm.drainGen == myGen {
					sm.diskReadPos += int64(nw)
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
			sm.handleSendFailure()
		}
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
