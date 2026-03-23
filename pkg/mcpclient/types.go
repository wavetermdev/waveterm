// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package mcpclient

import "encoding/json"

// JSON-RPC 2.0 types

type JsonRpcRequest struct {
	JsonRpc string `json:"jsonrpc"`
	Id      int64  `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type JsonRpcResponse struct {
	JsonRpc string           `json:"jsonrpc"`
	Id      int64            `json:"id,omitempty"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *JsonRpcError    `json:"error,omitempty"`
}

type JsonRpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// MCP protocol types

type MCPInitializeParams struct {
	ProtocolVersion string         `json:"protocolVersion"`
	Capabilities    map[string]any `json:"capabilities"`
	ClientInfo      MCPClientInfo  `json:"clientInfo"`
}

type MCPClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type MCPInitializeResult struct {
	ProtocolVersion string        `json:"protocolVersion"`
	Capabilities    any           `json:"capabilities"`
	ServerInfo      MCPServerInfo `json:"serverInfo"`
}

type MCPServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type MCPToolsListResult struct {
	Tools []MCPTool `json:"tools"`
}

type MCPTool struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type MCPResourcesListResult struct {
	Resources []MCPResource `json:"resources"`
}

type MCPResource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

type MCPToolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type MCPToolCallResult struct {
	Content []MCPContent `json:"content"`
}

type MCPContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// Configuration types

type MCPConfigFile struct {
	McpServers map[string]MCPServerConfig `json:"mcpServers"`
}

type MCPServerConfig struct {
	Type    string            `json:"type,omitempty"` // "stdio" (default), "http", "sse"
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Cwd     string            `json:"cwd,omitempty"`
}
