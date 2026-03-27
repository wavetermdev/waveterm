// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package databus implements a shared, context-cancellable data bus that
// fetches real-time financial data from external sources (Hyperliquid,
// CoinGecko, Aave, Uniswap) and publishes events on the Wave PubSub system.
//
// Usage:
//
//	bus := databus.New()
//	ctx, cancel := context.WithCancel(context.Background())
//	defer cancel()
//	bus.Start(ctx)
package databus

import (
	"context"
	"sync"
)

// Bus coordinates all data-source fetchers.
type Bus struct {
	mu       sync.Mutex
	fetchers []Fetcher
}

// Fetcher is implemented by each data source (Hyperliquid, CoinGecko, etc.).
type Fetcher interface {
	// Name returns a human-readable identifier used in logs and metrics.
	Name() string
	// Start begins fetching and publishing events.  It must return when ctx
	// is cancelled.
	Start(ctx context.Context)
}

// New creates an empty Bus.  Register fetchers with Register before calling
// Start.
func New() *Bus {
	return &Bus{}
}

// Register adds a Fetcher to the bus.  Must be called before Start.
func (b *Bus) Register(f Fetcher) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fetchers = append(b.fetchers, f)
}

// Start launches all registered fetchers in separate goroutines and blocks
// until ctx is cancelled.
func (b *Bus) Start(ctx context.Context) {
	b.mu.Lock()
	fetchers := make([]Fetcher, len(b.fetchers))
	copy(fetchers, b.fetchers)
	b.mu.Unlock()

	var wg sync.WaitGroup
	for _, f := range fetchers {
		f := f
		wg.Add(1)
		go func() {
			defer wg.Done()
			f.Start(ctx)
		}()
	}
	wg.Wait()
}
