// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package messageservice

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/store"
	"github.com/wavetermdev/waveterm/pkg/zeroai/types"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

// MessageService coordinates message operations between Agent and MessageStore
type MessageService struct {
	store store.MessageStore
}

// MessageServiceInstance is the singleton instance
var MessageServiceInstance = &MessageService{}

//SendMessageInput represents input for sending a message to an agent
type SendMessageInput struct {
	SessionID string                 `json:"sessionId"`
	Content   string                 `json:"content"`
	Files     []string               `json:"files,omitempty"`
	Model     string                 `json:"model,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// SendMessageEvent represents a streaming event from SendMessage
type SendMessageEvent struct {
	Type      string                 `json:"type"` // "content", "tool_call", "permission", "error", "end_turn"
	SessionID string                 `json:"session"`
	Data      interface{}            `json:"data,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Created   int64                  `json:"created"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Message represents a message for GetMessages response
type Message struct {
	ID        int64                  `json:"id"`
	SessionID string                 `json:"sessionId"`
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	EventType string                 `json:"eventType,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt int64                  `json:"createdAt"`
}

// SetStore sets the message store for the service
func (ms *MessageService) SetStore(s store.MessageStore) {
	ms.store = s
}

// SendMessage sends a message to the agent and returns a streaming event channel
// The channel can be read via GetMessageEvents method through the RPC stream
func (ms *MessageService) SendMessage_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send a message to an agent session with streaming events",
		ArgNames: []string{"ctx", "input"},
	}
}

func (ms *MessageService) SendMessage(ctx context.Context, input SendMessageInput) (string, error) {
	if ms.store == nil {
		return "", fmt.Errorf("message store not initialized")
	}

	// Validate input
	if input.SessionID == "" {
		return "", fmt.Errorf("session ID is required")
	}
	if input.Content == "" {
		return "", fmt.Errorf("content is required")
	}

	// Generate stream ID for this message send
	streamID := uuid.New().String()

	// Store the user message
	userMsg := &store.Message{
		SessionID: input.SessionID,
		Role:      "user",
		Content:   input.Content,
		EventType: "",
		Metadata:  serializeMetadata(input.Metadata),
		CreatedAt: time.Now().Unix(),
	}

	if err := ms.store.Add(userMsg); err != nil {
		return "", fmt.Errorf("failed to store user message: %w", err)
	}

	// Note: The actual streaming to agent happens through the agent's SendMessage method
	// This service layer coordinates storage and returns a stream ID for the caller
	// to listen for events via GetMessageEvents (or the agent's event channel)

	return streamID, nil
}

// SendMessageWithStream sends a message and returns an event channel
// This is the internal method used by coordinator to get actual stream
func (ms *MessageService) SendMessageWithStream(
	ctx context.Context,
	agentClient agent.Agent,
	input SendMessageInput,
) (<-chan SendMessageEvent, error) {
	if ms.store == nil {
		return nil, fmt.Errorf("message store not initialized")
	}

	// Validate input
	if input.SessionID == "" {
		return nil, fmt.Errorf("session ID is required")
	}
	if input.Content == "" {
		return nil, fmt.Errorf("content is required")
	}

	// Store the user message
	userMsg := &store.Message{
		SessionID: input.SessionID,
		Role:      "user",
		Content:   input.Content,
		EventType: "",
		Metadata:  serializeMetadata(input.Metadata),
		CreatedAt: time.Now().Unix(),
	}

	if err := ms.store.Add(userMsg); err != nil {
		return nil, fmt.Errorf("failed to store user message: %w", err)
	}

	// Create agent message input
	agentInput := agent.SendMessageInput{
		Content:  input.Content,
		Files:    input.Files,
		Model:    input.Model,
		Metadata: input.Metadata,
	}

	// Send message via agent
	agentEvents, err := agentClient.SendMessage(ctx, input.SessionID, agentInput)
	if err != nil {
		return nil, fmt.Errorf("failed to send message to agent: %w", err)
	}

	// Convert agent events to message service events
	eventCh := make(chan SendMessageEvent, 100)

	go func() {
		defer close(eventCh)

		for agentEvent := range agentEvents {
			// Store AI response chunks
			if agentEvent.Type == agent.EventTypeContent && agentEvent.Data != nil {
				if chunk, ok := agentEvent.Data.(*types.ZeroAiSessionChunk); ok {
					aiMsg := &store.Message{
						SessionID: input.SessionID,
						Role:      "assistant",
						Content:   chunk.Content,
						EventType: "text_chunk",
						Metadata:  serializeMetadata(chunk.Metadata),
						CreatedAt: agentEvent.Created,
					}
					_ = ms.store.Add(aiMsg) // Ignore errors in streaming context
				}
			}

			// Convert toSendMessageEvent
			msgEvent := SendMessageEvent{
				Type:      string(agentEvent.Type),
				SessionID: agentEvent.Session,
				// Data:      agentEvent.Data, // Note: Data may not be JSON serializable directly
				Created:  agentEvent.Created,
				Metadata: input.Metadata,
			}

			// Handle error
			if agentEvent.Error != nil {
				msgEvent.Error = agentEvent.Error.Error()
				msgEvent.Type = "error"
			}

			// Handle data serialization
			if agentEvent.Data != nil {
				switch v := agentEvent.Data.(type) {
				case *types.ZeroAiSessionChunk:
					msgEvent.Data = map[string]interface{}{
						"content":  v.Content,
						"metadata": v.Metadata,
					}
				case *types.ZeroAiToolCallData:
					msgEvent.Data = v
				case *types.ZeroAiPermissionData:
					msgEvent.Data = v
				case *types.ZeroAiPlanUpdate:
					msgEvent.Data = v
				default:
					// Try to serialize as JSON
					if jsonBytes, err := json.Marshal(v); err == nil {
						var dataMap interface{}
						json.Unmarshal(jsonBytes, &dataMap)
						msgEvent.Data = dataMap
					}
				}
			}

			// Send event or timeout
			select {
			case eventCh <- msgEvent:
			case <-time.After(100 * time.Millisecond):
				// Channel full, skip
			case <-ctx.Done():
				return
			}
		}
	}()

	return eventCh, nil
}

// GetMessages retrieves all messages for a session
func (ms *MessageService) GetMessages_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get all messages for an agent session",
		ArgNames: []string{"ctx", "sessionId"},
	}
}

func (ms *MessageService) GetMessages(ctx context.Context, sessionID string) ([]Message, error) {
	if ms.store == nil {
		return nil, fmt.Errorf("message store not initialized")
	}

	// Validate input
	if sessionID == "" {
		return nil, fmt.Errorf("session ID is required")
	}

	// Get messages from store
	storeMessages, err := ms.store.GetSessionMessages(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	// Convert to service layer messages
	messages := make([]Message, len(storeMessages))
	for i, msg := range storeMessages {
		messages[i] = Message{
			ID:        msg.ID,
			SessionID: msg.SessionID,
			Role:      msg.Role,
			Content:   msg.Content,
			EventType: msg.EventType,
			CreatedAt: msg.CreatedAt,
		}

		// Parse metadata if present
		if msg.Metadata != "" {
			var metadata map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Metadata), &metadata); err == nil {
				messages[i].Metadata = metadata
			}
		}
	}

	return messages, nil
}

// serializeMetadata converts metadata to JSON string for storage
func serializeMetadata(metadata map[string]interface{}) string {
	if metadata == nil || len(metadata) == 0 {
		return ""
	}

	jsonBytes, err := json.Marshal(metadata)
	if err != nil {
		return ""
	}

	return string(jsonBytes)
}
