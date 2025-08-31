// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveapp

import (
	"bytes"
	"net/http"

	"github.com/wavetermdev/waveterm/tsunami/rpc"
)

const maxChunkSize = 64 * 1024 // 64KB maximum chunk size

// StreamingResponseWriter implements http.ResponseWriter interface to stream response
// data through a channel rather than buffering it in memory. This is particularly
// useful for handling large responses like video streams or file downloads.
type StreamingResponseWriter struct {
	header     http.Header
	statusCode int
	respChan   chan<- rpc.RespOrErrorUnion[rpc.VDomUrlRequestResponse]
	headerSent bool
	buffer     *bytes.Buffer
}

func NewStreamingResponseWriter(respChan chan<- rpc.RespOrErrorUnion[rpc.VDomUrlRequestResponse]) *StreamingResponseWriter {
	return &StreamingResponseWriter{
		header:     make(http.Header),
		statusCode: http.StatusOK,
		respChan:   respChan,
		headerSent: false,
		buffer:     bytes.NewBuffer(make([]byte, 0, maxChunkSize)),
	}
}

func (w *StreamingResponseWriter) Header() http.Header {
	return w.header
}

func (w *StreamingResponseWriter) WriteHeader(statusCode int) {
	if w.headerSent {
		return
	}

	w.statusCode = statusCode
	w.headerSent = true

	headers := make(map[string]string)
	for key, values := range w.header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}

	w.respChan <- rpc.RespOrErrorUnion[rpc.VDomUrlRequestResponse]{
		Response: rpc.VDomUrlRequestResponse{
			StatusCode: w.statusCode,
			Headers:    headers,
		},
	}
}

// sendChunk sends a single chunk of exactly maxChunkSize (or less)
func (w *StreamingResponseWriter) sendChunk(data []byte) {
	if len(data) == 0 {
		return
	}
	chunk := make([]byte, len(data))
	copy(chunk, data)
	w.respChan <- rpc.RespOrErrorUnion[rpc.VDomUrlRequestResponse]{
		Response: rpc.VDomUrlRequestResponse{
			Body: chunk,
		},
	}
}

func (w *StreamingResponseWriter) Write(data []byte) (int, error) {
	if !w.headerSent {
		w.WriteHeader(http.StatusOK)
	}

	originalLen := len(data)

	// If we already have data in the buffer
	if w.buffer.Len() > 0 {
		// Fill the buffer up to maxChunkSize
		spaceInBuffer := maxChunkSize - w.buffer.Len()
		if spaceInBuffer > 0 {
			// How much of the new data can fit in the buffer
			toBuffer := spaceInBuffer
			if toBuffer > len(data) {
				toBuffer = len(data)
			}
			w.buffer.Write(data[:toBuffer])
			data = data[toBuffer:] // Advance data slice
		}

		// If buffer is full, send it
		if w.buffer.Len() == maxChunkSize {
			w.sendChunk(w.buffer.Bytes())
			w.buffer.Reset()
		}
	}

	// Send any full chunks from data
	for len(data) >= maxChunkSize {
		w.sendChunk(data[:maxChunkSize])
		data = data[maxChunkSize:]
	}

	// Buffer any remaining data
	if len(data) > 0 {
		w.buffer.Write(data)
	}

	return originalLen, nil
}

func (w *StreamingResponseWriter) Close() error {
	if !w.headerSent {
		w.WriteHeader(http.StatusOK)
	}

	if w.buffer.Len() > 0 {
		w.sendChunk(w.buffer.Bytes())
		w.buffer.Reset()
	}
	return nil
}
