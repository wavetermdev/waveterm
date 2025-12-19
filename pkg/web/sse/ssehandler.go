// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/utilds"
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
	AiMsgStart               = "start"
	AiMsgTextStart           = "text-start"
	AiMsgTextDelta           = "text-delta"
	AiMsgTextEnd             = "text-end"
	AiMsgReasoningStart      = "reasoning-start"
	AiMsgReasoningDelta      = "reasoning-delta"
	AiMsgReasoningEnd        = "reasoning-end"
	AiMsgToolInputStart      = "tool-input-start"
	AiMsgToolInputDelta      = "tool-input-delta"
	AiMsgToolInputAvailable  = "tool-input-available"
	AiMsgToolOutputAvailable = "tool-output-available" // not used here, but reserved
	AiMsgStartStep           = "start-step"
	AiMsgFinishStep          = "finish-step"
	AiMsgFinish              = "finish"
	AiMsgError               = "error"
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
	ctx     context.Context // the r.Context()
	writeCh chan SSEMessage

	lock        sync.Mutex
	closed      bool
	initialized bool
	err         error

	wg              sync.WaitGroup
	onCloseHandlers utilds.IdList[func()]
	handlersRun     bool
}

// MakeSSEHandlerCh creates a new channel-based SSE handler
func MakeSSEHandlerCh(w http.ResponseWriter, ctx context.Context) *SSEHandlerCh {
	return &SSEHandlerCh{
		w:       w,
		rc:      http.NewResponseController(w),
		ctx:     ctx,
		writeCh: make(chan SSEMessage, 10), // Buffered to prevent blocking
	}
}

// SetupSSE configures the response headers and starts the writer goroutine
func (h *SSEHandlerCh) SetupSSE() error {
	h.lock.Lock()
	defer h.lock.Unlock()

	if h.closed {
		return fmt.Errorf("SSE handler is closed")
	}

	h.initialized = true

	// Reset write deadline for streaming
	if err := h.rc.SetWriteDeadline(time.Time{}); err != nil {
		return fmt.Errorf("failed to reset write deadline: %v", err)
	}

	// Set SSE headers
	h.w.Header().Set("Content-Type", SSEContentType)
	h.w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate, no-transform")
	h.w.Header().Set("Connection", SSEConnection)
	h.w.Header().Set("x-vercel-ai-ui-message-stream", "v1")
	h.w.Header().Set("X-Accel-Buffering", "no")

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
	defer h.runOnCloseHandlers()

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
			h.setError(h.ctx.Err())
			return
		}
	}
}

// writeMessage writes a message to the SSE stream
func (h *SSEHandlerCh) writeMessage(msg SSEMessage) error {
	if h.ctx.Err() != nil {
		return h.ctx.Err()
	}
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

// isInitialized returns whether SetupSSE has been called
func (h *SSEHandlerCh) isInitialized() bool {
	h.lock.Lock()
	defer h.lock.Unlock()
	return h.initialized
}

// writeDirectly writes data directly to the response writer
func (h *SSEHandlerCh) writeDirectly(data string, msgType SSEMessageType) error {
	if !h.isInitialized() {
		panic("SSEHandlerCh not initialized - call SetupSSE first")
	}
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
		panic(fmt.Sprintf("unsupported direct write type: %s", msgType))
	}
	return h.flush()
}

// writeEvent writes an SSE event with optional event type
func (h *SSEHandlerCh) writeEvent(eventType, data string) error {
	if !h.isInitialized() {
		panic("SSEHandlerCh not initialized - call SetupSSE first")
	}
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
	h.lock.Lock()
	defer h.lock.Unlock()

	if h.err == nil {
		h.err = err
	}
}

