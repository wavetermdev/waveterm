// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"context"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveai"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	LinesThresholdForTitle = 1  // Generate title after N lines of output
	TitleCooldownSeconds   = 10 // Don't regenerate title more often than every 10 seconds
)

// tabTitleTracker tracks line counts per tab for auto-generating titles
type tabTitleTracker struct {
	mu               sync.Mutex
	tabLineCounts    map[string]int       // tabId -> line count
	lastTitleGenTime map[string]time.Time // tabId -> last time title was generated
}

var titleTracker = &tabTitleTracker{
	tabLineCounts:    make(map[string]int),
	lastTitleGenTime: make(map[string]time.Time),
}

// CheckAndGenerateTitle checks if we should generate a title for the tab containing this block
func CheckAndGenerateTitle(blockId string, data []byte) {
	// Count newlines in the data
	newlines := bytes.Count(data, []byte("\n"))
	if newlines == 0 {
		return // No new lines, nothing to do
	}

	// Get the tab that contains this block
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil || block == nil {
		return
	}

	// Extract tabId from parent ORef (format: "tab:uuid")
	if block.ParentORef == "" {
		return
	}
	oref, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return
	}
	tabId := oref.OID

	// Update line count and check threshold
	titleTracker.mu.Lock()
	titleTracker.tabLineCounts[tabId] += newlines
	lineCount := titleTracker.tabLineCounts[tabId]
	lastGenTime, exists := titleTracker.lastTitleGenTime[tabId]
	titleTracker.mu.Unlock()

	// Check if we've hit the threshold
	if lineCount < LinesThresholdForTitle {
		return
	}

	// Check cooldown period
	if exists && time.Since(lastGenTime).Seconds() < TitleCooldownSeconds {
		return
	}

	// Reset counter and update last gen time before generating (to prevent duplicates)
	titleTracker.mu.Lock()
	titleTracker.tabLineCounts[tabId] = 0
	titleTracker.lastTitleGenTime[tabId] = time.Now()
	titleTracker.mu.Unlock()

	// Generate title asynchronously
	go func() {
		genCtx, genCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer genCancel()

		title, err := waveai.GenerateTabTitle(genCtx, tabId)
		if err != nil {
			log.Printf("Error generating tab title for tab %s: %v", tabId, err)
			return
		}

		// Update the tab name
		err = wstore.UpdateTabName(genCtx, tabId, title)
		if err != nil {
			log.Printf("Error updating tab name for tab %s: %v", tabId, err)
			return
		}

		log.Printf("Auto-generated tab title for tab %s: %q", tabId, title)
	}()
}
