// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
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

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run main-testai.go <model> [message]")
		fmt.Println("Example: go run main-testai.go o4-mini 'What is 2+2?'")
		fmt.Println("Set OPENAI_API_KEY environment variable")
		os.Exit(1)
	}

	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		fmt.Println("Error: OPENAI_API_KEY environment variable not set")
		os.Exit(1)
	}

	model := os.Args[1]
	message := "What is 2+2?"
	if len(os.Args) > 2 {
		message = os.Args[2]
	}

	// Create AI options
	opts := &wshrpc.WaveAIOptsType{
		APIToken:  apiKey,
		Model:     model,
		MaxTokens: 1000,
	}

	// Create messages
	messages := []waveai.UseChatMessage{
		{
			Role:    "user",
			Content: message,
		},
	}

	fmt.Printf("Testing AI streaming with model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Println("---")

	// Create a test response writer and SSE handler
	ctx := context.Background()
	testWriter := &TestResponseWriter{}
	sseHandler := waveai.MakeSSEHandlerCh(testWriter, ctx)

	// Setup the SSE handler
	err := sseHandler.SetupSSE()
	if err != nil {
		fmt.Printf("Error setting up SSE: %v\n", err)
		return
	}
	defer sseHandler.Close()

	// Call the streaming function
	waveai.StreamOpenAIToUseChat(sseHandler, ctx, opts, messages)

	fmt.Println("---")
	fmt.Println("Test completed")
}