// queueMessage queues an SSEMessage to be written
func (h *SSEHandlerCh) queueMessage(msg SSEMessage) error {
	h.lock.Lock()
	closed := h.closed
	h.lock.Unlock()

	if closed {
		return fmt.Errorf("SSE handler is closed")
	}

	if err := h.Err(); err != nil {
		return err
	}

	select {
	case h.writeCh <- msg:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	default:
		return fmt.Errorf("write channel is full")
	}
}

// WriteData queues data to be written in SSE format
func (h *SSEHandlerCh) WriteData(data string) error {
	return h.queueMessage(SSEMessage{Type: SSEMsgData, Data: data})
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
	return h.queueMessage(SSEMessage{Type: SSEMsgEvent, Data: data, EventType: eventType})
}

// WriteComment queues an SSE comment
func (h *SSEHandlerCh) WriteComment(comment string) error {
	return h.queueMessage(SSEMessage{Type: SSEMsgComment, Data: comment})
}

// Err returns any error that occurred during writing
func (h *SSEHandlerCh) Err() error {
	h.lock.Lock()
	defer h.lock.Unlock()
	if h.err == nil && h.ctx.Err() != nil {
		h.err = h.ctx.Err()
	}
	return h.err
}

// RegisterOnClose registers a handler function to be called when the connection closes
// Returns an ID that can be used to unregister the handler
func (h *SSEHandlerCh) RegisterOnClose(fn func()) string {
	h.lock.Lock()
	defer h.lock.Unlock()
	return h.onCloseHandlers.Register(fn)
}

// UnregisterOnClose removes a previously registered onClose handler by ID
func (h *SSEHandlerCh) UnregisterOnClose(id string) {
	h.lock.Lock()
	defer h.lock.Unlock()
	h.onCloseHandlers.Unregister(id)
}

// runOnCloseHandlers runs all registered onClose handlers exactly once
func (h *SSEHandlerCh) runOnCloseHandlers() {
	h.lock.Lock()
	if h.handlersRun {
		h.lock.Unlock()
		return
	}
	h.handlersRun = true
	h.lock.Unlock()

	handlers := h.onCloseHandlers.GetList()
	for _, fn := range handlers {
		fn()
	}
}

// Close closes the write channel, sends [DONE], and cleans up resources
func (h *SSEHandlerCh) Close() {
	h.lock.Lock()
	if h.closed || !h.initialized {
		h.lock.Unlock()
		return
	}
	h.closed = true

	// Close the write channel, which will trigger [DONE] in writerLoop
	close(h.writeCh)
	h.lock.Unlock()

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

func (h *SSEHandlerCh) AiMsgToolInputStart(toolCallId, toolName string) error {
	resp := map[string]interface{}{
		"type":       AiMsgToolInputStart,
		"toolCallId": toolCallId,
		"toolName":   toolName,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgToolInputDelta(toolCallId, inputTextDelta string) error {
	resp := map[string]interface{}{
		"type":           AiMsgToolInputDelta,
		"toolCallId":     toolCallId,
		"inputTextDelta": inputTextDelta,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgToolInputAvailable(toolCallId, toolName string, input json.RawMessage) error {
	resp := map[string]interface{}{
		"type":       AiMsgToolInputAvailable,
		"toolCallId": toolCallId,
		"toolName":   toolName,
		"input":      json.RawMessage(input),
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgStartStep() error {
	resp := map[string]interface{}{
		"type": AiMsgStartStep,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgFinishStep() error {
	resp := map[string]interface{}{
		"type": AiMsgFinishStep,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgError(errText string) error {
	resp := map[string]interface{}{
		"type":      AiMsgError,
		"errorText": errText,
	}
	return h.WriteJsonData(resp)
}

func (h *SSEHandlerCh) AiMsgData(dataType string, id string, data interface{}) error {
	if !strings.HasPrefix(dataType, "data-") {
		panic(fmt.Sprintf("AiMsgData type must start with 'data-', got: %s", dataType))
	}
	resp := map[string]interface{}{
		"type": dataType,
		"id":   id,
		"data": data,
	}
	return h.WriteJsonData(resp)
}
