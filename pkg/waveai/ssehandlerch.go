// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// see /aiprompts/usechat-streamingproto.md for protocol

const (
	SSEContentType       = "text/event-stream"
	SSECacheControl      = "no-cache"
	SSEConnection        = "keep-alive"
	SSEKeepaliveMsg      = ": keepalive\n\n"
	SSEStreamStartMsg    = ": stream-start\n\n"
	SSEKeepaliveInterval = 1 * time.Second
)

// SSEMessageType represents the type of message to write
type SSEMessageType string

const (
	SSEMsgData    SSEMessageType = "data"
	SSEMsgEvent   SSEMessageType = "event"
	SSEMsgComment SSEMessageType = "comment"
	SSEMsgError   SSEMessageType = "error"
)

// AI message type constants
const (
	AiMsgStart          = "start"
	AiMsgTextStart      = "text-start"
	AiMsgTextDelta      = "text-delta"
	AiMsgTextEnd        = "text-end"
	AiMsgReasoningStart = "reasoning-start"
	AiMsgReasoningDelta = "reasoning-delta"
	AiMsgReasoningEnd   = "reasoning-end"
	AiMsgFinish         = "finish"
	AiMsgError          = "error"
)

// SSEMessage represents a message to be written to the SSE stream
type SSEMessage struct {
	Type      SSEMessageType
	Data      string
	EventType string // Only used for SSEMsgEvent
}

// SSEHandlerCh provides channel-based Server-Sent Events functionality
type SSEHandlerCh struct {
	w       http.ResponseWriter
	rc      *http.ResponseController
	ctx     context.Context
	writeCh chan SSEMessage
	errCh   chan error

	mu     sync.RWMutex
	closed bool
	err    error

	wg sync.WaitGroup
}

// MakeSSEHandlerCh creates a new channel-based SSE handler
func MakeSSEHandlerCh(w http.ResponseWriter, ctx context.Context) *SSEHandlerCh {
	return &SSEHandlerCh{
		w:       w,
		rc:      http.NewResponseController(w),
		ctx:     ctx,
		writeCh: make(chan SSEMessage, 10), // Buffered to prevent blocking
		errCh:   make(chan error, 1),       // Buffered for single error
	}
}

// SetupSSE configures the response headers and starts the writer goroutine
func (h *SSEHandlerCh) SetupSSE() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}

	// Reset write deadline for streaming
	if err := h.rc.SetWriteDeadline(time.Time{}); err != nil {
		return fmt.Errorf("failed to reset write deadline: %v", err)
	}

	// Set SSE headers
	h.w.Header().Set("Content-Type", SSEContentType)
	h.w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	h.w.Header().Set("Connection", SSEConnection)
	h.w.Header().Set("x-vercel-ai-ui-message-stream", "v1")
	h.w.Header().Set("X-Accel-Buffering", "no")
	h.w.Header().Set("Cache-Control", "no-transform")

	// Send headers and establish streaming
	h.w.WriteHeader(http.StatusOK)
	fmt.Fprint(h.w, SSEStreamStartMsg)
	if err := h.flush(); err != nil {
		return err
	}

	// Start the writer goroutine
	h.wg.Add(1)
	go h.writerLoop()

	return nil
}

// writerLoop handles all writes and keepalives in a single goroutine
func (h *SSEHandlerCh) writerLoop() {
	defer h.wg.Done()

	keepaliveTicker := time.NewTicker(SSEKeepaliveInterval)
	defer keepaliveTicker.Stop()

	for {
		select {
		case msg, ok := <-h.writeCh:
			if !ok {
				// Channel closed, send [DONE] and exit
				h.writeDirectly("[DONE]", SSEMsgData)
				return
			}

			if err := h.writeMessage(msg); err != nil {
				h.setError(err)
				return
			}

		case <-keepaliveTicker.C:
			if err := h.writeDirectly("keepalive", SSEMsgComment); err != nil {
				h.setError(err)
				return
			}

		case <-h.ctx.Done():
			return
		}
	}
}

// writeMessage writes a message to the SSE stream
func (h *SSEHandlerCh) writeMessage(msg SSEMessage) error {
	switch msg.Type {
	case SSEMsgData:
		return h.writeDirectly(msg.Data, SSEMsgData)
	case SSEMsgEvent:
		return h.writeEvent(msg.EventType, msg.Data)
	case SSEMsgComment:
		return h.writeDirectly(msg.Data, SSEMsgComment)
	case SSEMsgError:
		return h.writeDirectly(msg.Data, SSEMsgData)
	default:
		return fmt.Errorf("unknown message type: %s", msg.Type)
	}
}

