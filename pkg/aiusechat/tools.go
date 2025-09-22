// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func GetAdderToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "adder",
		DisplayName: "Adder",
		Description: "Add two numbers together and return their sum",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"x": map[string]any{
					"type":        "integer",
					"description": "First number to add",
				},
				"y": map[string]any{
					"type":        "integer",
					"description": "Second number to add",
				},
			},
			"required": []string{"x", "y"},
		},
		ToolAnyCallback: func(input any) (any, error) {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format")
			}

			x, ok := inputMap["x"].(float64)
			if !ok {
				return nil, fmt.Errorf("invalid or missing x parameter")
			}

			y, ok := inputMap["y"].(float64)
			if !ok {
				return nil, fmt.Errorf("invalid or missing y parameter")
			}

			return int(x) + int(y), nil
		},
	}
}
