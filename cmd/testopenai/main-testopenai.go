// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
)

func makeOpenAIRequest(ctx context.Context, apiKey, model, message string, tools bool) error {
	reqBody := openai.OpenAIRequest{
		Model: model,
		Input: []openai.OpenAIMessage{
			{
				Role: "user",
				Content: []openai.OpenAIMessageContent{
					{
						Type: "input_text",
						Text: message,
					},
				},
			},
		},
		Stream:        true,
		StreamOptions: &openai.StreamOptionsType{IncludeObfuscation: false},
		Reasoning:     &openai.ReasoningType{Effort: "medium"},
	}
	if tools {
		reqBody.Tools = []openai.OpenAIRequestTool{
			openai.ConvertToolDefinitionToOpenAI(aiusechat.GetAdderToolDefinition()),
		}
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("error marshaling request: %v", err)
	}

	// Pretty print the request JSON for debugging
	prettyJSON, err := json.MarshalIndent(reqBody, "", "  ")
	if err == nil {
		fmt.Printf("Request JSON:\n%s\n", string(prettyJSON))
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.openai.com/v1/responses", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("error creating request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "text/event-stream")

	client := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error making request: %v", err)
	}
	defer resp.Body.Close()

	fmt.Printf("Response Status: %s\n", resp.Status)
	fmt.Printf("Response Headers:\n")
	for name, values := range resp.Header {
		for _, value := range values {
			fmt.Printf("  %s: %s\n", name, value)
		}
	}
	fmt.Println("---")

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	return processSSEStream(resp.Body)
}

func processSSEStream(reader io.Reader) error {
	scanner := bufio.NewScanner(reader)

	fmt.Println("SSE Stream:")
	fmt.Println("---")

	for scanner.Scan() {
		line := scanner.Text()
		fmt.Println(line)
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading stream: %v", err)
	}

	return nil
}

func printUsage() {
	fmt.Println("Usage: go run main-testopenai.go [--model <model>] [--tools] [message]")
	fmt.Println("Examples:")
	fmt.Println("  go run main-testopenai.go 'Stream me a limerick about gophers coding in Go.'")
	fmt.Println("  go run main-testopenai.go --model gpt-4 'What is 2+2?'")
	fmt.Println("  go run main-testopenai.go --tools 'What is 2+2? Use the adder tool.'")
	fmt.Println("")
	fmt.Println("Default model: gpt-5-mini")
	fmt.Println("")
	fmt.Println("Environment variables:")
	fmt.Println("  OPENAI_APIKEY (required)")
}

func main() {
	var model string
	var showHelp bool
	var tools bool

	flag.StringVar(&model, "model", "gpt-5-mini", "OpenAI model to use")
	flag.BoolVar(&showHelp, "help", false, "Show usage information")
	flag.BoolVar(&tools, "tools", false, "Enable tools for testing")
	flag.Parse()

	if showHelp {
		printUsage()
		os.Exit(0)
	}

	apiKey := os.Getenv("OPENAI_APIKEY")
	if apiKey == "" {
		fmt.Println("Error: OPENAI_APIKEY environment variable not set")
		printUsage()
		os.Exit(1)
	}

	args := flag.Args()
	message := "Stream me a limerick about gophers coding in Go."
	if len(args) > 0 {
		message = args[0]
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	fmt.Printf("Testing OpenAI Responses API\n")
	fmt.Printf("Model: %s\n", model)
	fmt.Printf("Message: %s\n", message)
	fmt.Println("===")

	if err := makeOpenAIRequest(ctx, apiKey, model, message, tools); err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
}
