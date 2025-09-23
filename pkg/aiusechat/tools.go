// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
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
	for _, block := range blocks {
		blockTools := generateToolsForBlock(block)
		tools = append(tools, blockTools...)
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
	if len(widgetDescriptions) == 0 {
		prompt.WriteString("No widgets open\n")
	} else {
		for _, desc := range widgetDescriptions {
			prompt.WriteString("* ")
			prompt.WriteString(desc)
			prompt.WriteString("\n")
		}
	}
	prompt.WriteString("</current_tab_state>")
	return prompt.String()
}

func generateToolsForBlock(block *waveobj.Block) []uctypes.ToolDefinition {
	if block.Meta == nil {
		return nil
	}

	viewType, ok := block.Meta["view"].(string)
	if !ok {
		return nil
	}

	var tools []uctypes.ToolDefinition
	switch viewType {
	case "web":
		tools = append(tools, GetWebNavigateToolDefinition(block))
	case "tsunami":
		// Check if tsunami widget is running
		status := blockcontroller.GetBlockControllerRuntimeStatus(block.OID)
		if status != nil && status.ShellProcStatus == blockcontroller.Status_Running && status.TsunamiPort > 0 {
			// Check if schemas are available
			blockORef := waveobj.MakeORef(waveobj.OType_Block, block.OID)
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo != nil && rtInfo.TsunamiSchemas != nil {
				if tool := GetTsunamiGetDataToolDefinition(block, rtInfo, status); tool != nil {
					tools = append(tools, *tool)
				}
			}
		}
	}

	return tools
}

func GetWebNavigateToolDefinition(block *waveobj.Block) uctypes.ToolDefinition {
	blockIdPrefix := block.OID[:8]
	toolName := fmt.Sprintf("web_navigate_%s", blockIdPrefix)

	return uctypes.ToolDefinition{
		Name:        toolName,
		DisplayName: fmt.Sprintf("Navigate Web Block %s", blockIdPrefix),
		Description: fmt.Sprintf("Navigate the web browser widget %s to a new URL", blockIdPrefix),
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"url": map[string]any{
					"type":        "string",
					"description": "URL to navigate to",
				},
			},
			"required": []string{"url"},
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

func GetTsunamiGetDataToolDefinition(block *waveobj.Block, rtInfo *waveobj.ObjRTInfo, status *blockcontroller.BlockControllerRuntimeStatus) *uctypes.ToolDefinition {
	blockIdPrefix := block.OID[:8]
	toolName := fmt.Sprintf("tsunami_getdata_%s", blockIdPrefix)

	var inputSchema map[string]any
	if rtInfo != nil && rtInfo.TsunamiSchemas != nil {
		if schemasMap, ok := rtInfo.TsunamiSchemas.(map[string]any); ok {
			if dataSchema, exists := schemasMap["data"]; exists {
				inputSchema = dataSchema.(map[string]any)
			}
		}
	}

	// Return nil if no data schema found
	if inputSchema == nil {
		return nil
	}

	return &uctypes.ToolDefinition{
		Name:        toolName,
		InputSchema: inputSchema,
		ToolAnyCallback: func(input any) (any, error) {
			if status.TsunamiPort == 0 {
				return nil, fmt.Errorf("tsunami port not available")
			}

			url := fmt.Sprintf("http://localhost:%d/api/data", status.TsunamiPort)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
			if err != nil {
				return nil, fmt.Errorf("failed to create request: %w", err)
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return nil, fmt.Errorf("failed to make request to tsunami: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				return nil, fmt.Errorf("tsunami returned status %d", resp.StatusCode)
			}

			var result any
			if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
				return nil, fmt.Errorf("failed to decode tsunami response: %w", err)
			}

			return result, nil
		},
	}
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
