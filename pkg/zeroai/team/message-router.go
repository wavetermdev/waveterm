// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package team

import (
	"context"
	"sync"
	"time"
)

// MessageType represents the type of message being sent
type MessageType string

const (
	// MessageTypeAgentToAgent indicates a direct message between agents
	MessageTypeAgentToAgent MessageType = "agent_to_agent"
	// MessageTypeTaskAssignment indicates a task assignment message
	MessageTypeTaskAssignment MessageType = "task_assignment"
	// MessageTypeStatusUpdate indicates a status update message
	MessageTypeStatusUpdate MessageType = "status_update"
	// MessageTypeBroadcast indicates a broadcast message to all agents
	MessageTypeBroadcast MessageType = "broadcast"
)

// Message is the base message type for agent-to-agent communication
type Message struct {
	ID        string      `json:"id"`
	Type      MessageType `json:"type"`
	From      string      `json:"from"`
	To        string      `json:"to"` // empty for broadcast
	Payload   interface{} `json:"payload"`
	Timestamp int64       `json:"timestamp"`
}

// AgentToAgentMessage payload for direct agent communication
type AgentToAgentMessage struct {
	Content string `json:"content"`
}

// TaskAssignment payload for task assignment messages
type TaskAssignment struct {
	TaskID     string            `json:"taskId"`
	TeamID     string            `json:"teamId"`
	Parameters map[string]string `json:"parameters"`
	Priority   int               `json:"priority"`
}

// StatusUpdate payload for status update messages
type StatusUpdate struct {
	StatusCode string            `json:"statusCode"`
	Message    string            `json:"message"`
	Data       map[string]string `json:"data,omitempty"`
}

// MessageQueue manages messages for a specific agent
type MessageQueue struct {
	messages chan *Message
	closed   bool
	mu       sync.RWMutex
}

// NewMessageQueue creates a new message queue with the specified buffer size
func NewMessageQueue(bufferSize int) *MessageQueue {
	return &MessageQueue{
		messages: make(chan *Message, bufferSize),
		closed:   false,
	}
}

// Enqueue adds a message to the queue (non-blocking if queue is full)
func (mq *MessageQueue) Enqueue(msg *Message) bool {
	mq.mu.RLock()
	if mq.closed {
		mq.mu.RUnlock()
		return false
	}
	mq.mu.RUnlock()

	select {
	case mq.messages <- msg:
		return true
	default:
		return false // queue is full
	}
}

// Dequeue retrieves and removes a message from the queue (blocking)
func (mq *MessageQueue) Dequeue(block bool) *Message {
	if block {
		return <-mq.messages
	}

	select {
	case msg := <-mq.messages:
		return msg
	default:
		return nil // no message available
	}
}

// DequeueWithTimeout retrieves a message with a timeout
func (mq *MessageQueue) DequeueWithTimeout(timeout time.Duration) *Message {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	select {
	case msg := <-mq.messages:
		return msg
	case <-ctx.Done():
		return nil
	}
}

// Close closes the message queue, dropping all pending messages
func (mq *MessageQueue) Close() {
	mq.mu.Lock()
	defer mq.mu.Unlock()

	if !mq.closed {
		mq.closed = true
		close(mq.messages)
	}
}

// IsClosed returns whether the queue is closed
func (mq *MessageQueue) IsClosed() bool {
	mq.mu.RLock()
	defer mq.mu.RUnlock()
	return mq.closed
}

// Len returns the current number of messages in the queue
func (mq *MessageQueue) Len() int {
	return len(mq.messages)
}

// MessageRouter handles routing messages between agents
type MessageRouter struct {
	queues map[string]*MessageQueue // agent ID -> message queue
	mu     sync.RWMutex
	closed bool
}

// NewMessageRouter creates a new message router
func NewMessageRouter() *MessageRouter {
	return &MessageRouter{
		queues: make(map[string]*MessageQueue),
		closed: false,
	}
}

