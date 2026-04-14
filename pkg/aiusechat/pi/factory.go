// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pi

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Factory creates and manages pi backend instances keyed by chat ID.
// Each chat gets its own pi subprocess.
type Factory struct {
	backends map[string]*Backend
}

// NewFactory creates a new pi backend factory.
func NewFactory() *Factory {
	return &Factory{
		backends: make(map[string]*Backend),
	}
}

// NewBackendForChat creates a new pi backend for the given chat and config.
// If a backend already exists for this chatId, it returns the existing one.
func (f *Factory) NewBackendForChat(chatId string, chatOpts uctypes.WaveChatOpts) (*Backend, error) {
	if existing, ok := f.backends[chatId]; ok {
		return existing, nil
	}

	// Build pi manager config from chatOpts
	cfg := ManagerConfig{
		BinPath:   filepath.Join(wavebase.GetWaveAppBinPath(), "pi"),
		Provider:  chatOpts.Config.Provider,
		ModelID:   chatOpts.Config.Model,
		SessionDir:  "", // TODO: derive from waveterm config
		NoSession:   false,
	}

	// Provider must be set — pi needs to know which LLM to use
	if cfg.Provider == "" {
		cfg.Provider = "anthropic" // sensible default
		cfg.ModelID = "claude-sonnet-4-20250514"
	}

	// TODO: pass the parent context from chatOpts
	mgr, err := NewManager(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to start pi subprocess: %w", err)
	}

	backend := NewBackend(mgr)
	f.backends[chatId] = backend
	return backend, nil
}

// GetBackend returns an existing backend for the given chatId, or nil if none exists.
func (f *Factory) GetBackend(chatId string) *Backend {
	return f.backends[chatId]
}

// CloseBackend closes and removes the backend for the given chatId.
func (f *Factory) CloseBackend(chatId string) {
	if backend, ok := f.backends[chatId]; ok {
		backend.mgr.Kill()
		delete(f.backends, chatId)
	}
}

// CloseAll closes all backends.
func (f *Factory) CloseAll() {
	for chatId := range f.backends {
		f.CloseBackend(chatId)
	}
}
