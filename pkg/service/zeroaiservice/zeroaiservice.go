// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package zeroaiservice

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/store"
)

const DefaultTimeout = 2 * time.Second

// ZeroaiService manages AI agent sessions and coordinates between Agent and SessionStore
type ZeroaiService struct {
	mu sync.RWMutex

	// Agent instance for managing sessions
	agent agent.Agent

	// Session store for persistence
	sessionStore store.SessionStore

	// Track if service is initialized
	initialized bool
}

// NewZeroaiService creates a new ZeroaiService instance
func NewZeroaiService() *ZeroaiService {
	return &ZeroaiService{
		initialized: false,
	}
}

// Initialize initializes the service with an agent instance
func (svc *ZeroaiService) Initialize(agentInstance agent.Agent, sessionStore store.SessionStore) error {
	svc.mu.Lock()
	defer svc.mu.Unlock()

	if svc.initialized {
		return fmt.Errorf("service already initialized")
	}

	svc.agent = agentInstance
	svc.sessionStore = sessionStore
	svc.initialized = true

	return nil
}

// ensureInitialized checks if the service is initialized
func (svc *ZeroaiService) ensureInitialized() error {
	svc.mu.RLock()
	defer svc.mu.RUnlock()

	if !svc.initialized {
		return fmt.Errorf("service not initialized")
	}

	return nil
}

// SetWorkDir sets the working directory for a session
// This updates the session's WorkDir field in both the agent and the store
func (svc *ZeroaiService) SetWorkDir(sessionID string, workDir string) (waveobj.UpdatesRtnType, error) {
	if err := svc.ensureInitialized(); err != nil {
		return nil, err
	}

	// Get the session from the agent
	session, err := svc.agent.GetSession(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Create a copy to update
	session.WorkDir = workDir
	session.UpdatedAt = time.Now().Unix()

	// Convert to store session
	storeSession := &store.Session{
		ID:            session.ID,
		Backend:       session.Backend,
		WorkDir:       session.WorkDir,
		Model:         session.Model,
		Provider:      session.Provider,
		ThinkingLevel: session.ThinkingLevel,
		CreatedAt:     session.CreatedAt,
		UpdatedAt:     session.UpdatedAt,
		// Metadata would need to be serialized if present
	}

	// Update in store
	if err := svc.sessionStore.Update(storeSession); err != nil {
		return nil, fmt.Errorf("failed to update session in store: %w", err)
	}

	return nil, nil
}

// GetSession returns a session by ID
func (svc *ZeroaiService) GetSession(sessionID string) (*agent.AgentSession, error) {
	if err := svc.ensureInitialized(); err != nil {
		return nil, err
	}

	return svc.agent.GetSession(sessionID)
}

// ListSessions returns all sessions
func (svc *ZeroaiService) ListSessions() ([]*agent.AgentSession, error) {
	if err := svc.ensureInitialized(); err != nil {
		return nil, err
	}

	return svc.agent.ListSessions()
}

// DeleteSession deletes a session
func (svc *ZeroaiService) DeleteSession(sessionID string) (waveobj.UpdatesRtnType, error) {
	if err := svc.ensureInitialized(); err != nil {
		return nil, err
	}

	if err := svc.agent.DeleteSession(sessionID); err != nil {
		return nil, fmt.Errorf("failed to delete session from agent: %w", err)
	}

	if err := svc.sessionStore.Delete(sessionID); err != nil {
		return nil, fmt.Errorf("failed to delete session from store: %w", err)
	}

	return nil, nil
}

// CreateSession creates a new session
func (svc *ZeroaiService) CreateSession(ctx context.Context, opts agent.AgentSessionOptions) (*agent.AgentSession, error) {
	if err := svc.ensureInitialized(); err != nil {
		return nil, err
	}

	// Create session via agent
	session, err := svc.agent.CreateSession(ctx, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to create session in agent: %w", err)
	}

	// Store in database
	storeSession := &store.Session{
		ID:            session.ID,
		Backend:       session.Backend,
		WorkDir:       session.WorkDir,
		Model:         session.Model,
		Provider:      session.Provider,
		ThinkingLevel: session.ThinkingLevel,
		CreatedAt:     session.CreatedAt,
		UpdatedAt:     session.UpdatedAt,
	}

	if err := svc.sessionStore.Create(storeSession); err != nil {
		return nil, fmt.Errorf("failed to store session: %w", err)
	}

	return session, nil
}

// Service Methods for RPC

func (svc *ZeroaiService) SetWorkDir_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"sessionId", "workDir"},
	}
}

func (svc *ZeroaiService) GetSession_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"sessionId"},
		ReturnDesc: "AgentSession",
	}
}

func (svc *ZeroaiService) ListSessions_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ReturnDesc: "[]AgentSession",
	}
}

func (svc *ZeroaiService) DeleteSession_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"sessionId"},
	}
}

func (svc *ZeroaiService) CreateSession_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "workDir", "model", "resumeSession"},
		ReturnDesc: "AgentSession",
	}
}
