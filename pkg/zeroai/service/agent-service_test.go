// Package service tests for AgentService
package service

import (
	"testing"
	"time"
)

// TestNewAgentService creates a service with default options
func TestNewAgentService(t *testing.T) {
	svc := NewAgentService()
	defer svc.Shutdown()

	if svc == nil {
		t.Fatal("expected non-nil service")
	}
}

// TestNewAgentServiceWithOptions tests service creation with options
func TestNewAgentServiceWithOptions(t *testing.T) {
	svc := NewAgentService(
		WithCacheMaxAge(1*time.Minute),
		WithCleanupInterval(1*time.Minute),
	)
	defer svc.Shutdown()

	if svc == nil {
		t.Fatal("expected non-nil service")
	}
}

// TestAcpAgentFactory creates factory without errors
func TestAcpAgentFactory(t *testing.T) {
	factory := NewAcpAgentFactory()
	if factory == nil {
		t.Fatal("expected non-nil factory")
	}
}

// TestGetSupportedBackends returns expected backends
func TestGetSupportedBackends(t *testing.T) {
	factory := NewAcpAgentFactory()
	backends := factory.GetSupportedBackends()

	if len(backends) == 0 {
		t.Fatal("expected at least one backend")
	}

	// Check for expected backends
	hasClaude := false
	hasQwen := false
	for _, b := range backends {
		if b == "claude" {
			hasClaude = true
		}
		if b == "qwen" {
			hasQwen = true
		}
	}

	if !hasClaude {
		t.Error("expected 'claude' backend")
	}
	if !hasQwen {
		t.Error("expected 'qwen' backend")
	}
}

// TestListAgents returns empty list initially
func TestListAgents(t *testing.T) {
	svc := NewAgentService()
	defer svc.Shutdown()

	agents := svc.ListAgents()
	if len(agents) != 0 {
		t.Errorf("expected 0 agents, got %d", len(agents))
	}
}

// TestAgentServiceShutdown stops service cleanly
func TestAgentServiceShutdown(t *testing.T) {
	svc := NewAgentService()

	if err := svc.Shutdown(); err != nil {
		t.Fatalf("expected clean shutdown, got: %v", err)
	}
}
