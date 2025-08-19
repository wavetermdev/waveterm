// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type AnthropicBackend struct{}

var _ AIBackend = AnthropicBackend{}

// Claude API request types
type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicRequest struct {
	Model       string             `json:"model"`
	Messages    []anthropicMessage `json:"messages"`
	System      string             `json:"system,omitempty"`
	MaxTokens   int                `json:"max_tokens,omitempty"`
	Stream      bool               `json:"stream"`
	Temperature float32            `json:"temperature,omitempty"`
}

// Claude API response types for SSE events
type anthropicContentBlock struct {
	Type string `json:"type"` // "text" or other content types
	Text string `json:"text,omitempty"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicResponseMessage struct {
	ID           string                  `json:"id"`
	Type         string                  `json:"type"`
	Role         string                  `json:"role"`
	Content      []anthropicContentBlock `json:"content"`
	Model        string                  `json:"model"`
	StopReason   string                  `json:"stop_reason,omitempty"`
	StopSequence string                  `json:"stop_sequence,omitempty"`
	Usage        *anthropicUsage         `json:"usage,omitempty"`
}

type anthropicStreamEventError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type anthropicStreamEventDelta struct {
	Text string `json:"text"`
}

type anthropicStreamEvent struct {
	Type         string                     `json:"type"`
	Message      *anthropicResponseMessage  `json:"message,omitempty"`
	ContentBlock *anthropicContentBlock     `json:"content_block,omitempty"`
	Delta        *anthropicStreamEventDelta `json:"delta,omitempty"`
	Error        *anthropicStreamEventError `json:"error,omitempty"`
	Usage        *anthropicUsage            `json:"usage,omitempty"`
}

// SSE event represents a parsed Server-Sent Event
type sseEvent struct {
	Event string // The event type field
	Data  string // The data field
}

// parseSSE reads and parses SSE format from a bufio.Reader
func parseSSE(reader *bufio.Reader) (*sseEvent, error) {
	var event sseEvent

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}

		line = strings.TrimSpace(line)
		if line == "" {
			// Empty line signals end of event
			if event.Event != "" || event.Data != "" {
				return &event, nil
			}
			continue
		}

		if strings.HasPrefix(line, "event:") {
			event.Event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			event.Data = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
	}
}

func (AnthropicBackend) StreamCompletion(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])

	go func() {
		defer func() {
			panicErr := panichandler.PanicHandler("AnthropicBackend.StreamCompletion", recover())
			if panicErr != nil {
				rtn <- makeAIError(panicErr)
			}
			close(rtn)
		}()

		if request.Opts == nil {
			rtn <- makeAIError(errors.New("no anthropic opts found"))
			return
		}

		model := request.Opts.Model
		if model == "" {
			model = "claude-3-sonnet-20250229" // default model
		}

		// Convert messages format
		var messages []anthropicMessage
		var systemPrompt string

		for _, msg := range request.Prompt {
			if msg.Role == "system" {
				if systemPrompt != "" {
					systemPrompt += "\n"
				}
				systemPrompt += msg.Content
				continue
			}

			role := "user"
			if msg.Role == "assistant" {
				role = "assistant"
			}

			messages = append(messages, anthropicMessage{
				Role:    role,
				Content: msg.Content,
			})
		}

		anthropicReq := anthropicRequest{
			Model:     model,
			Messages:  messages,
			System:    systemPrompt,
			Stream:    true,
			MaxTokens: request.Opts.MaxTokens,
		}

		reqBody, err := json.Marshal(anthropicReq)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("failed to marshal anthropic request: %v", err))
			return
		}

		req, err := http.NewRequestWithContext(ctx, "POST", "https://api.anthropic.com/v1/messages", strings.NewReader(string(reqBody)))
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("failed to create anthropic request: %v", err))
			return
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("x-api-key", request.Opts.APIToken)
		req.Header.Set("anthropic-version", "2023-06-01")

		// Configure HTTP client with proxy if specified
		client := &http.Client{}
		if request.Opts.ProxyURL != "" {
			proxyURL, err := url.Parse(request.Opts.ProxyURL)
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("invalid proxy URL: %v", err))
				return
			}
			transport := &http.Transport{
				Proxy: http.ProxyURL(proxyURL),
			}
			client.Transport = transport
		}

		resp, err := client.Do(req)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("failed to send anthropic request: %v", err))
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			rtn <- makeAIError(fmt.Errorf("Anthropic API error: %s - %s", resp.Status, string(bodyBytes)))
			return
		}

		reader := bufio.NewReader(resp.Body)
		for {
			// Check for context cancellation
			select {
			case <-ctx.Done():
				rtn <- makeAIError(fmt.Errorf("request cancelled: %v", ctx.Err()))
				return
			default:
			}

			sse, err := parseSSE(reader)
			if err == io.EOF {
				break
			}
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("error reading SSE stream: %v", err))
				break
			}

			if sse.Event == "ping" {
				continue // Ignore ping events
			}

			var event anthropicStreamEvent
			if err := json.Unmarshal([]byte(sse.Data), &event); err != nil {
				rtn <- makeAIError(fmt.Errorf("error unmarshaling event data: %v", err))
				break
			}

			if event.Error != nil {
				rtn <- makeAIError(fmt.Errorf("Anthropic API error: %s - %s", event.Error.Type, event.Error.Message))
				break
			}

			switch sse.Event {
			case "message_start":
				if event.Message != nil {
					pk := MakeWaveAIPacket()
					pk.Model = event.Message.Model
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				}

			case "content_block_start":
				if event.ContentBlock != nil && event.ContentBlock.Text != "" {
					pk := MakeWaveAIPacket()
					pk.Text = event.ContentBlock.Text
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				}

			case "content_block_delta":
				if event.Delta != nil && event.Delta.Text != "" {
					pk := MakeWaveAIPacket()
					pk.Text = event.Delta.Text
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				}

			case "content_block_stop":
				// Note: According to the docs, this just signals the end of a content block
				// We might want to use this for tracking block boundaries, but for now
				// we don't need to send anything special to match OpenAI's format

			case "message_delta":
				// Update message metadata, usage stats
				if event.Usage != nil {
					pk := MakeWaveAIPacket()
					pk.Usage = &wshrpc.WaveAIUsageType{
						PromptTokens:     event.Usage.InputTokens,
						CompletionTokens: event.Usage.OutputTokens,
						TotalTokens:      event.Usage.InputTokens + event.Usage.OutputTokens,
					}
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				}

			case "message_stop":
				if event.Message != nil {
					pk := MakeWaveAIPacket()
					pk.FinishReason = event.Message.StopReason
					if event.Message.Usage != nil {
						pk.Usage = &wshrpc.WaveAIUsageType{
							PromptTokens:     event.Message.Usage.InputTokens,
							CompletionTokens: event.Message.Usage.OutputTokens,
							TotalTokens:      event.Message.Usage.InputTokens + event.Message.Usage.OutputTokens,
						}
					}
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				}

			default:
				rtn <- makeAIError(fmt.Errorf("unknown Anthropic event type: %s", sse.Event))
				return
			}
		}
	}()

	return rtn
}
