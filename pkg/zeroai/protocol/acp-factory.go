// Package protocol implements ACP (Agent Control Protocol) connection factories
//
// This file provides factory functions for creating ACP connections for different backends.
package protocol

// NewClaudeConnection creates a new ACP connection for Claude backend
func NewClaudeConnection() Connection {
	return &AcpConnection{
		config: AcpSessionConfig{
			Backend: AcpBackendClaude,
		},
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
}

// NewQwenConnection creates a new ACP connection for Qwen backend
func NewQwenConnection() Connection {
	return &AcpConnection{
		config: AcpSessionConfig{
			Backend: AcpBackendQwen,
		},
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
}

// NewCodexConnection creates a new ACP connection for Codex backend
func NewCodexConnection() Connection {
	return &AcpConnection{
		config: AcpSessionConfig{
			Backend: AcpBackendCodex,
		},
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
}

// NewOpenCodeConnection creates a new ACP connection for OpenCode backend
func NewOpenCodeConnection() Connection {
	return &AcpConnection{
		config: AcpSessionConfig{
			Backend: AcpBackendOpenCode,
		},
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
}

// NewGeminiConnection creates a new ACP connection for Gemini backend
func NewGeminiConnection() Connection {
	return &AcpConnection{
		config: AcpSessionConfig{
			Backend: AcpBackendGemini,
		},
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
}

// NewCustomConnection creates a new ACP connection for a custom backend
func NewCustomConnection(backend AcpBackend) Connection {
	return &AcpConnection{
		config: AcpSessionConfig{
			Backend: backend,
		},
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
}

// NewConnection creates a new ACP connection based on backend type
func NewConnection(backend AcpBackend) Connection {
	switch backend {
	case AcpBackendClaude:
		return NewClaudeConnection()
	case AcpBackendQwen:
		return NewQwenConnection()
	case AcpBackendCodex:
		return NewCodexConnection()
	case AcpBackendOpenCode:
		return NewOpenCodeConnection()
	case AcpBackendGemini:
		return NewGeminiConnection()
	default:
		return NewCustomConnection(backend)
	}
}
