// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
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

func getToolDefinitions() []uctypes.ToolDefinition {
	var schemas map[string]any
	if err := json.Unmarshal([]byte(testSchemaJSON), &schemas); err != nil {
		log.Printf("Error parsing schema: %v\n", err)
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

	return []uctypes.ToolDefinition{
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

func testOpenAI(ctx context.Context, model, message string, tools []uctypes.ToolDefinition) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		fmt.Println("Error: OPENAI_API_KEY environment variable not set")
		os.Exit(1)
	}

	opts := &uctypes.WaveAIOptsType{
		APIType:       aiusechat.APIType_OpenAI,
		APIToken:      apiKey,
		Model:         model,
		MaxTokens:     4096,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
	}

	req := &uctypes.UseChatRequest{
		Messages: []uctypes.UIMessage{
			{
				Role: "user",
				Parts: []uctypes.UIMessagePart{
					{
						Type: "text",
						Text: message,
					},
				},
			},
		},
	}

	fmt.Printf("Testing OpenAI streaming with model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := sse.MakeSSEHandlerCh(testWriter, ctx)
	defer sseHandler.Close()

	err := aiusechat.RunWaveAIRequest(ctx, sseHandler, opts, req, tools)
	if err != nil {
		fmt.Printf("OpenAI streaming error: %v\n", err)
	}
}

func testAnthropic(ctx context.Context, model, message string, tools []uctypes.ToolDefinition) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		fmt.Println("Error: ANTHROPIC_API_KEY environment variable not set")
		os.Exit(1)
	}

	opts := &uctypes.WaveAIOptsType{
		APIType:       aiusechat.APIType_Anthropic,
		APIToken:      apiKey,
		Model:         model,
		MaxTokens:     4096,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
	}

	req := &uctypes.UseChatRequest{
		Messages: []uctypes.UIMessage{
			{
				Role: "user",
				Parts: []uctypes.UIMessagePart{
					{
						Type: "text",
						Text: message,
					},
				},
			},
		},
	}

	fmt.Printf("Testing Anthropic streaming with model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := sse.MakeSSEHandlerCh(testWriter, ctx)
	defer sseHandler.Close()

	err := aiusechat.RunWaveAIRequest(ctx, sseHandler, opts, req, tools)
	if err != nil {
		fmt.Printf("Anthropic streaming error: %v\n", err)
	}
}

func printUsage() {
	fmt.Println("Usage: go run main-testai.go [--anthropic] [--tools] [--model <model>] [message]")
	fmt.Println("Examples:")
	fmt.Println("  go run main-testai.go 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --model o4-mini 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --anthropic 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --anthropic --model claude-3-5-sonnet-20241022 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --tools 'Help me configure GitHub Actions monitoring'")
	fmt.Println("")
	fmt.Println("Default models:")
	fmt.Println("  OpenAI: gpt-5")
	fmt.Println("  Anthropic: claude-sonnet-4-20250514")
	fmt.Println("")
	fmt.Println("Environment variables:")
	fmt.Println("  OPENAI_API_KEY (for OpenAI models)")
	fmt.Println("  ANTHROPIC_API_KEY (for Anthropic models)")
}

func main() {
	var anthropic, tools, help bool
	var model string
	flag.BoolVar(&anthropic, "anthropic", false, "Use Anthropic API instead of OpenAI")
	flag.BoolVar(&tools, "tools", false, "Enable GitHub Actions Monitor tools for testing")
	flag.StringVar(&model, "model", "", "AI model to use (defaults: gpt-5 for OpenAI, claude-sonnet-4-20250514 for Anthropic)")
	flag.BoolVar(&help, "help", false, "Show usage information")
	flag.Parse()

	if help {
		printUsage()
		os.Exit(0)
	}

	// Set default model based on API type if not provided
	if model == "" {
		if anthropic {
			model = "claude-sonnet-4-20250514"
		} else {
			model = "gpt-5"
		}
	}

	args := flag.Args()
	message := "What is 2+2?"
	if len(args) > 0 {
		message = args[0]
	}

	var toolDefs []uctypes.ToolDefinition
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
