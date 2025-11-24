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

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

//go:embed testschema.json
var testSchemaJSON string

const (
	DefaultAnthropicModel = "claude-sonnet-4-5"
	DefaultOpenAIModel    = "gpt-5.1"
)

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
	apiKey := os.Getenv("OPENAI_APIKEY")
	if apiKey == "" {
		fmt.Println("Error: OPENAI_APIKEY environment variable not set")
		os.Exit(1)
	}

	opts := &uctypes.AIOptsType{
		APIType:       aiusechat.APIType_OpenAI,
		APIToken:      apiKey,
		Model:         model,
		MaxTokens:     4096,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
	}

	// Generate a chat ID
	chatID := uuid.New().String()

	// Convert to AIMessage format for WaveAIPostMessageWrap
	aiMessage := &uctypes.AIMessage{
		MessageId: uuid.New().String(),
		Parts: []uctypes.AIMessagePart{
			{
				Type: uctypes.AIMessagePartTypeText,
				Text: message,
			},
		},
	}

	fmt.Printf("Testing OpenAI streaming with WaveAIPostMessageWrap, model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Printf("Chat ID: %s\n", chatID)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := sse.MakeSSEHandlerCh(testWriter, ctx)
	defer sseHandler.Close()

	chatOpts := uctypes.WaveChatOpts{
		ChatId:   chatID,
		ClientId: uuid.New().String(),
		Config:   *opts,
		Tools:    tools,
	}
	err := aiusechat.WaveAIPostMessageWrap(ctx, sseHandler, aiMessage, chatOpts)
	if err != nil {
		fmt.Printf("OpenAI streaming error: %v\n", err)
	}
}

