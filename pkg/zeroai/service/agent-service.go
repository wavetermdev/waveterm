// Package service provides high-level service interfaces for ZeroAI
//
// AgentService manages agent lifecycle including creation, caching, and cleanup.
package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
)

// AgentService manages agent instances with caching support
type AgentService struct {
	mu sync.RWMutex

	// Agent cache: backend -> Agent
	agents map[string]agent.Agent
	// Agent configs: key (backend:configHash) -> AgentConfig
	configs map[string]agent.AgentConfig
	// Last accessed time for cache management
	lastAccessed map[string]time.Time

	// Factory for creating agents
	factory agent.AgentFactory

	// Cleanup configuration
	cleanupInterval time.Duration
	cacheMaxAge     time.Duration

	// Context for cleanup goroutine
	ctx        context.Context
	cancel     context.CancelFunc
	cleanupDone chan struct{}
}

// AgentServiceOption configures AgentService behavior
type AgentServiceOption func(*AgentService)

// WithCacheMaxAge sets the maximum age before cached agents are cleaned up
func WithCacheMaxAge(d time.Duration) AgentServiceOption {
	return func(s *AgentService) {
		s.cacheMaxAge = d
	}
}

// WithCleanupInterval sets the interval between cleanup cycles
func WithCleanupInterval(d time.Duration) AgentServiceOption {
	return func(s *AgentService) {
		s.cleanupInterval = d
	}
}

// NewAgentService creates a new AgentService
func NewAgentService(opts ...AgentServiceOption) *AgentService {
	ctx, cancel := context.WithCancel(context.Background())

	svc := &AgentService{
		agents:          make(map[string]agent.Agent),
		configs:         make(map[string]agent.AgentConfig),
		lastAccessed:    make(map[string]time.Time),
		factory:         NewAcpAgentFactory(),
		cleanupInterval: 5 * time.Minute,
		cacheMaxAge:     30 * time.Minute,
		ctx:             ctx,
		cancel:          cancel,
		cleanupDone:     make(chan struct{}),
	}

	// Apply options
	for _, opt := range opts {
		opt(svc)
	}

	// Start cleanup goroutine
	go svc.cleanupLoop()

	return svc
}

// GetAgent retrieves or creates an agent with the specified configuration
func (s *AgentService) GetAgent(ctx context.Context, config agent.AgentConfig) (agent.Agent, error) {
	// Create cache key based on backend and config hash
	configKey := s.configKey(config)

	s.mu.Lock()

	// Check cache first
	if cachedAgent, exists := s.agents[configKey]; exists {
		// Update last accessed time
		s.lastAccessed[configKey] = time.Now()
		s.mu.Unlock()

		// Verify agent is still running
		if cachedAgent.IsRunning() {
			return cachedAgent, nil
		}

		// Agent stopped, remove from cache and recreate
		s.mu.Lock()
		delete(s.agents, configKey)
		delete(s.lastAccessed, configKey)
		s.mu.Unlock()

		return s.GetAgent(ctx, config)
	}

	s.mu.Unlock()

	// Create new agent
	newAgent, err := s.factory.CreateAgent(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Start the agent
	if err := newAgent.Start(ctx); err != nil {
		return nil, fmt.Errorf("failed to start agent: %w", err)
	}

	// Cache the agent
	s.mu.Lock()
	s.agents[configKey] = newAgent
	s.configs[configKey] = config
	s.lastAccessed[configKey] = time.Now()
	s.mu.Unlock()

	return newAgent, nil
}

// ListAgents returns information about all cached agents
func (s *AgentService) ListAgents() []*AgentInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	infos := make([]*AgentInfo, 0, len(s.agents))

	for cacheKey, ag := range s.agents {
		config, hasConfig := s.configs[cacheKey]
		lastAccessed, hasAccess := s.lastAccessed[cacheKey]

		info := &AgentInfo{
			CacheKey:      cacheKey,
			IsRunning:     ag.IsRunning(),
			LastAccessed:  lastAccessed,
			Status:        ag.GetStatus(),
		}

		if hasConfig {
			info.Backend = config.Backend
			info.CliPath = config.CliPath
		}

		if hasAccess {
			age := time.Since(lastAccessed)
			info.CacheAge = &age
		}

		infos = append(infos, info)
	}

	return infos
}

// RemoveAgent removes an agent from the cache
func (s *AgentService) RemoveAgent(cacheKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ag, exists := s.agents[cacheKey]
	if !exists {
		return nil
	}

	// Stop the agent
	if ag.IsRunning() {
		if err := ag.Stop(); err != nil {
			return fmt.Errorf("failed to stop agent: %w", err)
		}
	}

	delete(s.agents, cacheKey)
	delete(s.configs, cacheKey)
	delete(s.lastAccessed, cacheKey)

	return nil
}

// Shutdown stops all cached agents and shuts down the service
func (s *AgentService) Shutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop all agents
	for cacheKey, ag := range s.agents {
		if ag.IsRunning() {
			if err := ag.Stop(); err != nil {
				// Log error but continue
				continue
			}
		}
		delete(s.agents, cacheKey)
		delete(s.configs, cacheKey)
		delete(s.lastAccessed, cacheKey)
	}

	// Cancel context to stop cleanup loop
	s.cancel()

	// Wait for cleanup loop to exit
	<-s.cleanupDone

	return nil
}

// cleanupLoop periodically cleans up stale cached agents
func (s *AgentService) cleanupLoop() {
	defer close(s.cleanupDone)

	ticker := time.NewTicker(s.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.cleanup()
		case <-s.ctx.Done():
			return
		}
	}
}

// cleanup removes stale agents from the cache
func (s *AgentService) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	staleKeys := []string{}

	for cacheKey, lastAccessed := range s.lastAccessed {
		age := now.Sub(lastAccessed)
		if age > s.cacheMaxAge {
			staleKeys = append(staleKeys, cacheKey)
		}
	}

	// Remove stale agents
	for _, cacheKey := range staleKeys {
		ag, exists := s.agents[cacheKey]
		if exists && ag.IsRunning() {
			// Try to stop the agent gracefully
			_ = ag.Stop()
		}
		delete(s.agents, cacheKey)
		delete(s.configs, cacheKey)
		delete(s.lastAccessed, cacheKey)
	}
}

// configKey generates a unique key for agent configuration
func (s *AgentService) configKey(config agent.AgentConfig) string {
	// Simple key based on backend and cli path
	// For more complex caching needs, we could hash the full config
	key := config.Backend
	if config.CliPath != "" {
		key += ":" + config.CliPath
	}
	return key
}

// AgentInfo provides information about a cached agent
type AgentInfo struct {
	CacheKey     string            `json:"cacheKey"`
	Backend      string            `json:"backend"`
	CliPath      string            `json:"cliPath,omitempty"`
	IsRunning    bool              `json:"isRunning"`
	LastAccessed time.Time         `json:"lastAccessed"`
	CacheAge     *time.Duration    `json:"cacheAge,omitempty"`
	Status       agent.AgentStatus `json:"status"`
}
