// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

const (
	SSEContentType    = "text/event-stream"
	SSECacheControl   = "no-cache"
	SSEConnection     = "keep-alive"
	SSEKeepaliveMsg   = ": keepalive\n\n"
	SSEStreamStartMsg = ": stream-start\n\n"
)

// SSEHandler wraps an http.ResponseWriter to provide Server-Sent Events functionality
type SSEHandler struct {
	w               http.ResponseWriter
	rc              *http.ResponseController
	keepaliveTicker *time.Ticker
	done            chan bool
	ctx             context.Context
	closed          bool
}

// MakeSSEHandler creates a new SSE handler wrapping the given ResponseWriter
func MakeSSEHandler(w http.ResponseWriter, ctx context.Context) *SSEHandler {
	return &SSEHandler{
		w:   w,
		rc:  http.NewResponseController(w),
		ctx: ctx,
	}
}

// SetupSSE configures the response headers and deadline for SSE streaming
func (h *SSEHandler) SetupSSE() error {
	// Reset write deadline for streaming to prevent timeouts
	if err := h.rc.SetWriteDeadline(time.Time{}); err != nil {
		log.Printf("failed to reset write deadline for streaming: %v", err)
		return err
	}

	// Set SSE headers
	h.w.Header().Set("Content-Type", SSEContentType)
	h.w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	h.w.Header().Set("Connection", SSEConnection)
	h.w.Header().Set("x-vercel-ai-ui-message-stream", "v1")
	h.w.Header().Set("X-Accel-Buffering", "no")       // Disable nginx buffering
	h.w.Header().Set("Cache-Control", "no-transform") // Prevent proxy transformation

	// Send headers and establish streaming
	h.w.WriteHeader(http.StatusOK)
	fmt.Fprint(h.w, SSEStreamStartMsg)
	return h.flush()
}

// StartKeepalive begins sending periodic keepalive messages
func (h *SSEHandler) StartKeepalive() {
	if h.keepaliveTicker != nil {
		return // Already started
	}

	h.keepaliveTicker = time.NewTicker(1 * time.Second)
	h.done = make(chan bool)

	go func() {
		defer func() {
			if h.keepaliveTicker != nil {
				h.keepaliveTicker.Stop()
			}
		}()

		for {
			select {
			case <-h.keepaliveTicker.C:
				fmt.Fprint(h.w, SSEKeepaliveMsg)
				h.flush()
			case <-h.done:
				return
			case <-h.ctx.Done():
				return
			}
		}
	}()
}

// StopKeepalive stops sending keepalive messages
func (h *SSEHandler) StopKeepalive() {
	if h.keepaliveTicker != nil {
		h.keepaliveTicker.Stop()
		h.keepaliveTicker = nil
	}
	if h.done != nil {
		close(h.done)
		h.done = nil
	}
}

// WriteData writes data in SSE format with proper formatting and flushing
func (h *SSEHandler) WriteData(data string) error {
	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}
	_, err := fmt.Fprintf(h.w, "data: %s\n\n", data)
	if err != nil {
		return err
	}
	return h.flush()
}

// WriteJsonData marshals the given data to JSON and writes it in SSE format
func (h *SSEHandler) WriteJsonData(data interface{}) error {
	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %v", err)
	}
	return h.WriteData(string(jsonData))
}

// WriteError writes an error message in SSE format and sends the done signal
func (h *SSEHandler) WriteError(errorMsg string) error {
	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}
	errorResp := map[string]interface{}{
		"type":      "error",
		"errorText": errorMsg,
	}
	if err := h.WriteJsonData(errorResp); err != nil {
		return err
	}
	return h.WriteDone()
}

// WriteEvent writes an SSE event with optional event type
func (h *SSEHandler) WriteEvent(eventType, data string) error {
	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}
	if eventType != "" {
		fmt.Fprintf(h.w, "event: %s\n", eventType)
	}
	fmt.Fprintf(h.w, "data: %s\n\n", data)
	return h.flush()
}

// WriteComment writes an SSE comment (for keepalive or debugging)
func (h *SSEHandler) WriteComment(comment string) error {
	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}
	_, err := fmt.Fprintf(h.w, ": %s\n\n", comment)
	if err != nil {
		return err
	}
	return h.flush()
}

// WriteDone sends the standard SSE done message and closes the handler
func (h *SSEHandler) WriteDone() error {
	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}
	err := h.WriteData("[DONE]")
	h.Close()
	return err
}

// flush attempts to flush the response writer
func (h *SSEHandler) flush() error {
	if err := h.rc.Flush(); err != nil {
		// client closed connection, or flush not supported
		return err
	}
	return nil
}

// Close stops keepalive and cleans up resources
func (h *SSEHandler) Close() {
	if h.closed {
		return
	}
	h.closed = true
	h.StopKeepalive()
}