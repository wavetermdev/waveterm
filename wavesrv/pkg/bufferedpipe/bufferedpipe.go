// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bufferedpipe

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/promptenc"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
)

const (
	BufferedPipeMapTTL    = 30 * time.Second     // The time-to-live for a buffered pipe in the map of buffered pipes.
	BufferedPipeGetterUrl = "/api/buffered-pipe" // The URL for getting the output of a buffered pipe.
)

// A pipe that allows for lazy writing to a downstream writer. Data written to the pipe is buffered until WriteTo is called.
type BufferedPipe struct {
	Key            string       // a unique key for the writer
	buffer         bytes.Buffer // buffer of data to be written to the downstream writer once it is ready
	closed         atomic.Bool  // whether the writer has been closed
	bufferDataCond sync.Cond    // Condition variable to signal that the buffer has data
}

// Create a new BufferedPipe with a timeout. The writer will be closed after the timeout
func NewBufferedPipe(timeout time.Duration) *BufferedPipe {
	newPipe := &BufferedPipe{
		Key:            uuid.New().String(),
		buffer:         bytes.Buffer{},
		closed:         atomic.Bool{},
		bufferDataCond: sync.Cond{L: &sync.Mutex{}},
	}
	SetBufferedPipe(newPipe)
	time.AfterFunc(timeout, func() {
		newPipe.Close()
	})
	return newPipe
}

// Get the URL for reading the output of the pipe.
func (pipe *BufferedPipe) GetOutputUrl() (string, error) {
	qvals := make(url.Values)
	qvals.Set("key", pipe.Key)
	qvals.Set("nonce", uuid.New().String())
	hmacStr, err := promptenc.ComputeUrlHmac([]byte(scbase.WaveAuthKey), BufferedPipeGetterUrl, qvals)
	if err != nil {
		return "", err
	}

	qvals.Set("hmac", hmacStr)
	return BufferedPipeGetterUrl + "?" + qvals.Encode(), nil
}

// Write data to the buffer.
func (pipe *BufferedPipe) Write(p []byte) (n int, err error) {
	if pipe.closed.Load() {
		return 0, io.ErrClosedPipe
	}

	defer func() {
		pipe.bufferDataCond.L.Unlock()
		pipe.bufferDataCond.Broadcast()
	}()
	pipe.bufferDataCond.L.Lock()

	return pipe.buffer.Write(p)
}

// Write all buffered data to a waiting writer and block, sending all subsequent data until the pipe is closed. Only one goroutine should call this method.
func (pipe *BufferedPipe) WriteTo(w io.Writer) (n int64, err error) {
	defer pipe.bufferDataCond.L.Unlock()
	pipe.bufferDataCond.L.Lock()
	for {
		n1, err := pipe.buffer.WriteTo(w)
		if err != nil {
			return n, err
		}
		n += n1

		if pipe.closed.Load() {
			break
		}
		pipe.bufferDataCond.Wait()
	}
	return n, nil
}

// Close the pipe. This will cause any blocking WriteTo calls to return.
func (pipe *BufferedPipe) Close() error {
	defer pipe.bufferDataCond.Broadcast()
	pipe.closed.Store(true)
	return nil
}

// Ensure that BufferedPipe implements the io.WriteCloser and io.WriterTo interfaces.
var _ io.WriteCloser = (*BufferedPipe)(nil)
var _ io.WriterTo = (*BufferedPipe)(nil)

type BufferedPipeMap struct {
	_map map[string]*BufferedPipe
	lock sync.Mutex
}

// A global map of registered buffered pipes.
var bufferedPipes = BufferedPipeMap{_map: make(map[string]*BufferedPipe)}

// Get a buffered pipe from the map of buffered pipes, given a key.
func GetBufferedPipe(key string) (*BufferedPipe, bool) {
	bufferedPipes.lock.Lock()
	defer bufferedPipes.lock.Unlock()

	ewc, ok := bufferedPipes._map[key]
	return ewc, ok
}

// Set a buffered pipe in the map of buffered pipes.
func SetBufferedPipe(pipe *BufferedPipe) {
	bufferedPipes.lock.Lock()
	defer bufferedPipes.lock.Unlock()
	key := pipe.Key
	bufferedPipes._map[key] = pipe

	// Remove the buffered pipe after a certain amount of time
	time.AfterFunc(BufferedPipeMapTTL, func() {
		bufferedPipes.lock.Lock()
		defer bufferedPipes.lock.Unlock()
		pipe.Close()
		log.Printf("removing buffered pipe %s", key)
		delete(bufferedPipes._map, key)
	})
}

// Handle a request to get the output of a buffered pipe, given a key.
func HandleGetBufferedPipeOutput(w http.ResponseWriter, r *http.Request) {
	log.Printf("GET %s", r.URL.Path)
	qvals := r.URL.Query()
	key := qvals.Get("key")
	log.Printf("key: %s", key)
	pipe, ok := GetBufferedPipe(key)
	if !ok {
		http.Error(w, "buffered pipe not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	_, err := pipe.WriteTo(w)
	if err != nil {
		http.Error(w, "error writing from buffer", http.StatusInternalServerError)
		return
	}
}
