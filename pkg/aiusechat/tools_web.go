// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func GetWebNavigateToolDefinition(block *waveobj.Block) uctypes.ToolDefinition {
	blockIdPrefix := block.OID[:8]
	toolName := fmt.Sprintf("web_navigate_%s", blockIdPrefix)

	return uctypes.ToolDefinition{
		Name:        toolName,
		DisplayName: fmt.Sprintf("Navigate Web Block %s", blockIdPrefix),
		Description: fmt.Sprintf("Navigate the web browser widget %s to a new URL", blockIdPrefix),
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"url": map[string]any{
					"type":        "string",
					"description": "URL to navigate to",
				},
			},
			"required":             []string{"url"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return fmt.Sprintf("navigating web widget %s", blockIdPrefix)
			}
			url, ok := inputMap["url"].(string)
			if !ok || url == "" {
				return fmt.Sprintf("navigating web widget %s", blockIdPrefix)
			}
			return fmt.Sprintf("navigating web widget %s to %q", blockIdPrefix, url)
		},
		ToolAnyCallback: func(input any) (any, error) {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format")
			}

			url, ok := inputMap["url"].(string)
			if !ok {
				return nil, fmt.Errorf("missing or invalid url parameter")
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			blockORef := waveobj.MakeORef(waveobj.OType_Block, block.OID)
			meta := map[string]any{
				"url": url,
			}

			err := wstore.UpdateObjectMeta(ctx, blockORef, meta, false)
			if err != nil {
				return nil, fmt.Errorf("failed to update web block URL: %w", err)
			}

			wcore.SendWaveObjUpdate(blockORef)
			return true, nil
		},
	}
}