// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"log"

	"github.com/woveterm/wove/pkg/aiusechat/uctypes"
	"github.com/woveterm/wove/pkg/mcpclient"
	"github.com/woveterm/wove/pkg/waveobj"
	"github.com/woveterm/wove/pkg/wstore"
)

// generateMCPStateAndTools connects to MCP servers based on the CWD stored in chatOpts
// and returns auto-context and tool definitions.
func generateMCPStateAndTools(chatOpts uctypes.WaveChatOpts) (string, []uctypes.ToolDefinition, error) {
	cwd := chatOpts.MCPCwd
	if cwd == "" {
		return "", nil, nil
	}

	if !mcpclient.HasMCPConfig(cwd) {
		return "", nil, nil
	}

	manager := mcpclient.GetManager()

	// Get auto-context (application-info, database-schema summary)
	mcpState, err := manager.GetAutoContext(cwd)
	if err != nil {
		log.Printf("[mcp] warning: failed to get auto-context: %v\n", err)
		mcpState = ""
	}

	// Get tool definitions (all MCP tools wrapped as Wave ToolDefinitions)
	mcpTools, err := manager.GetToolDefinitions(cwd)
	if err != nil {
		log.Printf("[mcp] warning: failed to get tool definitions: %v\n", err)
		mcpTools = nil
	}

	return mcpState, mcpTools, nil
}

// getTerminalCwd extracts the CWD from the first terminal block in the given tab.
func getTerminalCwd(ctx context.Context, tabId string) string {
	tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return ""
	}
	for _, blockId := range tabObj.BlockIds {
		block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
		if err != nil || block == nil || block.Meta == nil {
			continue
		}
		viewType, _ := block.Meta["view"].(string)
		if viewType != "term" {
			continue
		}
		if cwd, ok := block.Meta["cmd:cwd"].(string); ok && cwd != "" {
			return cwd
		}
	}
	return ""
}
