// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// GenerateTabTitle generates a short title for a tab based on the current working directory
func GenerateTabTitle(ctx context.Context, tabId string) (string, error) {
	// Get the tab
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("error getting tab: %w", err)
	}

	// If no blocks, return default
	if len(tab.BlockIds) == 0 {
		return "", fmt.Errorf("tab has no blocks")
	}

	// Get the first block (usually the primary terminal)
	blockId := tab.BlockIds[0]
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return "", fmt.Errorf("error getting block: %w", err)
	}

	// Get the current working directory from block metadata
	meta := waveobj.GetMeta(block)
	cwd, ok := meta[waveobj.MetaKey_CmdCwd].(string)
	if !ok || cwd == "" {
		return "", fmt.Errorf("no working directory available")
	}

	// Generate title from the last 2 folders
	title := generateTitleFromPath(cwd)
	return title, nil
}

// generateTitleFromPath creates a title from the last folder in a path
func generateTitleFromPath(fullPath string) string {
	// Clean the path (remove trailing slashes, etc.)
	cleanPath := filepath.Clean(fullPath)

	// Split the path into components
	parts := strings.Split(cleanPath, string(filepath.Separator))

	// Filter out empty parts
	var nonEmptyParts []string
	for _, part := range parts {
		if part != "" {
			nonEmptyParts = append(nonEmptyParts, part)
		}
	}

	if len(nonEmptyParts) == 0 {
		return "/"
	}

	// Use just the last folder name
	return nonEmptyParts[len(nonEmptyParts)-1]
}
