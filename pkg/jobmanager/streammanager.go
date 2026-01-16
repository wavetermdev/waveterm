// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	CwndSize      = 64 * 1024       // 64 KB window for connected mode
	CirBufSize    = 2 * 1024 * 1024 // 2 MB max buffer size
	DisconnReadSz = 4 * 1024        // 4 KB read chunks when disconnected
	MaxPacketSize = 4 * 1024        // 4 KB max data per packet
)

type DataSender interface {
	SendData(dataPk wshrpc.CommandStreamData)
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

	// terminal state - once true, stream is complete
	terminalEventAcked bool
	closed             bool
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
	if clientSeq > headPos {
		bytesToConsume := int(clientSeq - headPos)
		available := sm.buf.Size()
		if bytesToConsume > available {
			return 0, fmt.Errorf("client seq %d is beyond our stream end (head=%d, size=%d)", clientSeq, headPos, available)
		}
		if bytesToConsume > 0 {
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

	return startSeq, nil
}

// GetStreamId returns the current stream ID (safe to call with lock held by caller)
func (sm *StreamManager) GetStreamId() string {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return sm.streamId
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
	if !sm.terminalEventAcked {
		sm.terminalEventSent = false
	}
	sm.buf.SetEffectiveWindow(false, CirBufSize)
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

// Close shuts down the sender loop. The reader loop will exit on its next iteration
// or when the underlying reader is closed.
func (sm *StreamManager) Close() {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.closed = true
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
		log.Printf("readLoop: read %d bytes from PTY, err=%v", n, err)

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
	log.Printf("handleReadData: writing %d bytes to buffer", len(data))
	sm.buf.Write(data)
	sm.lock.Lock()
	defer sm.lock.Unlock()
	log.Printf("handleReadData: buffer size=%d, connected=%t, signaling=%t", sm.buf.Size(), sm.connected, sm.connected)
	if sm.connected {
		sm.drainCond.Signal()
	}
}

func (sm *StreamManager) handleEOF() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	log.Printf("handleEOF: PTY reached EOF, totalSize=%d", sm.buf.TotalSize())
	sm.eofPos = sm.buf.TotalSize()
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.drainCond.Signal()
}

func (sm *StreamManager) handleError(err error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	log.Printf("handleError: PTY error=%v, totalSize=%d", err, sm.buf.TotalSize())
	sm.eofPos = sm.buf.TotalSize()
	sm.terminalEvent = &streamTerminalEvent{err: err.Error()}
	sm.drainCond.Signal()
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
		sender.SendData(*pkt)
	}
}

func (sm *StreamManager) prepareNextPacket() (done bool, pkt *wshrpc.CommandStreamData, sender DataSender) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	available := sm.buf.Size()
	log.Printf("prepareNextPacket: connected=%t, available=%d, closed=%t, terminalEventAcked=%t, terminalEvent=%v",
		sm.connected, available, sm.closed, sm.terminalEventAcked, sm.terminalEvent != nil)

	if sm.closed || sm.terminalEventAcked {
		return true, nil, nil
	}

	if !sm.connected {
		log.Printf("prepareNextPacket: waiting for connection")
		sm.drainCond.Wait()
		return false, nil, nil
	}

	if available == 0 {
		if sm.terminalEvent != nil && !sm.terminalEventSent {
			log.Printf("prepareNextPacket: preparing terminal packet")
			return false, sm.prepareTerminalPacket(), sm.dataSender
		}
		log.Printf("prepareNextPacket: no data available, waiting")
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
		log.Printf("prepareNextPacket: PeekDataAt returned 0 bytes, waiting for ACK")
		sm.drainCond.Wait()
		return false, nil, nil
	}
	data = data[:n]

	seq := sm.buf.HeadPos() + sm.sentNotAcked
	sm.sentNotAcked += int64(n)

	log.Printf("prepareNextPacket: sending packet seq=%d, len=%d bytes", seq, n)
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
