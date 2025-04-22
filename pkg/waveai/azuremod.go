// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// customAzureDeploymentURL constructs the full Azure URL with the deployment path and API version
func customAzureDeploymentURL(baseURL, model, apiVersion string) string {
	// Remove any trailing slashes from the base URL
	baseURL = strings.TrimSuffix(baseURL, "/")

	// If baseURL already contains the deployment path, use it directly
	if strings.Contains(baseURL, "/openai/deployments/") {
		if !strings.Contains(baseURL, "api-version=") && apiVersion != "" {
			if strings.Contains(baseURL, "?") {
				return baseURL + "&api-version=" + apiVersion
			} else {
				return baseURL + "?api-version=" + apiVersion
			}
		}
		return baseURL
	}

	// Exact URL format used in the curl command
	url := fmt.Sprintf("%s/openai/deployments/%s/chat/completions", baseURL, model)
	if apiVersion != "" {
		url = url + "?api-version=" + apiVersion
	}

	log.Printf("Azure URL constructed exactly as curl command: %s", url)
	return url
}

// customDirectAzureRequest makes a direct HTTP request to Azure without using the OpenAI library
// This exactly mimics the curl command format to ensure compatibility
func customDirectAzureRequest(ctx context.Context, url string, apiKey string, messages []openaiapi.ChatCompletionMessage) (*http.Response, error) {
	type Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}

	type RequestBody struct {
		Messages            []Message `json:"messages"`
		MaxCompletionTokens int       `json:"max_completion_tokens"`
		Temperature         float32   `json:"temperature"`
		TopP                float32   `json:"top_p"`
		FrequencyPenalty    float32   `json:"frequency_penalty"`
		PresencePenalty     float32   `json:"presence_penalty"`
		Model               string    `json:"model,omitempty"`
	}

	// Convert messages to the required format
	var requestMessages []Message
	for i, msg := range messages {
		// Make sure we only include messages with valid roles for Azure
		role := strings.ToLower(msg.Role)
		if role != "system" && role != "assistant" && role != "user" &&
			role != "function" && role != "tool" && role != "developer" {
			log.Printf("WARNING: Invalid role '%s' found in messages at index %d, defaulting to 'user'", role, i)
			role = "user" // Default to user for invalid roles
		}

		// Handle empty content
		content := msg.Content
		if strings.TrimSpace(content) == "" {
			content = "Empty message" // Prevent empty content
		}

		requestMessages = append(requestMessages, Message{
			Role:    role,
			Content: content,
		})
	}

	// Make sure we have at least one message
	if len(requestMessages) == 0 {
		log.Printf("WARNING: No valid messages found, adding default message")
		requestMessages = append(requestMessages, Message{
			Role:    "user",
			Content: "Hello",
		})
	}

	// Simplify to just one user message if that's all we need for debugging
	if debugAzureURLs {
		// Print all messages for debugging
		for i, msg := range requestMessages {
			// Truncate long messages for logging
			content := msg.Content
			if len(content) > 50 {
				content = content[:50] + "..."
			}
			log.Printf("Message %d: Role=%s, Content=%s", i, msg.Role, content)
		}
	}

	// Create request body exactly as in the curl example
	requestBody := RequestBody{
		Messages:            requestMessages,
		MaxCompletionTokens: 8000,
		Temperature:         1.0,
		TopP:                1.0,
		FrequencyPenalty:    0.0,
		PresencePenalty:     0.0,
	}

	// Convert request body to JSON
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize request body: %v", err)
	}

	if debugAzureURLs {
		log.Printf("Direct Azure request URL: %s", url)
		log.Printf("Direct Azure request body: %s", string(jsonBody))
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	// Set headers exactly as in the curl example
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", apiKey)

	// Make HTTP request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %v", err)
	}

	// Check for HTTP errors
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		// Recreate response body for the caller
		resp.Body = io.NopCloser(bytes.NewBuffer(body))
		log.Printf("Azure API error: Status: %s, Body: %s", resp.Status, string(body))
		return resp, fmt.Errorf("received non-200 response: %s, Body: %s", resp.Status, string(body))
	}

	return resp, nil
}

