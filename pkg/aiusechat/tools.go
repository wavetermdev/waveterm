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
	case "term":
		tools = append(tools, GetTermGetScrollbackToolDefinition(block))
	case "web":
		tools = append(tools, GetWebNavigateToolDefinition(block))
	case "tsunami":
		status := blockcontroller.GetBlockControllerRuntimeStatus(block.OID)
		if status != nil && status.ShellProcStatus == blockcontroller.Status_Running && status.TsunamiPort > 0 {
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
		}
	}

	return tools
}
