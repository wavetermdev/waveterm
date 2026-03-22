// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package mcpclient

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

var (
	globalManager     *MCPManager
	globalManagerOnce sync.Once
)

// MCPManager manages MCP client instances per working directory.
type MCPManager struct {
	mu      sync.Mutex
	clients map[string]*MCPClient // keyed by "cwd:serverName"
}

// GetManager returns the singleton MCPManager.
func GetManager() *MCPManager {
	globalManagerOnce.Do(func() {
		globalManager = &MCPManager{
			clients: make(map[string]*MCPClient),
		}
	})
	return globalManager
}

// GetClient returns an existing MCP client for the given CWD and server name,
// or creates a new one by reading .mcp.json from that directory.
func (m *MCPManager) GetClient(cwd string, serverName string) (*MCPClient, error) {
	cwd = NormalizeMCPDir(cwd)
	key := cwd + ":" + serverName

	m.mu.Lock()
	defer m.mu.Unlock()

	// Return existing alive client
	if client, ok := m.clients[key]; ok && client.IsAlive() {
		return client, nil
	}

	// Load config and create new client while holding the lock
	// to prevent duplicate client creation from concurrent calls
	configs, err := LoadMCPConfig(cwd)
	if err != nil {
		return nil, fmt.Errorf("loading MCP config from %s: %w", cwd, err)
	}
	if configs == nil {
		return nil, fmt.Errorf("no .mcp.json found in %s", cwd)
	}

	config, ok := configs[serverName]
	if !ok {
		return nil, fmt.Errorf("MCP server %q not found in %s/.mcp.json", serverName, cwd)
	}

	client, err := NewMCPClient(serverName, config)
	if err != nil {
		return nil, err
	}

	m.clients[key] = client
	return client, nil
}

// GetAllClients returns MCP clients for all servers defined in .mcp.json at the given CWD.
func (m *MCPManager) GetAllClients(cwd string) ([]*MCPClient, error) {
	configs, err := LoadMCPConfig(cwd)
	if err != nil {
		return nil, fmt.Errorf("loading MCP config from %s: %w", cwd, err)
	}
	if configs == nil {
		return nil, nil
	}

	var clients []*MCPClient
	for name := range configs {
		client, err := m.GetClient(cwd, name)
		if err != nil {
			log.Printf("[mcpclient] warning: failed to connect to MCP server %q: %v\n", name, err)
			continue
		}
		clients = append(clients, client)
	}
	return clients, nil
}

// GetAutoContext connects to all MCP servers in the given CWD and fetches
// auto-context data (database-schema summary, application-info).
// Returns formatted XML context string for injection into AI prompts.
func (m *MCPManager) GetAutoContext(cwd string) (string, error) {
	clients, err := m.GetAllClients(cwd)
	if err != nil {
		return "", err
	}
	if len(clients) == 0 {
		return "", nil
	}

	var sb strings.Builder
	sb.WriteString("<mcp_context>\n")

	for _, client := range clients {
		sb.WriteString(fmt.Sprintf("<mcp_server name=%q version=%q>\n", client.serverInfo.Name, client.serverInfo.Version))

		// Try to get application-info (if tool exists)
		if hasToolNamed(client.tools, "application-info") {
			result, err := client.CallTool("application-info", map[string]any{})
			if err == nil && result != "" {
				sb.WriteString("<application_info>\n")
				sb.WriteString(result)
				sb.WriteString("\n</application_info>\n")
			}
		}

		// Try to get database-schema summary (if tool exists)
		if hasToolNamed(client.tools, "database-schema") {
			result, err := client.CallTool("database-schema", map[string]any{"summary": true})
			if err == nil && result != "" {
				sb.WriteString("<database_schema_summary>\n")
				sb.WriteString(result)
				sb.WriteString("\n</database_schema_summary>\n")
			}
		}

		sb.WriteString("</mcp_server>\n")
	}

	sb.WriteString("</mcp_context>")
	return sb.String(), nil
}

// GetToolDefinitions returns Wave ToolDefinitions for all MCP tools across all servers in the given CWD.
// Each MCP tool is wrapped with a callback that calls the MCP server.
func (m *MCPManager) GetToolDefinitions(cwd string) ([]uctypes.ToolDefinition, error) {
	clients, err := m.GetAllClients(cwd)
	if err != nil {
		return nil, err
	}

	var tools []uctypes.ToolDefinition
	for _, client := range clients {
		for _, mcpTool := range client.tools {
			tool := convertMCPToolToDefinition(client, mcpTool)
			tools = append(tools, tool)
		}
	}
	return tools, nil
}

// convertMCPToolToDefinition wraps an MCP tool as a Wave ToolDefinition.
func convertMCPToolToDefinition(client *MCPClient, mcpTool MCPTool) uctypes.ToolDefinition {
	// Prefix tool name with "mcp_" to avoid collisions with built-in tools
	toolName := "mcp_" + mcpTool.Name

	// Capture client and tool name for the callback closure
	capturedClient := client
	capturedToolName := mcpTool.Name

	return uctypes.ToolDefinition{
		Name:             toolName,
		DisplayName:      fmt.Sprintf("MCP: %s", mcpTool.Name),
		Description:      mcpTool.Description,
		ShortDescription: fmt.Sprintf("MCP tool from %s", client.serverName),
		ToolLogName:      fmt.Sprintf("mcp:%s:%s", client.serverName, mcpTool.Name),
		InputSchema:      mcpTool.InputSchema,
		ToolTextCallback: func(input any) (string, error) {
			// Convert input to map[string]any for MCP call
			args, ok := input.(map[string]any)
			if !ok && input != nil {
				// Try JSON round-trip for struct inputs
				data, err := json.Marshal(input)
				if err != nil {
					return "", fmt.Errorf("marshaling tool input: %w", err)
				}
				args = make(map[string]any)
				if err := json.Unmarshal(data, &args); err != nil {
					return "", fmt.Errorf("converting tool input: %w", err)
				}
			}
			start := time.Now()
			result, err := capturedClient.CallTool(capturedToolName, args)
			duration := time.Since(start).Seconds()
			logEntry := MCPCallLogEntry{
				Timestamp: time.Now(),
				ToolName:  capturedToolName,
				Duration:  duration,
				ResultLen: len(result),
				Arguments: args,
				Result:    truncateResult(result),
			}
			if err != nil {
				logEntry.Error = err.Error()
				logEntry.Result = ""
			}
			AddCallLog(logEntry)
			return result, err
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			return fmt.Sprintf("Called MCP tool: %s", capturedToolName)
		},
	}
}

// HasMCPConfig checks if a .mcp.json file exists in the given directory.
func HasMCPConfig(cwd string) bool {
	configs, err := LoadMCPConfig(cwd)
	return err == nil && configs != nil && len(configs) > 0
}

// Shutdown closes all active MCP clients.
func (m *MCPManager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for key, client := range m.clients {
		client.Close()
		delete(m.clients, key)
	}
	log.Println("[mcpclient] all MCP clients shut down")
}

func hasToolNamed(tools []MCPTool, name string) bool {
	for _, t := range tools {
		if t.Name == name {
			return true
		}
	}
	return false
}
