// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package mcpclient

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

const (
	MCPProtocolVersion = "2024-11-05"
	MCPClientName      = "waveterm"
	MCPClientVersion   = "0.1.0"
	ReadTimeout        = 30 * time.Second
	ShutdownTimeout    = 5 * time.Second
)

type MCPClient struct {
	serverName string
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     *bufio.Reader
	mu         sync.Mutex
	nextId     atomic.Int64
	tools      []MCPTool
	resources  []MCPResource
	serverInfo MCPServerInfo
	closed     bool
}

// NewMCPClient spawns an MCP server process and performs the handshake.
func NewMCPClient(serverName string, config MCPServerConfig) (*MCPClient, error) {
	cmd := exec.Command(config.Command, config.Args...)
	if config.Cwd != "" {
		cmd.Dir = config.Cwd
	}
	if len(config.Env) > 0 {
		env := cmd.Environ()
		for k, v := range config.Env {
			env = append(env, k+"="+v)
		}
		cmd.Env = env
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, fmt.Errorf("creating stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		stdin.Close()
		return nil, fmt.Errorf("starting MCP server %q (%s): %w", serverName, config.Command, err)
	}

	client := &MCPClient{
		serverName: serverName,
		cmd:        cmd,
		stdin:      stdin,
		stdout:     bufio.NewReader(stdout),
	}
	client.nextId.Store(1)

	if err := client.handshake(); err != nil {
		client.Close()
		return nil, fmt.Errorf("MCP handshake with %q failed: %w", serverName, err)
	}

	if err := client.discoverCapabilities(); err != nil {
		client.Close()
		return nil, fmt.Errorf("MCP discovery for %q failed: %w", serverName, err)
	}

	log.Printf("[mcpclient] connected to MCP server %q (%s v%s), %d tools available\n",
		serverName, client.serverInfo.Name, client.serverInfo.Version, len(client.tools))

	return client, nil
}

func (c *MCPClient) handshake() error {
	// Step 1: initialize
	initParams := MCPInitializeParams{
		ProtocolVersion: MCPProtocolVersion,
		Capabilities:    map[string]any{},
		ClientInfo: MCPClientInfo{
			Name:    MCPClientName,
			Version: MCPClientVersion,
		},
	}
	var initResult MCPInitializeResult
	if err := c.call("initialize", initParams, &initResult); err != nil {
		return fmt.Errorf("initialize: %w", err)
	}
	c.serverInfo = initResult.ServerInfo

	// Step 2: send initialized notification (no id, no response expected)
	if err := c.notify("notifications/initialized"); err != nil {
		return fmt.Errorf("initialized notification: %w", err)
	}

	return nil
}

func (c *MCPClient) discoverCapabilities() error {
	// List tools
	var toolsResult MCPToolsListResult
	if err := c.call("tools/list", map[string]any{}, &toolsResult); err != nil {
		log.Printf("[mcpclient] warning: tools/list failed for %q: %v\n", c.serverName, err)
	} else {
		c.tools = toolsResult.Tools
	}

	// List resources
	var resourcesResult MCPResourcesListResult
	if err := c.call("resources/list", map[string]any{}, &resourcesResult); err != nil {
		log.Printf("[mcpclient] warning: resources/list failed for %q: %v\n", c.serverName, err)
	} else {
		c.resources = resourcesResult.Resources
	}

	return nil
}

// call sends a JSON-RPC request and waits for the response.
func (c *MCPClient) call(method string, params any, result any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return fmt.Errorf("client is closed")
	}

	id := c.nextId.Add(1)
	req := JsonRpcRequest{
		JsonRpc: "2.0",
		Id:      id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshaling request: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		return fmt.Errorf("writing to stdin: %w", err)
	}

	// Read response line with timeout via channel
	type readResult struct {
		line []byte
		err  error
	}
	ch := make(chan readResult, 1)
	go func() {
		line, err := c.stdout.ReadBytes('\n')
		ch <- readResult{line, err}
	}()

	select {
	case res := <-ch:
		if res.err != nil {
			return fmt.Errorf("reading response: %w", res.err)
		}
		var resp JsonRpcResponse
		if err := json.Unmarshal(res.line, &resp); err != nil {
			return fmt.Errorf("parsing response: %w", err)
		}
		if resp.Error != nil {
			return fmt.Errorf("RPC error %d: %s", resp.Error.Code, resp.Error.Message)
		}
		if result != nil && resp.Result != nil {
			if err := json.Unmarshal(resp.Result, result); err != nil {
				return fmt.Errorf("parsing result: %w", err)
			}
		}
		return nil
	case <-time.After(ReadTimeout):
		return fmt.Errorf("timeout waiting for response to %q after %v", method, ReadTimeout)
	}
}

// notify sends a JSON-RPC notification (no id, no response expected).
func (c *MCPClient) notify(method string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return fmt.Errorf("client is closed")
	}

	req := JsonRpcRequest{
		JsonRpc: "2.0",
		Method:  method,
	}
	data, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshaling notification: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		return fmt.Errorf("writing notification: %w", err)
	}

	return nil
}

// CallTool invokes an MCP tool by name and returns the text result.
func (c *MCPClient) CallTool(name string, arguments map[string]any) (string, error) {
	if arguments == nil {
		arguments = map[string]any{}
	}
	params := MCPToolCallParams{
		Name:      name,
		Arguments: arguments,
	}
	var result MCPToolCallResult
	if err := c.call("tools/call", params, &result); err != nil {
		return "", fmt.Errorf("calling tool %q: %w", name, err)
	}

	// Concatenate all text content blocks
	var text string
	for _, content := range result.Content {
		if content.Type == "text" {
			if text != "" {
				text += "\n"
			}
			text += content.Text
		}
	}
	return text, nil
}

// ListTools returns the tools discovered from the MCP server.
func (c *MCPClient) ListTools() []MCPTool {
	return c.tools
}

// ListResources returns the resources discovered from the MCP server.
func (c *MCPClient) ListResources() []MCPResource {
	return c.resources
}

// ServerName returns the configured server name.
func (c *MCPClient) ServerName() string {
	return c.serverName
}

// ServerInfo returns the MCP server info from initialization.
func (c *MCPClient) ServerInfo() MCPServerInfo {
	return c.serverInfo
}

// IsAlive checks if the MCP server process is still running.
func (c *MCPClient) IsAlive() bool {
	if c.closed || c.cmd == nil || c.cmd.Process == nil {
		return false
	}
	return c.cmd.ProcessState == nil
}

// Close shuts down the MCP server process.
func (c *MCPClient) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return
	}
	c.closed = true

	if c.stdin != nil {
		c.stdin.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		c.cmd.Process.Kill()
		done := make(chan error, 1)
		go func() { done <- c.cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(ShutdownTimeout):
			log.Printf("[mcpclient] warning: MCP server %q did not terminate in time\n", c.serverName)
		}
	}

	log.Printf("[mcpclient] closed MCP server %q\n", c.serverName)
}