// customDirectAzureStreamRequest makes a direct HTTP request to Azure with streaming support
// This allows receiving content as it's generated instead of waiting for the complete response
func customDirectAzureStreamRequest(ctx context.Context, url string, apiKey string, messages []openaiapi.ChatCompletionMessage) (chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType], error) {
	type Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}

	type RequestBody struct {
		Messages            []Message `json:"messages"`
		MaxCompletionTokens int       `json:"max_completion_tokens"`
		Temperature         float32   `json:"temperature"`
		TopP                float32   `json:"top_p"`
		FrequencyPenalty    float32   `json:"frequency_penalty"`
		PresencePenalty     float32   `json:"presence_penalty"`
		Stream              bool      `json:"stream"`
		Model               string    `json:"model,omitempty"`
	}

	// Create response channel
	responseChan := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])

	// Convert messages to the required format with validation
	var requestMessages []Message
	for i, msg := range messages {
		// Make sure we only include messages with valid roles for Azure
		role := strings.ToLower(msg.Role)
		if role != "system" && role != "assistant" && role != "user" &&
			role != "function" && role != "tool" && role != "developer" {
			log.Printf("WARNING: Invalid role '%s' found in messages at index %d, defaulting to 'user'", role, i)
			role = "user" // Default to user for invalid roles
		}

		// Handle empty content
		content := msg.Content
		if strings.TrimSpace(content) == "" {
			content = "Empty message" // Prevent empty content
		}

		requestMessages = append(requestMessages, Message{
			Role:    role,
			Content: content,
		})
	}

	// Make sure we have at least one message
	if len(requestMessages) == 0 {
		log.Printf("WARNING: No valid messages found, adding default message")
		requestMessages = append(requestMessages, Message{
			Role:    "user",
			Content: "Hello",
		})
	}

	// Create request body for streaming
	requestBody := RequestBody{
		Messages:            requestMessages,
		MaxCompletionTokens: 8000,
		Temperature:         1.0,
		TopP:                1.0,
		FrequencyPenalty:    0.0,
		PresencePenalty:     0.0,
		Stream:              true, // Enable streaming
	}

	// Convert request body to JSON
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return responseChan, fmt.Errorf("failed to serialize request body: %v", err)
	}

	if debugAzureURLs {
		log.Printf("Azure streaming request URL: %s", url)
		log.Printf("Azure streaming request body: %s", string(jsonBody))
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return responseChan, fmt.Errorf("failed to create request: %v", err)
	}

	// Set headers for streaming request
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", apiKey)
	req.Header.Set("Accept", "text/event-stream")

	// Launch goroutine to process streaming response
	go func() {
		defer close(responseChan)

		// Make HTTP request
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			responseChan <- makeAIError(fmt.Errorf("failed to execute streaming request: %v", err))
			return
		}
		defer resp.Body.Close()

		// Check for HTTP errors
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			log.Printf("Azure API streaming error: Status: %s, Body: %s", resp.Status, string(body))
			responseChan <- makeAIError(fmt.Errorf("received non-200 response: %s, Body: %s", resp.Status, string(body)))
			return
		}

		// Stream processing for SSE (Server-Sent Events)
		scanner := bufio.NewScanner(resp.Body)
		var headerSent bool
		var createdTime int64 = time.Now().Unix()
		var model string

		// For collecting partial JSON fragments
		var jsonBuffer strings.Builder
		inFragment := false

		for scanner.Scan() {
			line := scanner.Text()

			// Skip empty lines
			if strings.TrimSpace(line) == "" {
				continue
			}

			// Handle data lines
			if strings.HasPrefix(line, "data: ") {
				data := line[6:] // Remove "data: " prefix

				// Check for the end of the stream
				if data == "[DONE]" {
					break
				}

				// If this is a JSON fragment, handle it
				if strings.HasPrefix(data, "{") {
					jsonBuffer.WriteString(data)
					inFragment = true
				} else if inFragment {
					jsonBuffer.WriteString(data)
				}

				// Try to parse complete JSON objects
				if inFragment && (strings.HasSuffix(data, "}") || strings.Contains(data, "}\n")) {
					jsonData := jsonBuffer.String()
					jsonBuffer.Reset()
					inFragment = false

					// Parse the JSON data
					var streamResp struct {
						ID      string `json:"id"`
						Object  string `json:"object"`
						Created int64  `json:"created"`
						Model   string `json:"model"`
						Choices []struct {
							Index int `json:"index"`
							Delta struct {
								Content string `json:"content"`
								Role    string `json:"role"`
							} `json:"delta"`
							FinishReason string `json:"finish_reason"`
						} `json:"choices"`
					}

					err := json.Unmarshal([]byte(jsonData), &streamResp)
					if err != nil {
						log.Printf("Error parsing SSE JSON: %v, data: %s", err, jsonData)
						continue
					}

					// Send header packet if not sent
					if !headerSent {
						headerPk := MakeWaveAIPacket()
						if streamResp.Model != "" {
							model = streamResp.Model
						} else {
							model = "gpt-4.1" // Default if not specified
						}
						if streamResp.Created > 0 {
							createdTime = streamResp.Created
						}
						headerPk.Model = model
						headerPk.Created = createdTime
						responseChan <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *headerPk}
						headerSent = true
					}

					// Process all choices in the response
					for _, choice := range streamResp.Choices {
						if choice.Delta.Content != "" {
							pk := MakeWaveAIPacket()
							pk.Index = choice.Index
							pk.Text = choice.Delta.Content
							pk.FinishReason = choice.FinishReason
							responseChan <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
						}
					}
				}
			}
		}

		if scanner.Err() != nil {
			log.Printf("Error reading streaming response: %v", scanner.Err())
			responseChan <- makeAIError(fmt.Errorf("error reading streaming response: %v", scanner.Err()))
		}
	}()

	return responseChan, nil
}
