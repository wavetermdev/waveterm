// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/store"
)

// MessageService provides business logic for message operations
// It wraps the MessageStore and provides coordination with Agent events
type MessageService struct {
	store store.MessageStore

	// Streaming channels
	streamSubs map[string][]chan store.Message // sessionID -> subscriber channels
	streamMu   sync.RWMutex
}

// NewMessageService creates a new message service
func NewMessageService(msgStore store.MessageStore) (*MessageService, error) {
	if msgStore == nil {
		return nil, fmt.Errorf("message store is required")
	}

	return &MessageService{
		store:      msgStore,
		streamSubs: make(map[string][]chan store.Message),
	}, nil
}

// AddMessage stores a new message
func (s *MessageService) AddMessage(msg *store.Message) error {
	if msg == nil {
		return fmt.Errorf("message is required")
	}
	if msg.SessionID == "" {
		return fmt.Errorf("session ID is required")
	}
	if msg.Role == "" {
		return fmt.Errorf("role is required")
	}

	now := time.Now().Unix()
	if msg.CreatedAt == 0 {
		msg.CreatedAt = now
	}

	// Store the message
	if err := s.store.Add(msg); err != nil {
		return fmt.Errorf("failed to add message: %w", err)
	}

	// Notify streaming subscribers (send message by value for channel)
	msgCopy := *msg
	s.notifySubscribers(msgCopy)

	return nil
}

// GetSessionMessages retrieves all messages for a session
func (s *MessageService) GetSessionMessages(sessionID string) ([]*store.Message, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("session ID is required")
	}

	messages, err := s.store.GetSessionMessages(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session messages: %w", err)
	}

	return messages, nil
}

// StreamMessageEvent represents a streamed message event
type StreamMessageEvent struct {
	Message *store.Message
	Error   error
}

// StreamMessages streams messages for a session via a channel
// Returns a channel that receives messages as they are added to the session
// The channel must be consumed in a goroutine
func (s *MessageService) StreamMessages(ctx context.Context, sessionID string) (<-chan StreamMessageEvent, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("session ID is required")
	}

	// Create subscriber channel
	msgCh := make(chan store.Message, 100)
	eventCh := make(chan StreamMessageEvent, 100)

	// Register subscriber
	s.streamMu.Lock()
	if s.streamSubs[sessionID] == nil {
		s.streamSubs[sessionID] = []chan store.Message{}
	}
	s.streamSubs[sessionID] = append(s.streamSubs[sessionID], msgCh)
	s.streamMu.Unlock()

	// Send existing messages first
	go func() {
		messages, err := s.GetSessionMessages(sessionID)
		if err == nil {
			for _, msg := range messages {
				select {
				case eventCh <- StreamMessageEvent{Message: msg}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	// Forward streamed messages
	go func() {
		defer func() {
			// Clean up subscriber on exit
			s.streamMu.Lock()
			sessions := s.streamSubs[sessionID]
			for i, ch := range sessions {
				if ch == msgCh {
					s.streamSubs[sessionID] = append(sessions[:i], sessions[i+1:]...)
					break
				}
			}
			close(msgCh)
			s.streamMu.Unlock()
			close(eventCh)
		}()

		for {
			select {
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				select {
				case eventCh <- StreamMessageEvent{Message: &msg}:
				case <-ctx.Done():
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	return eventCh, nil
}

// StreamFromAgentStreams messages from agent events to message store
// This method subscribes to agent events and stores them as messages
func (s *MessageService) StreamFromAgent(
	ctx context.Context,
	sessionID string,
	agentEvents <-chan agent.AgentEvent,
) error {
	if sessionID == "" {
		return fmt.Errorf("session ID is required")
	}

	go func() {
		for agentEvent := range agentEvents {
			// Add to store for agent response messages
			switch agentEvent.Type {
			case agent.EventTypeContent:
				// Store text chunks
				if agentEvent.Data != nil {
					// Map data to Message
					msg := &store.Message{
						SessionID: sessionID,
						Role:      "assistant",
						CreatedAt: agentEvent.Created,
					}

					// Extract content from different data types
					if dataMap, ok := agentEvent.Data.(map[string]interface{}); ok {
						if content, ok := dataMap["content"].(string); ok {
							msg.Content = content
						}
						if metadata, ok := dataMap["metadata"]; ok {
							if jsonBytes, err := json.Marshal(metadata); err == nil {
								msg.Metadata = string(jsonBytes)
							}
						}
					}

					if msg.Content != "" {
						msg.EventType = "text_chunk"
						_ = s.AddMessage(msg) // Ignore errors in streaming context
					}
				}

			case agent.EventTypeToolCall:
				// Store tool calls
				msg := &store.Message{
					SessionID: sessionID,
					Role:      "assistant",
					EventType: "tool_call",
					CreatedAt: agentEvent.Created,
				}

				if agentEvent.Data != nil {
					if jsonBytes, err := json.Marshal(agentEvent.Data); err == nil {
						msg.Content = string(jsonBytes)
						msg.Metadata = string(jsonBytes)
					}
				}

				_ = s.AddMessage(msg)

			case agent.EventTypePermission:
				// Store permission requests
				msg := &store.Message{
					SessionID: sessionID,
					Role:      "assistant",
					EventType: "permission",
					CreatedAt: agentEvent.Created,
				}

				if agentEvent.Data != nil {
					if jsonBytes, err := json.Marshal(agentEvent.Data); err == nil {
						msg.Content = string(jsonBytes)
						msg.Metadata = string(jsonBytes)
					}
				}

				_ = s.AddMessage(msg)

			case agent.EventTypeError:
				// Store errors
				msg := &store.Message{
					SessionID: sessionID,
					Role:      "assistant",
					EventType: "error",
					Content:   agentEvent.Error.Error(),
					CreatedAt: agentEvent.Created,
				}

				_ = s.AddMessage(msg)

			case agent.EventTypeEndTurn:
				// Mark end of turn with special message
				msg := &store.Message{
					SessionID: sessionID,
					Role:      "assistant",
					EventType: "end_turn",
					Content:   "",
					CreatedAt: agentEvent.Created,
				}

				_ = s.AddMessage(msg)
			}

			// Check context
			select {
			case <-ctx.Done():
				return
			default:
			}
		}
	}()

	return nil
}

// DeleteSessionMessages deletes all messages for a session
func (s *MessageService) DeleteSessionMessages(sessionID string) error {
	if sessionID == "" {
		return fmt.Errorf("session ID is required")
	}

	// Delete from store
	if err := s.store.Delete(sessionID); err != nil {
		return fmt.Errorf("failed to delete session messages: %w", err)
	}

	// Clear streaming subscribers
	s.streamMu.Lock()
	delete(s.streamSubs, sessionID)
	s.streamMu.Unlock()

	return nil
}

// notifySubscribers sends a message to all subscribers for a session
func (s *MessageService) notifySubscribers(msg store.Message) {
	s.streamMu.RLock()
	subs := s.streamSubs[msg.SessionID]
	s.streamMu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- msg:
			// Successfully sent
		case <-time.After(100 * time.Millisecond):
			// Channel full or slow, skip
		default:
			// Channel closed, will be cleaned up on next unsubscribe
		}
	}
}
