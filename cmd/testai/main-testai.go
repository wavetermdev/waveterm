// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveai"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

func testOpenAI(model, message string) {
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

	ctx := context.Background()
	testWriter := &TestResponseWriter{}
	sseHandler := waveai.MakeSSEHandlerCh(testWriter, ctx)

	err := sseHandler.SetupSSE()
	if err != nil {
		fmt.Printf("Error setting up SSE: %v\n", err)
		return
	}
	defer sseHandler.Close()

	waveai.StreamOpenAIToUseChat(sseHandler, ctx, opts, messages)
}

func testAnthropic(model, message string) {
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

	ctx := context.Background()
	testWriter := &TestResponseWriter{}
	sseHandler := waveai.MakeSSEHandlerCh(testWriter, ctx)

	err := sseHandler.SetupSSE()
	if err != nil {
		fmt.Printf("Error setting up SSE: %v\n", err)
		return
	}
	defer sseHandler.Close()

	stopReason, err := waveai.StreamAnthropicResponses(ctx, sseHandler, opts, messages)
	if err != nil {
		fmt.Printf("Anthropic streaming error: %v\n", err)
	}
	if stopReason != nil {
		fmt.Printf("Stop reason: %+v\n", stopReason)
	}
}

func main() {
	var anthropic bool
	flag.BoolVar(&anthropic, "anthropic", false, "Use Anthropic API instead of OpenAI")
	flag.Parse()

	args := flag.Args()
	if len(args) < 1 {
		fmt.Println("Usage: go run main-testai.go [--anthropic] <model> [message]")
		fmt.Println("Examples:")
		fmt.Println("  go run main-testai.go o4-mini 'What is 2+2?'")
		fmt.Println("  go run main-testai.go --anthropic claude-3-5-sonnet-20241022 'What is 2+2?'")
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

	if anthropic {
		testAnthropic(model, message)
	} else {
		testOpenAI(model, message)
	}
}