// writeDirectly writes data directly to the response writer
func (h *SSEHandlerCh) writeDirectly(data string, msgType SSEMessageType) error {
	switch msgType {
	case SSEMsgData:
		_, err := fmt.Fprintf(h.w, "data: %s\n\n", data)
		if err != nil {
			return err
		}
	case SSEMsgComment:
		_, err := fmt.Fprintf(h.w, ": %s\n\n", data)
		if err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported direct write type: %s", msgType)
	}
	return h.flush()
}

// writeEvent writes an SSE event with optional event type
func (h *SSEHandlerCh) writeEvent(eventType, data string) error {
	if eventType != "" {
		if _, err := fmt.Fprintf(h.w, "event: %s\n", eventType); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(h.w, "data: %s\n\n", data); err != nil {
		return err
	}
	return h.flush()
}

// flush attempts to flush the response writer
func (h *SSEHandlerCh) flush() error {
	return h.rc.Flush()
}

// setError sets the error state thread-safely
func (h *SSEHandlerCh) setError(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.err == nil {
		h.err = err
		// Send error to error channel if there's space
		select {
		case h.errCh <- err:
		default:
		}
	}
}

// WriteData queues data to be written in SSE format
func (h *SSEHandlerCh) WriteData(data string) error {
	h.mu.RLock()
	closed := h.closed
	h.mu.RUnlock()

	if closed {
		return fmt.Errorf("SSE handler is closed")
	}

	select {
	case h.writeCh <- SSEMessage{Type: SSEMsgData, Data: data}:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	default:
		return fmt.Errorf("write channel is full")
	}
}

// WriteJsonData marshals data to JSON and queues it for writing
func (h *SSEHandlerCh) WriteJsonData(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %v", err)
	}
	return h.WriteData(string(jsonData))
}

// WriteError queues an error message and closes the handler
func (h *SSEHandlerCh) WriteError(errorMsg string) error {
	errorResp := map[string]interface{}{
		"type":      AiMsgError,
		"errorText": errorMsg,
	}
	if err := h.WriteJsonData(errorResp); err != nil {
		return err
	}
	h.Close()
	return nil
}

// WriteEvent queues an SSE event with optional event type
func (h *SSEHandlerCh) WriteEvent(eventType, data string) error {
	h.mu.RLock()
	closed := h.closed
	h.mu.RUnlock()

	if closed {
		return fmt.Errorf("SSE handler is closed")
	}

	select {
	case h.writeCh <- SSEMessage{Type: SSEMsgEvent, Data: data, EventType: eventType}:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	default:
		return fmt.Errorf("write channel is full")
	}
}

// WriteComment queues an SSE comment
func (h *SSEHandlerCh) WriteComment(comment string) error {
	h.mu.RLock()
	closed := h.closed
	h.mu.RUnlock()

	if closed {
		return fmt.Errorf("SSE handler is closed")
	}

	select {
	case h.writeCh <- SSEMessage{Type: SSEMsgComment, Data: comment}:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	default:
		return fmt.Errorf("write channel is full")
	}
}

// Err returns any error that occurred during writing
func (h *SSEHandlerCh) Err() error {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.err
}

// Close closes the write channel, sends [DONE], and cleans up resources
func (h *SSEHandlerCh) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true

	// Close the write channel, which will trigger [DONE] in writerLoop
	close(h.writeCh)
	h.mu.Unlock()

	// Wait for writer goroutine to finish (without holding the lock)
	h.wg.Wait()
}

// AI message writing methods

func (h *SSEHandlerCh) AiMsgStart(messageId string) error {
	resp := map[string]interface{}{
		"type":      AiMsgStart,
		"messageId": messageId,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgTextStart(textId string) error {
	resp := map[string]interface{}{
		"type": AiMsgTextStart,
		"id":   textId,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgTextDelta(textId string, text string) error {
	resp := map[string]interface{}{
		"type":  AiMsgTextDelta,
		"id":    textId,
		"delta": text,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgTextEnd(textId string) error {
	resp := map[string]interface{}{
		"type": AiMsgTextEnd,
		"id":   textId,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgFinish(finishReason string, usage interface{}) error {
	resp := map[string]interface{}{
		"type": AiMsgFinish,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgReasoningStart(reasoningId string) error {
	resp := map[string]interface{}{
		"type": AiMsgReasoningStart,
		"id":   reasoningId,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgReasoningDelta(reasoningId string, reasoning string) error {
	resp := map[string]interface{}{
		"type":  AiMsgReasoningDelta,
		"id":    reasoningId,
		"delta": reasoning,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgReasoningEnd(reasoningId string) error {
	resp := map[string]interface{}{
		"type": AiMsgReasoningEnd,
		"id":   reasoningId,
	}
	return h.WriteJsonData(resp)
}
