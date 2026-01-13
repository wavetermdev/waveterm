// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"fmt"
	"io"
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
	lock sync.Mutex

	streamId string
	buf      *CirBuf

	terminalEvent      *streamTerminalEvent
	terminalEventSent  bool
	terminalEventAcked bool

	reader   io.Reader
	readerWg sync.WaitGroup

	dataSender DataSender

	cwndSize  int
	rwndSize  int
	connected bool
	drained   bool

	sentNotAcked int64
	drainCond    *sync.Cond
	closed       bool
}

func MakeStreamManager() *StreamManager {
	return MakeStreamManagerWithSizes(CwndSize, CirBufSize)
}

func MakeStreamManagerWithSizes(cwndSize, cirbufSize int) *StreamManager {
	sm := &StreamManager{
		buf:          MakeCirBuf(cirbufSize, true),
		cwndSize:     cwndSize,
		rwndSize:     cwndSize,
		sentNotAcked: 0,
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

	sm.readerWg.Add(1)
	go sm.readLoop()

	return nil
}

// ClientConnected transitions to CONNECTED mode
func (sm *StreamManager) ClientConnected(streamId string, dataSender DataSender, rwndSize int, clientSeq int64) (int64, error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

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
	sm.drained = false
	sm.rwndSize = rwndSize
	sm.sentNotAcked = 0
	if !sm.terminalEventAcked {
		sm.terminalEventSent = false
	}
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

// ClientDisconnected transitions to DISCONNECTED mode
func (sm *StreamManager) ClientDisconnected() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if !sm.connected {
		return
	}

	sm.connected = false
	sm.dataSender = nil
	sm.drainCond.Signal()
	sm.sentNotAcked = 0
	sm.buf.SetEffectiveWindow(false, CirBufSize)
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
	}

	seq := ackPk.Seq
	headPos := sm.buf.HeadPos()
	if seq < headPos {
		return
	}

	ackedBytes := seq - headPos
	available := sm.buf.Size()

	maxAckable := int64(available) + sm.sentNotAcked
	if ackedBytes > maxAckable {
		return
	}

	if ackedBytes > 0 {
		consumeFromBuf := int(ackedBytes)
		if consumeFromBuf > available {
			consumeFromBuf = available
		}
		if err := sm.buf.Consume(consumeFromBuf); err != nil {
			return
		}
		sm.sentNotAcked -= ackedBytes
		if sm.sentNotAcked < 0 {
			sm.sentNotAcked = 0
		}
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

	if sm.terminalEvent != nil && !sm.terminalEventSent && sm.buf.Size() == 0 && sm.sentNotAcked == 0 {
		sm.sendTerminalEvent_withlock()
	}
}

// Close shuts down the sender loop and waits for the reader to finish
func (sm *StreamManager) Close() {
	sm.lock.Lock()
	sm.closed = true
	sm.drainCond.Signal()
	sm.lock.Unlock()

	sm.readerWg.Wait()
}

// readLoop is the main read goroutine
func (sm *StreamManager) readLoop() {
	defer sm.readerWg.Done()

	for {
		sm.lock.Lock()
		if sm.terminalEvent != nil {
			sm.lock.Unlock()
			return
		}

		isConnected := sm.connected && sm.drained
		sm.lock.Unlock()

		var readBuf []byte
		if isConnected {
			readBuf = make([]byte, 32*1024)
		} else {
			readBuf = make([]byte, DisconnReadSz)
		}

		n, err := sm.reader.Read(readBuf)

		if n > 0 {
			sm.handleReadData(readBuf[:n], isConnected)
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

func (sm *StreamManager) handleReadData(data []byte, isConnected bool) {
	sm.buf.Write(data)
	if isConnected {
		sm.sendBufferData()
	}
}

func (sm *StreamManager) handleEOF() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	sm.terminalEvent = &streamTerminalEvent{isEof: true}

	if sm.buf.Size() == 0 && sm.sentNotAcked == 0 && sm.connected && sm.drained {
		sm.sendTerminalEvent_withlock()
	}
}

func (sm *StreamManager) handleError(err error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	sm.terminalEvent = &streamTerminalEvent{err: err.Error()}

	if sm.buf.Size() == 0 && sm.sentNotAcked == 0 && sm.connected && sm.drained {
		sm.sendTerminalEvent_withlock()
	}
}

func (sm *StreamManager) senderLoop() {
	for {
		sm.lock.Lock()

		if sm.closed {
			sm.lock.Unlock()
			return
		}

		if !sm.connected {
			sm.drainCond.Wait()
			sm.lock.Unlock()
			continue
		}

		available := sm.buf.Size()
		if available == 0 {
			sm.drained = true
			if sm.terminalEvent != nil && !sm.terminalEventSent && sm.sentNotAcked == 0 {
				sm.sendTerminalEvent_withlock()
			}
			sm.drainCond.Wait()
			sm.lock.Unlock()
			continue
		}

		effectiveRwnd := sm.rwndSize
		if sm.cwndSize < effectiveRwnd {
			effectiveRwnd = sm.cwndSize
		}
		availableToSend := int64(effectiveRwnd) - sm.sentNotAcked

		if availableToSend <= 0 {
			sm.drainCond.Wait()
			sm.lock.Unlock()
			continue
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
			sm.lock.Unlock()
			continue
		}
		data = data[:n]

		seq := sm.buf.HeadPos() + sm.sentNotAcked
		sm.sentNotAcked += int64(n)
		dataSender := sm.dataSender
		sm.lock.Unlock()

		if dataSender == nil {
			continue
		}

		pkt := wshrpc.CommandStreamData{
			Id:     sm.streamId,
			Seq:    seq,
			Data64: base64.StdEncoding.EncodeToString(data),
		}
		dataSender.SendData(pkt)
	}
}

func (sm *StreamManager) sendBufferData() {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.drainCond.Signal()
}

func (sm *StreamManager) sendTerminalEvent_withlock() {
	if sm.terminalEventSent {
		return
	}

	if sm.dataSender == nil {
		return
	}

	seq := sm.buf.HeadPos()
	pkt := wshrpc.CommandStreamData{
		Id:  sm.streamId,
		Seq: seq,
	}

	if sm.terminalEvent.isEof {
		pkt.Eof = true
	} else {
		pkt.Error = sm.terminalEvent.err
	}

	sm.terminalEventSent = true
	sm.dataSender.SendData(pkt)
}
