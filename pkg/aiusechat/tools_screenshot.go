// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func makeTabCaptureBlockScreenshot(tabId string) func(any) (string, error) {
	return func(input any) (string, error) {
		inputMap, ok := input.(map[string]any)
		if !ok {
			return "", fmt.Errorf("invalid input format")
		}

		blockIdPrefix, ok := inputMap["widget_id"].(string)
		if !ok {
			return "", fmt.Errorf("missing or invalid widget_id parameter")
		}

		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()

		tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
		if err != nil {
			return "", fmt.Errorf("error getting tab: %w", err)
		}

		fullBlockId, err := resolveBlockIdFromPrefix(tab, blockIdPrefix)
		if err != nil {
			return "", err
		}

		rpcClient := wshclient.GetBareRpcClient()
		screenshotData, err := wshclient.CaptureBlockScreenshotCommand(
			rpcClient,
			wshrpc.CommandCaptureBlockScreenshotData{BlockId: fullBlockId},
			&wshrpc.RpcOpts{Route: wshutil.MakeTabRouteId(tabId)},
		)
		if err != nil {
			return "", fmt.Errorf("failed to capture screenshot: %w", err)
		}

		return screenshotData, nil
	}
}

func GetCaptureScreenshotToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "capture_screenshot",
		DisplayName: "Capture Screenshot",
		Description: "Capture a screenshot of a widget and return it as an image",
		ToolLogName: "gen:screenshot",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the widget to screenshot",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolTextCallback: makeTabCaptureBlockScreenshot(tabId),
	}
}
