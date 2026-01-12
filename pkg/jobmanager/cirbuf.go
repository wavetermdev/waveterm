// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"context"
	"fmt"
	"sync"
)

type CirBuf struct {
	lock       sync.Mutex
	waiterChan chan chan struct{}
	buf        []byte
	readPos    int
	writePos   int
	count      int
	totalSize  int64
	syncMode   bool
	windowSize int
}

func MakeCirBuf(maxSize int, initSyncMode bool) *CirBuf {
	cb := &CirBuf{
		buf:        make([]byte, maxSize),
		syncMode:   initSyncMode,
		waiterChan: make(chan chan struct{}, 1),
		windowSize: maxSize,
	}
	return cb
}

// SetEffectiveWindow changes the sync mode and effective window size for flow control.
// The windowSize is capped at the buffer size.
// When window shrinks: data is preserved, sync mode blocks writes, async mode maintains data size.
// When window increases: blocked writers are woken up if space becomes available.
func (cb *CirBuf) SetEffectiveWindow(syncMode bool, windowSize int) {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	maxSize := len(cb.buf)
	if windowSize > maxSize {
		windowSize = maxSize
	}

	oldSyncMode := cb.syncMode
	oldWindowSize := cb.windowSize
	cb.windowSize = windowSize
	cb.syncMode = syncMode

	// Only sync mode blocks writers, so only wake if we were in sync mode.
	// Wake when window grows (more space available) or switching to async (no longer blocking).
	if oldSyncMode && (windowSize > oldWindowSize || !syncMode) {
		cb.tryWakeWriter()
	}
}

// Write will never block if syncMode is false
// If syncMode is true, write will block until enough data is consumed to allow the write to finish
// to cancel a write in progress use WriteCtx
func (cb *CirBuf) Write(data []byte) (int, error) {
	return cb.WriteCtx(context.Background(), data)
}

// WriteCtx writes data to the circular buffer with context support for cancellation.
// In sync mode, blocks when buffer is full until space is available or context is cancelled.
// Returns partial byte count and context error if cancelled mid-write.
// NOTE: Only one concurrent blocked write is allowed. Multiple blocked writes will panic.
func (cb *CirBuf) WriteCtx(ctx context.Context, data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}

	bytesWritten := 0
	for bytesWritten < len(data) {
		if err := ctx.Err(); err != nil {
			return bytesWritten, err
		}

		n, spaceAvailable := cb.writeAvailable(data[bytesWritten:])
		bytesWritten += n

		if spaceAvailable != nil {
			select {
			case <-spaceAvailable:
				continue
			case <-ctx.Done():
				tryReadCh(cb.waiterChan)
				return bytesWritten, ctx.Err()
			}
		}
	}

	return bytesWritten, nil
}

func (cb *CirBuf) writeAvailable(data []byte) (int, chan struct{}) {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	size := len(cb.buf)
	written := 0

	for i := 0; i < len(data); i++ {
		if cb.syncMode && cb.count >= cb.windowSize {
			spaceAvailable := make(chan struct{})
			if !tryWriteCh(cb.waiterChan, spaceAvailable) {
				panic("CirBuf: multiple concurrent blocked writes not allowed")
			}
			return written, spaceAvailable
		}

		cb.buf[cb.writePos] = data[i]
		cb.writePos = (cb.writePos + 1) % size
		if cb.count < cb.windowSize {
			cb.count++
		} else {
			cb.readPos = (cb.readPos + 1) % size
		}
		cb.totalSize++
		written++
	}

	return written, nil
}

func (cb *CirBuf) PeekData(data []byte) int {
	return cb.PeekDataAt(0, data)
}

func (cb *CirBuf) PeekDataAt(offset int, data []byte) int {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	if cb.count == 0 || offset >= cb.count {
		return 0
	}

	size := len(cb.buf)
	pos := (cb.readPos + offset) % size
	maxRead := cb.count - offset
	read := 0

	for i := 0; i < len(data) && i < maxRead; i++ {
		data[i] = cb.buf[pos]
		pos = (pos + 1) % size
		read++
	}

	return read
}

func (cb *CirBuf) Consume(numBytes int) error {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	if numBytes > cb.count {
		return fmt.Errorf("cannot consume %d bytes, only %d available", numBytes, cb.count)
	}

	size := len(cb.buf)
	cb.readPos = (cb.readPos + numBytes) % size
	cb.count -= numBytes

	cb.tryWakeWriter()

	return nil
}

func (cb *CirBuf) HeadPos() int64 {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	return cb.totalSize - int64(cb.count)
}

func (cb *CirBuf) Size() int {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	return cb.count
}

func (cb *CirBuf) TotalSize() int64 {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	return cb.totalSize
}

func tryWriteCh[T any](ch chan<- T, val T) bool {
	select {
	case ch <- val:
		return true
	default:
		return false
	}
}

func tryReadCh[T any](ch <-chan T) (*T, bool) {
	select {
	case rtn := <-ch:
		return &rtn, true
	default:
		return nil, false
	}
}

func (cb *CirBuf) tryWakeWriter() {
	if waiterCh, ok := tryReadCh(cb.waiterChan); ok {
		close(*waiterCh)
	}
}
