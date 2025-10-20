// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"os/user"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func makeTerminalBlockDesc(block *waveobj.Block) string {
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

	if rtInfo != nil && rtInfo.ShellType != "" {
		desc += fmt.Sprintf(" (%s", rtInfo.ShellType)
		if rtInfo.ShellVersion != "" {
			desc += fmt.Sprintf(" %s", rtInfo.ShellVersion)
		}
		desc += ")"
	}

	if hasCurCwd && hasCwd && cwd != "" {
		desc += fmt.Sprintf(" in directory %q", cwd)
	}

	return desc
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
		return makeTerminalBlockDesc(block)
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

func GenerateTabStateAndTools(ctx context.Context, tabid string, widgetAccess bool) (string, []uctypes.ToolDefinition, error) {
	if tabid == "" {
		return "", nil, nil
	}
	var blocks []*waveobj.Block
	if widgetAccess {
		if _, err := uuid.Parse(tabid); err != nil {
			return "", nil, fmt.Errorf("tabid must be a valid UUID")
		}

		tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabid)
		if err != nil {
			return "", nil, fmt.Errorf("error getting tab: %v", err)
		}

		for _, blockId := range tabObj.BlockIds {
			block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
			if err != nil {
				continue
			}
			blocks = append(blocks, block)
		}
	}
	tabState := GenerateCurrentTabStatePrompt(blocks, widgetAccess)
	var tools []uctypes.ToolDefinition
	if widgetAccess {
		tools = append(tools, GetCaptureScreenshotToolDefinition(tabid))
		tools = append(tools, GetReadTextFileToolDefinition())
		tools = append(tools, GetReadDirToolDefinition())
		viewTypes := make(map[string]bool)
		for _, block := range blocks {
			if block.Meta == nil {
				continue
			}
			viewType, ok := block.Meta["view"].(string)
			if !ok {
				continue
			}
			viewTypes[viewType] = true
			if viewType == "tsunami" {
				blockTools := generateToolsForTsunamiBlock(block)
				tools = append(tools, blockTools...)
			}
		}
		if viewTypes["term"] {
			tools = append(tools, GetTermGetScrollbackToolDefinition(tabid))
		}
		if viewTypes["web"] {
			tools = append(tools, GetWebNavigateToolDefinition(tabid))
		}
	}
	return tabState, tools, nil
}

func GenerateCurrentTabStatePrompt(blocks []*waveobj.Block, widgetAccess bool) string {
	if !widgetAccess {
		return `<current_tab_state>The user has chosen not to share widget context with you</current_tab_state>`
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

	var prompt strings.Builder
	prompt.WriteString("<current_tab_state>\n")
	systemInfo := wavebase.GetSystemSummary()
	if currentUser, err := user.Current(); err == nil && currentUser.Username != "" {
		prompt.WriteString(fmt.Sprintf("Local Machine: %s, User: %s\n", systemInfo, currentUser.Username))
	} else {
		prompt.WriteString(fmt.Sprintf("Local Machine: %s\n", systemInfo))
	}
	if len(widgetDescriptions) == 0 {
		prompt.WriteString("No widgets open\n")
	} else {
		prompt.WriteString("Open Widgets:\n")
		for _, desc := range widgetDescriptions {
			prompt.WriteString("* ")
			prompt.WriteString(desc)
			prompt.WriteString("\n")
		}
	}
	prompt.WriteString("</current_tab_state>")
	rtn := prompt.String()
	// log.Printf("%s\n", rtn)
	return rtn
}

func generateToolsForTsunamiBlock(block *waveobj.Block) []uctypes.ToolDefinition {
	var tools []uctypes.ToolDefinition

	status := blockcontroller.GetBlockControllerRuntimeStatus(block.OID)
	if status == nil || status.ShellProcStatus != blockcontroller.Status_Running || status.TsunamiPort <= 0 {
		return nil
	}

	blockORef := waveobj.MakeORef(waveobj.OType_Block, block.OID)
	rtInfo := wstore.GetRTInfo(blockORef)

	if tool := GetTsunamiGetDataToolDefinition(block, rtInfo, status); tool != nil {
		tools = append(tools, *tool)
	}
	if tool := GetTsunamiGetConfigToolDefinition(block, rtInfo, status); tool != nil {
		tools = append(tools, *tool)
	}
	if tool := GetTsunamiSetConfigToolDefinition(block, rtInfo, status); tool != nil {
		tools = append(tools, *tool)
	}

	return tools
}

// Used for internal testing of tool loops
func GetAdderToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "adder",
		DisplayName: "Adder",
		Description: "Add an array of numbers together and return their sum",
		ToolLogName: "gen:adder",
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