// RegisterAgent registers an agent with the router, creating its message queue
func (mr *MessageRouter) RegisterAgent(agentID string, bufferSize int) bool {
	mr.mu.Lock()
	defer mr.mu.Unlock()

	if mr.closed {
		return false
	}

	if _, exists := mr.queues[agentID]; exists {
		return false // already registered
	}

	mr.queues[agentID] = NewMessageQueue(bufferSize)
	return true
}

// UnregisterAgent removes an agent from the router
func (mr *MessageRouter) UnregisterAgent(agentID string) bool {
	mr.mu.Lock()
	defer mr.mu.Unlock()

	queue, exists := mr.queues[agentID]
	if !exists {
		return false
	}

	queue.Close()
	delete(mr.queues, agentID)
	return true
}

// GetQueue returns the message queue for a specific agent
func (mr *MessageRouter) GetQueue(agentID string) (*MessageQueue, bool) {
	mr.mu.RLock()
	defer mr.mu.RUnlock()

	queue, exists := mr.queues[agentID]
	return queue, exists
}

// SendToAgent sends a message to a specific agent
func (mr *MessageRouter) SendToAgent(from, to string, msgType MessageType, payload interface{}) bool {
	message := &Message{
		ID:        generateMessageID(from, to),
		Type:      msgType,
		From:      from,
		To:        to,
		Payload:   payload,
		Timestamp: time.Now().Unix(),
	}

	return mr.routeMessage(message)
}

// Broadcast sends a message to all registered agents (excluding the sender)
func (mr *MessageRouter) Broadcast(from string, msgType MessageType, payload interface{}) []bool {
	message := &Message{
		ID:        generateMessageID(from, "broadcast"),
		Type:      msgType,
		From:      from,
		To:        "", // empty for broadcast
		Payload:   payload,
		Timestamp: time.Now().Unix(),
	}

	mr.mu.RLock()
	defer mr.mu.RUnlock()

	if mr.closed {
		return nil
	}

	results := make([]bool, 0, len(mr.queues)-1)

	for agentID, queue := range mr.queues {
		if agentID == from {
			continue // skip sender
		}

		// Create a copy for each recipient
		msgCopy := *message
		msgCopy.ID = generateMessageID(from, agentID)

		results = append(results, queue.Enqueue(&msgCopy))
	}

	return results
}

// routeMessage routes a message to the appropriate queue
func (mr *MessageRouter) routeMessage(msg *Message) bool {
	if msg.Type == MessageTypeBroadcast || msg.To == "" {
		// Handle broadcast separately
		return mr.Broadcast(msg.From, msg.Type, msg.Payload) != nil
	}

	mr.mu.RLock()
	defer mr.mu.RUnlock()

	if mr.closed {
		return false
	}

	queue, exists := mr.queues[msg.To]
	if !exists {
		return false // target agent not registered
	}

	return queue.Enqueue(msg)
}

// GetRegisteredAgents returns a list of all registered agent IDs
func (mr *MessageRouter) GetRegisteredAgents() []string {
	mr.mu.RLock()
	defer mr.mu.RUnlock()

	agents := make([]string, 0, len(mr.queues))
	for agentID := range mr.queues {
		agents = append(agents, agentID)
	}

	return agents
}

// Close shuts down the message router, closing all queues
func (mr *MessageRouter) Close() {
	mr.mu.Lock()
	defer mr.mu.Unlock()

	if mr.closed {
		return
	}

	mr.closed = true

	for _, queue := range mr.queues {
		queue.Close()
	}

	mr.queues = make(map[string]*MessageQueue)
}

// IsClosed returns whether the router is closed
func (mr *MessageRouter) IsClosed() bool {
	mr.mu.RLock()
	defer mr.mu.RUnlock()
	return mr.closed
}

// generateMessageID generates a unique message ID
func generateMessageID(from, to string) string {
	return from + "→" + to + ":" + time.Now().Format("20060102T150405.999")
}
