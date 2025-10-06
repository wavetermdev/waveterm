// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func resolveBlockIdFromPrefix(tab *waveobj.Tab, blockIdPrefix string) (string, error) {
	if len(blockIdPrefix) != 8 {
		return "", fmt.Errorf("block ID prefix must be 8 characters")
	}

	for _, blockId := range tab.BlockIds {
		if strings.HasPrefix(blockId, blockIdPrefix) {
			return blockId, nil
		}
	}

	return "", fmt.Errorf("block not found with prefix %s", blockIdPrefix)
}

func makeTabCaptureBlockScreenshot(tabId string) func(any) (string, error) {
	return func(input any) (string, error) {
		inputMap, ok := input.(map[string]any)
		if !ok {
			return "", fmt.Errorf("invalid input format")
		}

		blockIdPrefix, ok := inputMap["blockid"].(string)
		if !ok {
			return "", fmt.Errorf("missing or invalid blockid parameter")
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
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"blockid": map[string]any{
					"type":        "string",
					"description": "8-character block ID of the widget to screenshot",
				},
			},
			"required":             []string{"blockid"},
			"additionalProperties": false,
		},
		ToolTextCallback: makeTabCaptureBlockScreenshot(tabId),
	}
}

func GetAdderToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "adder",
		DisplayName: "Adder",
		Description: "Add an array of numbers together and return their sum",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"values": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "integer",
					},
					"description": "Array of numbers to add together",
				},
			},
			"required":             []string{"values"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any) (any, error) {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format")
			}

			valuesInterface, ok := inputMap["values"]
			if !ok {
				return nil, fmt.Errorf("missing values parameter")
			}

			valuesSlice, ok := valuesInterface.([]any)
			if !ok {
				return nil, fmt.Errorf("values must be an array")
			}

			if len(valuesSlice) == 0 {
				return 0, nil
			}

			sum := 0
			for i, val := range valuesSlice {
				floatVal, ok := val.(float64)
				if !ok {
					return nil, fmt.Errorf("value at index %d is not a number", i)
				}
				sum += int(floatVal)
			}

			return sum, nil
		},
	}
}