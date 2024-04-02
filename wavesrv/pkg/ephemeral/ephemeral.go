// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Manage output data streams for ephemeral commands. Allows passing a generic io.WriteCloser to downstream commands, which upstream callers can then wait on.
package ephemeral

import (
	"bytes"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

const DefaultEphemeralTimeoutMs = 5000

// Options specific to ephemeral commands (commands that are not saved to the history)
type EphemeralRunOpts struct {
	OverrideCwd     string         `json:"overridecwd,omitempty"` // A directory to use as the current working directory. Defaults to the last set shell state.
	TimeoutMs       int64          `json:"timeoutms"`             // The maximum time to wait for the command to complete. If the command does not complete within this time, it is killed.
	ExpectsResponse bool           `json:"expectsresponse"`       // If set, the command is expected to return a response. If this is false, ResposeWriter is not set.
	ResponseWriter  io.WriteCloser `json:"-"`                     // A writer to receive the command's output. If not set, the command's output is discarded. (set by remote.go)
	Canceled        atomic.Bool    `json:"canceled,omitempty"`    // If set, the command was canceled before it completed.
}

// A wrapper for an io.Writer that implements the io.Closer interface. Written outputs will be buffered until the writer is marked as ready. Upstream callers can wait for the writer to be closed.
type EphemeralWriteCloser struct {
	downstreamWriter io.Writer      // the downstream writer, where data will be written once it is ready
	buffer           bytes.Buffer   // buffer of data to be written to the downstream writer once it is ready
	writeLock        sync.Mutex     // lock for writing to the buffer and writer
	ready            bool           // whether the downstream writer is ready to be written to
	closed           atomic.Bool    // whether the writer has been closed
	closeWait        sync.WaitGroup // allows waiting for the writer to be closed
}

// Create a new EphemeralWriteCloser with the given downstream io.Writer.
func NewEphemeralWriteCloser(w io.Writer) *EphemeralWriteCloser {
	newEwc := &EphemeralWriteCloser{
		downstreamWriter: w,
		buffer:           bytes.Buffer{},
		writeLock:        sync.Mutex{},
		ready:            false,
		closed:           atomic.Bool{},
		closeWait:        sync.WaitGroup{},
	}

	// Increment the closeWait counter. This activates the WaitGroup. Calling Done() will decrement the counter.
	newEwc.closeWait.Add(1)
	return newEwc
}

// Write data to the downstream writer. If the downstream writer is not ready, the data will be written to the buffer.
func (ewc *EphemeralWriteCloser) Write(p []byte) (n int, err error) {
	if ewc.closed.Load() {
		return 0, io.ErrClosedPipe
	}

	defer ewc.writeLock.Unlock()
	ewc.writeLock.Lock()
	if !ewc.ready {
		// The writer is not ready, so write to the buffer
		return ewc.buffer.Write(p)
	} else {
		// The writer is ready, so write directly to the underlying writer
		return ewc.downstreamWriter.Write(p)
	}
}

// Mark the downstream writer as ready to be written to. Any buffered data will be written to the downstream writer before subsequent writes.
func (ewc *EphemeralWriteCloser) Ready() {
	defer ewc.writeLock.Unlock()
	ewc.writeLock.Lock()
	ewc.ready = true
	// Write any buffered data to the underlying writer and reset the buffer
	ewc.downstreamWriter.Write(ewc.buffer.Bytes())
	ewc.buffer.Reset()
}

// Close the writer. This will mark the writer as closed and unblock any goroutines waiting for the writer to be closed.
func (ewc *EphemeralWriteCloser) Close() error {
	ewc.closed.Store(true)
	ewc.closeWait.Done()
	return nil
}

// Wait for the writer to be closed. This will block until the writer is closed or the timeout is reached.
func (ewc *EphemeralWriteCloser) WaitWithTimeout(timeout time.Duration) bool {
	c := make(chan struct{})
	go func() {
		defer close(c)
		ewc.closeWait.Wait()
	}()
	select {
	case <-c:
		return false // completed normally
	case <-time.After(timeout):
		return true // timed out
	}
}

// Ensure that EphemeralWriteCloser implements the io.WriteCloser interface.
var _ io.WriteCloser = (*EphemeralWriteCloser)(nil)
