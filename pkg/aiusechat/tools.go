// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func handleTsunamiBlockDesc(block *waveobj.Block) string {
	status := blockcontroller.GetBlockControllerRuntimeStatus(block.OID)
	if status == nil || status.ShellProcStatus != blockcontroller.Status_Running {
		return "tsunami framework widget that is currently not running"
	}

	blockORef := waveobj.MakeORef(waveobj.OType_Block, block.OID)
	rtInfo := wstore.GetRTInfo(blockORef)
	if rtInfo != nil && rtInfo.TsunamiShortDesc != "" {
		return fmt.Sprintf("tsunami widget - %s", rtInfo.TsunamiShortDesc)
	}
	return "tsunami widget - unknown description"
}

func MakeBlockShortDesc(block *waveobj.Block) string {
	if block.Meta == nil {
		return ""
	}

	viewType, ok := block.Meta["view"].(string)
	if !ok {
		return ""
	}

	switch viewType {
	case "term":
		connection, hasConnection := block.Meta["connection"].(string)
		cwd, hasCwd := block.Meta["cmd:cwd"].(string)

		blockORef := waveobj.MakeORef(waveobj.OType_Block, block.OID)
		rtInfo := wstore.GetRTInfo(blockORef)
		hasCurCwd := rtInfo != nil && rtInfo.CmdHasCurCwd

		var desc string
		if hasConnection && connection != "" {
			desc = fmt.Sprintf("CLI terminal on %q", connection)
		} else {
			desc = "local CLI terminal"
		}

		if hasCurCwd && hasCwd && cwd != "" {
			desc += fmt.Sprintf(" in directory %q", cwd)
		}

		return desc
	case "preview":
		file, hasFile := block.Meta["file"].(string)
		connection, hasConnection := block.Meta["connection"].(string)

		if hasConnection && connection != "" {
			if hasFile && file != "" {
				return fmt.Sprintf("preview widget viewing %q on %q", file, connection)
			}
			return fmt.Sprintf("preview widget viewing files on %q", connection)
		}
		if hasFile && file != "" {
			return fmt.Sprintf("preview widget viewing %q", file)
		}
		return "file and directory preview widget"
	case "web":
		if url, hasUrl := block.Meta["url"].(string); hasUrl && url != "" {
			return fmt.Sprintf("web browser widget pointing at %q", url)
		}
		return "web browser widget"
	case "waveai":
		return "AI chat widget"
	case "cpuplot":
		if connection, hasConnection := block.Meta["connection"].(string); hasConnection && connection != "" {
			return fmt.Sprintf("cpu graph for %q", connection)
		}
		return "cpu graph"
	case "tips":
		return "Wave quick tips widget"
	case "help":
		return "Wave documentation widget"
	case "launcher":
		return "placeholder widget used to launch other widgets"
	case "tsunami":
		return handleTsunamiBlockDesc(block)
	default:
		return fmt.Sprintf("unknown widget with type %q", viewType)
	}
}

func AddToolsForTab(ctx context.Context, tabid string, widgetAccess bool, chatOpts *uctypes.WaveChatOpts) error {
	if tabid == "" {
		return nil
	}
	if !widgetAccess {
		chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, "The user has chosen not to share widget context with you.")
		return nil
	}

	if _, err := uuid.Parse(tabid); err != nil {
		return fmt.Errorf("tabid must be a valid UUID")
	}

	tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabid)
	if err != nil {
		return fmt.Errorf("error getting tab: %v", err)
	}

	var blocks []*waveobj.Block
	for _, blockId := range tabObj.BlockIds {
		block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
		if err != nil {
			continue
		}
		blocks = append(blocks, block)
	}

	systemPrompt := generateTabSystemPrompt(blocks)
	chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, systemPrompt)

	return nil
}

func generateTabSystemPrompt(blocks []*waveobj.Block) string {
	if len(blocks) == 0 {
		return "This tab is empty with no widgets currently open."
	}

	var widgetDescriptions []string
	for _, block := range blocks {
		desc := MakeBlockShortDesc(block)
		if desc == "" {
			continue
		}
		blockIdPrefix := block.OID[:8]
		fullDesc := fmt.Sprintf("(%s) %s", blockIdPrefix, desc)
		widgetDescriptions = append(widgetDescriptions, fullDesc)
	}

	totalWidgets := len(widgetDescriptions)
	var prompt strings.Builder
	if totalWidgets == 1 {
		prompt.WriteString("In this tab there is 1 widget open (the widgetid appears in parentheses before the description):\n")
	} else {
		prompt.WriteString(fmt.Sprintf("In this tab there are %d widgets open (the widgetid appears in parentheses before the description):\n", totalWidgets))
	}

	for _, desc := range widgetDescriptions {
		prompt.WriteString("* ")
		prompt.WriteString(desc)
		prompt.WriteString("\n")
	}

	return prompt.String()
}

func GetAdderToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "adder",
		DisplayName: "Adder",
		Description: "Add an array of numbers together and return their sum",
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
			"required": []string{"values"},
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
