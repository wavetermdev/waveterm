// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package service

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/store"
)

// SessionService provides business logic for session operations
// It coordinates between Agent interface and SessionStore
type SessionService struct {
	agent agent.Agent
	store store.SessionStore
}

// NewSessionService creates a new session service
func NewSessionService(ag agent.Agent, sessionStore store.SessionStore) (*SessionService, error) {
	if ag == nil {
		return nil, fmt.Errorf("agent is required")
	}
	if sessionStore == nil {
		return nil, fmt.Errorf("session store is required")
	}

	return &SessionService{
		agent: ag,
		store: sessionStore,
	}, nil
}

// CreateSession creates a new session
func (s *SessionService) CreateSession(ctx context.Context, opts agent.AgentSessionOptions) (*agent.AgentSession, error) {
	// Create session via agent
	session, err := s.agent.CreateSession(ctx, opts)
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

	if err := s.store.Create(storeSession); err != nil {
		return nil, fmt.Errorf("failed to store session: %w", err)
	}

	return session, nil
}

// GetSession retrieves a session by ID
func (s *SessionService) GetSession(sessionID string) (*agent.AgentSession, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("session ID is required")
	}

	return s.agent.GetSession(sessionID)
}

// ListSessions returns all sessions
func (s *SessionService) ListSessions() ([]*agent.AgentSession, error) {
	return s.agent.ListSessions()
}

// DeleteSession deletes a session
func (s *SessionService) DeleteSession(sessionID string) error {
	if sessionID == "" {
		return fmt.Errorf("session ID is required")
	}

	if err := s.agent.DeleteSession(sessionID); err != nil {
		return fmt.Errorf("failed to delete session from agent: %w", err)
	}

	if err := s.store.Delete(sessionID); err != nil {
		return fmt.Errorf("failed to delete session from store: %w", err)
	}

	return nil
}

// SetWorkDir sets the working directory for a session
func (s *SessionService) SetWorkDir(sessionID string, workDir string) error {
	if sessionID == "" {
		return fmt.Errorf("session ID is required")
	}

	// Get the session from the agent to verify it exists
	_, err := s.agent.GetSession(sessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}

	// Create a copy to update (workdir update is done via session reload
	// in actual implementation - for now just update in store)
	storeSession, err := s.store.Get(sessionID)
	if err != nil {
		return fmt.Errorf("failed to get session from store: %w", err)
	}

	storeSession.WorkDir = workDir

	// Update in store
	if err := s.store.Update(storeSession); err != nil {
		return fmt.Errorf("failed to update session in store: %w", err)
	}

	return nil
}
