// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveai"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

//go:embed testschema.json
var testSchemaJSON string

// TestResponseWriter implements http.ResponseWriter and additional interfaces for testing
type TestResponseWriter struct {
	header http.Header
}

func (w *TestResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *TestResponseWriter) Write(data []byte) (int, error) {
	fmt.Printf("SSE: %s", string(data))
	return len(data), nil
}

func (w *TestResponseWriter) WriteHeader(statusCode int) {
	fmt.Printf("Status: %d\n", statusCode)
}

// Implement http.Flusher interface
func (w *TestResponseWriter) Flush() {
	// No-op for testing
}

// Implement interfaces needed by http.ResponseController
func (w *TestResponseWriter) SetWriteDeadline(deadline time.Time) error {
	// No-op for testing
	return nil
}

func (w *TestResponseWriter) SetReadDeadline(deadline time.Time) error {
	// No-op for testing
	return nil
}

func getToolDefinitions() []waveai.ToolDefinition {
	var schemas map[string]any
	if err := json.Unmarshal([]byte(testSchemaJSON), &schemas); err != nil {
		fmt.Printf("Error parsing schema: %v\n", err)
		return nil
	}

	var configSchema map[string]any
	if rawSchema, ok := schemas["config"]; ok && rawSchema != nil {
		if schema, ok := rawSchema.(map[string]any); ok {
			configSchema = schema
		}
	}
	if configSchema == nil {
		configSchema = map[string]any{"type": "object"}
	}

	return []waveai.ToolDefinition{
		{
			Name:        "get_config",
			Description: "Get the current GitHub Actions Monitor configuration settings including repository, workflow, polling interval, and max workflow runs",
			InputSchema: map[string]any{
				"type": "object",
			},
		},
		{
			Name:        "update_config",
			Description: "Update GitHub Actions Monitor configuration settings",
			InputSchema: configSchema,
		},
		{
			Name:        "get_data",
			Description: "Get the current GitHub Actions workflow run data including workflow runs, loading state, and errors",
			InputSchema: map[string]any{
				"type": "object",
			},
		},
	}
}

func testOpenAI(ctx context.Context, model, message string, tools []waveai.ToolDefinition) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		fmt.Println("Error: OPENAI_API_KEY environment variable not set")
		os.Exit(1)
	}

	opts := &wshrpc.WaveAIOptsType{
		APIToken:  apiKey,
		Model:     model,
		MaxTokens: 1000,
	}

	messages := []waveai.UseChatMessage{
		{
			Role:    "user",
			Content: message,
		},
	}

	fmt.Printf("Testing OpenAI streaming with model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := waveai.MakeSSEHandlerCh(testWriter, ctx)

	err := sseHandler.SetupSSE()
	if err != nil {
		fmt.Printf("Error setting up SSE: %v\n", err)
		return
	}
	defer sseHandler.Close()

	stopReason, err := waveai.StreamOpenAIToUseChat(ctx, sseHandler, opts, messages, tools)
	if err != nil {
		fmt.Printf("OpenAI streaming error: %v\n", err)
	}
	if stopReason != nil {
		fmt.Printf("Stop reason: %+v\n", stopReason)
	}
}

func testAnthropic(ctx context.Context, model, message string, tools []waveai.ToolDefinition) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		fmt.Println("Error: ANTHROPIC_API_KEY environment variable not set")
		os.Exit(1)
	}

	opts := &wshrpc.WaveAIOptsType{
		APIToken:  apiKey,
		Model:     model,
		MaxTokens: 1000,
	}

	messages := []waveai.UseChatMessage{
		{
			Role:    "user",
			Content: message,
		},
	}

	fmt.Printf("Testing Anthropic streaming with model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := waveai.MakeSSEHandlerCh(testWriter, ctx)

	err := sseHandler.SetupSSE()
	if err != nil {
		fmt.Printf("Error setting up SSE: %v\n", err)
		return
	}
	defer sseHandler.Close()

	stopReason, err := waveai.StreamAnthropicResponses(ctx, sseHandler, opts, messages, tools)
	if err != nil {
		fmt.Printf("Anthropic streaming error: %v\n", err)
	}
	if stopReason != nil {
		fmt.Printf("Stop reason: %+v\n", stopReason)
	}
}

func main() {
	var anthropic, tools bool
	flag.BoolVar(&anthropic, "anthropic", false, "Use Anthropic API instead of OpenAI")
	flag.BoolVar(&tools, "tools", false, "Enable GitHub Actions Monitor tools for testing")
	flag.Parse()

	args := flag.Args()
	if len(args) < 1 {
		fmt.Println("Usage: go run main-testai.go [--anthropic] [--tools] <model> [message]")
		fmt.Println("Examples:")
		fmt.Println("  go run main-testai.go o4-mini 'What is 2+2?'")
		fmt.Println("  go run main-testai.go --anthropic claude-3-5-sonnet-20241022 'What is 2+2?'")
		fmt.Println("  go run main-testai.go --tools o4-mini 'Help me configure GitHub Actions monitoring'")
		fmt.Println("")
		fmt.Println("Environment variables:")
		fmt.Println("  OPENAI_API_KEY (for OpenAI models)")
		fmt.Println("  ANTHROPIC_API_KEY (for Anthropic models)")
		os.Exit(1)
	}

	model := args[0]
	message := "What is 2+2?"
	if len(args) > 1 {
		message = args[1]
	}

	var toolDefs []waveai.ToolDefinition
	if tools {
		toolDefs = getToolDefinitions()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if anthropic {
		testAnthropic(ctx, model, message, toolDefs)
	} else {
		testOpenAI(ctx, model, message, toolDefs)
	}
}