func testOpenAIComp(ctx context.Context, model, message string, tools []uctypes.ToolDefinition) {
	apiKey := os.Getenv("OPENAI_APIKEY")
	if apiKey == "" {
		fmt.Println("Error: OPENAI_APIKEY environment variable not set")
		os.Exit(1)
	}

	opts := &uctypes.AIOptsType{
		APIType:       aiusechat.APIType_OpenAIComp,
		APIToken:      apiKey,
		BaseURL:       "https://api.openai.com/v1/chat/completions",
		Model:         model,
		MaxTokens:     4096,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
	}

	chatID := uuid.New().String()

	aiMessage := &uctypes.AIMessage{
		MessageId: uuid.New().String(),
		Parts: []uctypes.AIMessagePart{
			{
				Type: uctypes.AIMessagePartTypeText,
				Text: message,
			},
		},
	}

	fmt.Printf("Testing OpenAI Completions API with WaveAIPostMessageWrap, model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Printf("Chat ID: %s\n", chatID)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := sse.MakeSSEHandlerCh(testWriter, ctx)
	defer sseHandler.Close()

	chatOpts := uctypes.WaveChatOpts{
		ChatId:       chatID,
		ClientId:     uuid.New().String(),
		Config:       *opts,
		Tools:        tools,
		SystemPrompt: []string{"You are a helpful assistant. Be concise and clear in your responses."},
	}
	err := aiusechat.WaveAIPostMessageWrap(ctx, sseHandler, aiMessage, chatOpts)
	if err != nil {
		fmt.Printf("OpenAI Completions API streaming error: %v\n", err)
	}
}

func testAnthropic(ctx context.Context, model, message string, tools []uctypes.ToolDefinition) {
	apiKey := os.Getenv("ANTHROPIC_APIKEY")
	if apiKey == "" {
		fmt.Println("Error: ANTHROPIC_APIKEY environment variable not set")
		os.Exit(1)
	}

	opts := &uctypes.AIOptsType{
		APIType:       aiusechat.APIType_Anthropic,
		APIToken:      apiKey,
		Model:         model,
		MaxTokens:     4096,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
	}

	// Generate a chat ID
	chatID := uuid.New().String()

	// Convert to AIMessage format for WaveAIPostMessageWrap
	aiMessage := &uctypes.AIMessage{
		MessageId: uuid.New().String(),
		Parts: []uctypes.AIMessagePart{
			{
				Type: uctypes.AIMessagePartTypeText,
				Text: message,
			},
		},
	}

	fmt.Printf("Testing Anthropic streaming with WaveAIPostMessageWrap, model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Printf("Chat ID: %s\n", chatID)
	fmt.Println("---")

	testWriter := &TestResponseWriter{}
	sseHandler := sse.MakeSSEHandlerCh(testWriter, ctx)
	defer sseHandler.Close()

	chatOpts := uctypes.WaveChatOpts{
		ChatId:   chatID,
		ClientId: uuid.New().String(),
		Config:   *opts,
		Tools:    tools,
	}
	err := aiusechat.WaveAIPostMessageWrap(ctx, sseHandler, aiMessage, chatOpts)
	if err != nil {
		fmt.Printf("Anthropic streaming error: %v\n", err)
	}
}

func testT1(ctx context.Context) {
	tool := aiusechat.GetAdderToolDefinition()
	tools := []uctypes.ToolDefinition{tool}
	testAnthropic(ctx, DefaultAnthropicModel, "what is 2+2, use the provider adder tool", tools)
}

func testT2(ctx context.Context) {
	tool := aiusechat.GetAdderToolDefinition()
	tools := []uctypes.ToolDefinition{tool}
	testOpenAI(ctx, DefaultOpenAIModel, "what is 2+2+8, use the provider adder tool", tools)
}

func testT3(ctx context.Context) {
	testOpenAIComp(ctx, "gpt-4o", "what is 2+2? please be brief", nil)
}

func printUsage() {
	fmt.Println("Usage: go run main-testai.go [--anthropic|--openaicomp] [--tools] [--model <model>] [message]")
	fmt.Println("Examples:")
	fmt.Println("  go run main-testai.go 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --model o4-mini 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --anthropic 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --anthropic --model claude-3-5-sonnet-20241022 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --openaicomp --model gpt-4o 'What is 2+2?'")
	fmt.Println("  go run main-testai.go --tools 'Help me configure GitHub Actions monitoring'")
	fmt.Println("")
	fmt.Println("Default models:")
	fmt.Printf("  OpenAI: %s\n", DefaultOpenAIModel)
	fmt.Printf("  Anthropic: %s\n", DefaultAnthropicModel)
	fmt.Printf("  OpenAI Completions: gpt-4o\n")
	fmt.Println("")
	fmt.Println("Environment variables:")
	fmt.Println("  OPENAI_APIKEY (for OpenAI models)")
	fmt.Println("  ANTHROPIC_APIKEY (for Anthropic models)")
}

func main() {
	var anthropic, openaicomp, tools, help, t1, t2, t3 bool
	var model string
	flag.BoolVar(&anthropic, "anthropic", false, "Use Anthropic API instead of OpenAI")
	flag.BoolVar(&openaicomp, "openaicomp", false, "Use OpenAI Completions API")
	flag.BoolVar(&tools, "tools", false, "Enable GitHub Actions Monitor tools for testing")
	flag.StringVar(&model, "model", "", fmt.Sprintf("AI model to use (defaults: %s for OpenAI, %s for Anthropic)", DefaultOpenAIModel, DefaultAnthropicModel))
	flag.BoolVar(&help, "help", false, "Show usage information")
	flag.BoolVar(&t1, "t1", false, fmt.Sprintf("Run preset T1 test (%s with 'what is 2+2')", DefaultAnthropicModel))
	flag.BoolVar(&t2, "t2", false, fmt.Sprintf("Run preset T2 test (%s with 'what is 2+2')", DefaultOpenAIModel))
	flag.BoolVar(&t3, "t3", false, "Run preset T3 test (OpenAI Completions API with gpt-4o)")
	flag.Parse()

	if help {
		printUsage()
		os.Exit(0)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if t1 {
		testT1(ctx)
		return
	}
	if t2 {
		testT2(ctx)
		return
	}
	if t3 {
		testT3(ctx)
		return
	}

	// Set default model based on API type if not provided
	if model == "" {
		if anthropic {
			model = DefaultAnthropicModel
		} else if openaicomp {
			model = "gpt-4o"
		} else {
			model = DefaultOpenAIModel
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

	if anthropic {
		testAnthropic(ctx, model, message, toolDefs)
	} else if openaicomp {
		testOpenAIComp(ctx, model, message, toolDefs)
	} else {
		testOpenAI(ctx, model, message, toolDefs)
	}
}
