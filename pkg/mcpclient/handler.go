// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package mcpclient

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// MCPStatusResponse is returned by the /api/mcp/status endpoint.
type MCPStatusResponse struct {
	Connected  bool          `json:"connected"`
	ServerName string        `json:"serverName,omitempty"`
	ServerInfo MCPServerInfo `json:"serverInfo,omitempty"`
	Tools      []MCPTool     `json:"tools,omitempty"`
	Resources  []MCPResource `json:"resources,omitempty"`
	Error      string        `json:"error,omitempty"`
}

// MCPCallRequest is the request body for /api/mcp/call.
type MCPCallRequest struct {
	Cwd       string         `json:"cwd"`
	Server    string         `json:"server,omitempty"` // optional, defaults to first server
	ToolName  string         `json:"toolName"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

// MCPCallResponse is the response from /api/mcp/call.
type MCPCallResponse struct {
	Result   string  `json:"result,omitempty"`
	Error    string  `json:"error,omitempty"`
	Duration float64 `json:"duration,omitempty"` // seconds
}

// MCPCallLogEntry represents a single tool call in the call log.
type MCPCallLogEntry struct {
	Timestamp time.Time      `json:"timestamp"`
	ToolName  string         `json:"toolName"`
	Duration  float64        `json:"duration"` // seconds
	Error     string         `json:"error,omitempty"`
	ResultLen int            `json:"resultLen"`
	Arguments map[string]any `json:"arguments,omitempty"`
	Result    string         `json:"result,omitempty"`
}

// callLog stores recent MCP calls for the widget
var (
	callLog   []MCPCallLogEntry
	callLogMu sync.Mutex
)

const maxCallLogSize = 50

func AddCallLog(entry MCPCallLogEntry) {
	callLogMu.Lock()
	defer callLogMu.Unlock()
	callLog = append(callLog, entry)
	if len(callLog) > maxCallLogSize {
		callLog = callLog[len(callLog)-maxCallLogSize:]
	}
}

func getCallLog() []MCPCallLogEntry {
	callLogMu.Lock()
	defer callLogMu.Unlock()
	result := make([]MCPCallLogEntry, len(callLog))
	copy(result, callLog)
	return result
}

// HandleMCPStatus handles GET /api/mcp/status?cwd=...
func HandleMCPStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cwd := r.URL.Query().Get("cwd")
	if cwd == "" {
		writeJSON(w, MCPStatusResponse{Connected: false, Error: "cwd parameter required"})
		return
	}

	configs, err := LoadMCPConfig(cwd)
	if err != nil || configs == nil {
		writeJSON(w, MCPStatusResponse{Connected: false, Error: "no .mcp.json found"})
		return
	}

	manager := GetManager()

	// Try to connect to first available server
	var resp MCPStatusResponse
	for name := range configs {
		client, err := manager.GetClient(cwd, name)
		if err != nil {
			resp = MCPStatusResponse{Connected: false, Error: fmt.Sprintf("failed to connect to %s: %v", name, err)}
			continue
		}
		resp = MCPStatusResponse{
			Connected:  client.IsAlive(),
			ServerName: name,
			ServerInfo: client.ServerInfo(),
			Tools:      client.ListTools(),
			Resources:  client.ListResources(),
		}
		break
	}

	writeJSON(w, resp)
}

// HandleMCPCall handles POST /api/mcp/call
func HandleMCPCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, MCPCallResponse{Error: "failed to read request body"})
		return
	}
	defer r.Body.Close()

	var req MCPCallRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, MCPCallResponse{Error: fmt.Sprintf("invalid request: %v", err)})
		return
	}

	if req.Cwd == "" || req.ToolName == "" {
		writeJSON(w, MCPCallResponse{Error: "cwd and toolName are required"})
		return
	}

	manager := GetManager()

	// Find the right server
	serverName := req.Server
	if serverName == "" {
		configs, err := LoadMCPConfig(req.Cwd)
		if err != nil || configs == nil {
			writeJSON(w, MCPCallResponse{Error: "no .mcp.json found"})
			return
		}
		for name := range configs {
			serverName = name
			break
		}
	}

	client, err := manager.GetClient(req.Cwd, serverName)
	if err != nil {
		writeJSON(w, MCPCallResponse{Error: fmt.Sprintf("failed to connect: %v", err)})
		return
	}

	start := time.Now()
	result, err := client.CallTool(req.ToolName, req.Arguments)
	duration := time.Since(start).Seconds()

	logEntry := MCPCallLogEntry{
		Timestamp: time.Now(),
		ToolName:  req.ToolName,
		Duration:  duration,
		ResultLen: len(result),
		Arguments: req.Arguments,
		Result:    truncateResult(result),
	}

	if err != nil {
		logEntry.Error = err.Error()
		logEntry.Result = ""
		AddCallLog(logEntry)
		writeJSON(w, MCPCallResponse{Error: err.Error(), Duration: duration})
		return
	}

	AddCallLog(logEntry)
	writeJSON(w, MCPCallResponse{Result: result, Duration: duration})
}

// HandleMCPCallLog handles GET /api/mcp/calllog
func HandleMCPCallLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, getCallLog())
}

const maxResultLogSize = 10000

func truncateResult(s string) string {
	if len(s) > maxResultLogSize {
		return s[:maxResultLogSize] + "\n... [truncated]"
	}
	return s
}

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
