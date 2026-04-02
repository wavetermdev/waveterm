// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpc

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/service"
	"github.com/wavetermdev/waveterm/pkg/zeroai/store"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	// SSE message types for ZeroAI streaming
	ZeroAiMsgStart      = "start"
	ZeroAiMsgContent    = "content"
	ZeroAiMsgToolCall   = "tool_call"
	ZeroAiMsgPermission = "permission"
	ZeroAiMsgEndTurn    = "end_turn"
	ZeroAiMsgError      = "error"
	ZeroAiMsgDone       = "done"
)

// SSEMessage represents a streaming message to send via SSE
type SSEMessage struct {
	Type      string      `json:"type"`
	SessionID string      `json:"sessionId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// HTTPHandler provides HTTP/SSE endpoints for ZeroAI
type HTTPHandler struct {
	agentService  *service.AgentService
	messageService *service.MessageService
	sessionStore   store.SessionStore

	// Track active SSE connections
	activeStreams sync.Map // sessionID -> *sse.SSEHandlerCh
}

// NewHTTPHandler creates a new HTTP handler for ZeroAI streaming
func NewHTTPHandler(
	agentService *service.AgentService,
	messageService *service.MessageService,
	sessionStore store.SessionStore,
) *HTTPHandler {
	return &HTTPHandler{
		agentService:  agentService,
		messageService: messageService,
		sessionStore:   sessionStore,
	}
}

// SendMessageHandler handles POST requests to send a message and stream responses
// Endpoint: /zeroai/stream-message
// Request body:
//   {
//     "sessionId": "session-id",
//     "backend": "claude",
//     "message": "user query",
//     "files": ["file1.txt", "file2.txt"]
//   }
func (h *HTTPHandler) SendMessageHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow POST method
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate request
	if req.SessionID == "" {
		http.Error(w, "sessionId is required", http.StatusBadRequest)
		return
	}
	if req.Backend == "" {
		http.Error(w, "backend is required", http.StatusBadRequest)
		return
	}
	if req.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}

	// Get or create agent
	ctx := r.Context()
	agentConfig := agent.AgentConfig{
		Backend:       req.Backend,
		CliPath:       req.CliPath,
		SessionConfig: req.SessionConfig,
		Env:           req.Env,
	}

	ag, err := h.agentService.GetAgent(ctx, agentConfig)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get agent: %v", err), http.StatusInternalServerError)
		return
	}

	// Verify session exists
	session, err := ag.GetSession(req.SessionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Session not found: %v", err), http.StatusNotFound)
		return
	}

	// Set up SSE streaming
	sseHandler := sse.MakeSSEHandlerCh(w, ctx)
	defer sseHandler.Close()

	if err := sseHandler.SetupSSE(); err != nil {
		log.Printf("Failed to setup SSE: %v\n", err)
		http.Error(w, fmt.Sprintf("Failed to setup SSE: %v", err), http.StatusInternalServerError)
		return
	}

	// Track active stream
	h.activeStreams.Store(req.SessionID, sseHandler)
	defer h.activeStreams.Delete(req.SessionID)

	// Send start message
	if err := h.sendSSEMessage(sseHandler, SSEMessage{
		Type:      ZeroAiMsgStart,
		SessionID: req.SessionID,
		Data: map[string]interface{}{
			"sessionId": req.SessionID,
			"backend":   req.Backend,
			"session":   session,
			"createdAt": time.Now().Unix(),
		},
	}); err != nil {
		log.Printf("Failed to send start message: %v\n", err)
		return
	}

	// Build message input
	msgInput := agent.SendMessageInput{
		Content: req.Message,
		Files:   req.Files,
		Model:   req.Model,
		Metadata: map[string]interface{}{
			"handler": "http-sse",
		},
	}

	// Send message and stream events
	eventCh, err := ag.SendMessage(ctx, req.SessionID, msgInput)
	if err != nil {
		_ = h.sendSSEMessage(sseHandler, SSEMessage{
			Type:  ZeroAiMsgError,
			Error: fmt.Sprintf("Failed to send message: %v", err),
		})
		return
	}

	// Stream events to client
	for event := range eventCh {
		select {
		case <-ctx.Done():
			// Client disconnected
			return
		default:
			sseMsg := SSEMessage{
				Type:      string(event.Type),
				SessionID: req.SessionID,
			}

			// Handle event types
			switch event.Type {
			case agent.EventTypeContent:
				sseMsg.Data = map[string]interface{}{
					"content":   event.Data,
					"createdAt": event.Created,
				}
			case agent.EventTypeToolCall:
				sseMsg.Data = map[string]interface{}{
					"toolCall":  event.Data,
					"createdAt": event.Created,
				}
			case agent.EventTypePermission:
				sseMsg.Data = map[string]interface{}{
					"permission": event.Data,
					"createdAt":  event.Created,
				}
			case agent.EventTypeError:
				sseMsg.Data = map[string]interface{}{
					"error":     event.Error.Error(),
					"createdAt": event.Created,
				}
			case agent.EventTypeEndTurn:
				sseMsg.Data = map[string]interface{}{
					"endTurn":   true,
					"createdAt": event.Created,
				}
			}

			if err := h.sendSSEMessage(sseHandler, sseMsg); err != nil {
				log.Printf("Failed to send event: %v\n", err)
				return
			}
		}
	}

	// Send done message
	_ = h.sendSSEMessage(sseHandler, SSEMessage{
		Type:      ZeroAiMsgDone,
		SessionID: req.SessionID,
	})
}

// StreamSessionMessagesHandler streams messages for a session
// Endpoint: /zeroai/stream-messages?sessionId=xxx
func (h *HTTPHandler) StreamSessionMessagesHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		http.Error(w, "sessionId parameter is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Set up SSE streaming
	sseHandler := sse.MakeSSEHandlerCh(w, ctx)
	defer sseHandler.Close()

	if err := sseHandler.SetupSSE(); err != nil {
		log.Printf("Failed to setup SSE: %v\n", err)
		http.Error(w, fmt.Sprintf("Failed to setup SSE: %v", err), http.StatusInternalServerError)
		return
	}

	// Start streaming messages
	eventCh, err := h.messageService.StreamMessages(ctx, sessionID)
	if err != nil {
		_ = h.sendSSEMessage(sseHandler, SSEMessage{
			Type:  ZeroAiMsgError,
			Error: fmt.Sprintf("Failed to start message stream: %v", err),
		})
		return
	}

	// Send start message
	if err := h.sendSSEMessage(sseHandler, SSEMessage{
		Type:      "session_messages_start",
		SessionID: sessionID,
	}); err != nil {
		log.Printf("Failed to send start message: %v\n", err)
		return
	}

	// Stream messages
	for event := range eventCh {
		select {
		case <-ctx.Done():
			return
		default:
			if event.Error != nil {
				_ = h.sendSSEMessage(sseHandler, SSEMessage{
					Type:      ZeroAiMsgError,
					SessionID: sessionID,
					Error:     event.Error.Error(),
				})
				continue
			}

			if event.Message != nil {
				msg := event.Message
				_ = h.sendSSEMessage(sseHandler, SSEMessage{
					Type:      ZeroAiMsgContent,
					SessionID: msg.SessionID,
					Data: map[string]interface{}{
						"id":         msg.ID,
						"role":       msg.Role,
						"content":    msg.Content,
						"eventType":  msg.EventType,
						"metadata":   msg.Metadata,
						"createdAt":  msg.CreatedAt,
					},
				})
			}
		}
	}

	// Send done message
	_ = h.sendSSEMessage(sseHandler, SSEMessage{
		Type:      "session_messages_done",
		SessionID: sessionID,
	})
}

// StreamAgentStatusHandler streams agent status updates
// Endpoint: /zeroai/stream-status?backend=xxx
func (h *HTTPHandler) StreamAgentStatusHandler(w http.ResponseWriter, r *http.Request) {
	backend := r.URL.Query().Get("backend")

	ctx := r.Context()

	// Set up SSE streaming
	sseHandler := sse.MakeSSEHandlerCh(w, ctx)
	defer sseHandler.Close()

	if err := sseHandler.SetupSSE(); err != nil {
		log.Printf("Failed to setup SSE: %v\n", err)
		http.Error(w, fmt.Sprintf("Failed to setup SSE: %v", err), http.StatusInternalServerError)
		return
	}

	// Get agent info for specified backend
	agents := h.agentService.ListAgents()

	var targetAgent *service.AgentInfo
	for _, ag := range agents {
		if backend == "" || ag.Backend == backend {
			targetAgent = ag
			break
		}
	}

	// Send initial status
	if targetAgent != nil {
		_ = h.sendSSEMessage(sseHandler, SSEMessage{
			Type: "status",
			Data: map[string]interface{}{
				"cacheKey":     targetAgent.CacheKey,
				"backend":      targetAgent.Backend,
				"isRunning":    targetAgent.IsRunning,
				"status":       targetAgent.Status,
				"lastAccessed": targetAgent.LastAccessed.Unix(),
			},
		})
	} else {
		_ = h.sendSSEMessage(sseHandler, SSEMessage{
			Type: "status",
			Data: map[string]interface{}{
				"backend":   backend,
				"isRunning": false,
			},
		})
	}

	// Keep the connection alive - SSE handler sends keepalives automatically
	<-ctx.Done()
}

// RegisterRoutes registers HTTP routes for ZeroAI streaming
// Note: This is a convenience method; caller should integrate with their router
func (h *HTTPHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/zeroai/stream-message", h.SendMessageHandler)
	mux.HandleFunc("/zeroai/stream-messages", h.StreamSessionMessagesHandler)
	mux.HandleFunc("/zeroai/stream-status", h.StreamAgentStatusHandler)
}

// sendSSEMessage sends an SSE message to the client
func (h *HTTPHandler) sendSSEMessage(sseHandler *sse.SSEHandlerCh, msg SSEMessage) error {
	return sseHandler.WriteJsonData(msg)
}

// GetActiveStreamHandler returns the active SSE handler for a session
func (h *HTTPHandler) GetActiveStreamHandler(sessionID string) (*sse.SSEHandlerCh, bool) {
	if val, ok := h.activeStreams.Load(sessionID); ok {
		return val.(*sse.SSEHandlerCh), true
	}
	return nil, false
}

// SendMessageRequest represents the request body for sending a message
type SendMessageRequest struct {
	SessionID      string                 `json:"sessionId"`
	Backend        string                 `json:"backend"`
	Message        string                 `json:"message"`
	Files          []string               `json:"files,omitempty"`
	Model          string                 `json:"model,omitempty"`
	CliPath        string                 `json:"cliPath,omitempty"`
	SessionConfig  map[string]interface{} `json:"sessionConfig,omitempty"`
	Env            map[string]string      `json:"env,omitempty"`
}
