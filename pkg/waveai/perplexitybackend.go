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

type PerplexityBackend struct{}

var _ AIBackend = PerplexityBackend{}

// Perplexity API request types
type perplexityMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type perplexityRequest struct {
	Model    string              `json:"model"`
	Messages []perplexityMessage `json:"messages"`
	Stream   bool                `json:"stream"`
}

// Perplexity API response types
type perplexityResponseDelta struct {
	Content string `json:"content"`
}

type perplexityResponseChoice struct {
	Delta        perplexityResponseDelta `json:"delta"`
	FinishReason string                  `json:"finish_reason"`
}

type perplexityResponse struct {
	ID      string                     `json:"id"`
	Choices []perplexityResponseChoice `json:"choices"`
	Model   string                     `json:"model"`
}

func (PerplexityBackend) StreamCompletion(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])

	go func() {
		defer func() {
			panicErr := panichandler.PanicHandler("PerplexityBackend.StreamCompletion", recover())
			if panicErr != nil {
				rtn <- makeAIError(panicErr)
			}
			close(rtn)
		}()

		if request.Opts == nil {
			rtn <- makeAIError(errors.New("no perplexity opts found"))
			return
		}

		model := request.Opts.Model
		if model == "" {
			model = "llama-3.1-sonar-small-128k-online"
		}

		// Convert messages format
		var messages []perplexityMessage
		for _, msg := range request.Prompt {
			role := "user"
			if msg.Role == "assistant" {
				role = "assistant"
			} else if msg.Role == "system" {
				role = "system"
			}

			messages = append(messages, perplexityMessage{
				Role:    role,
				Content: msg.Content,
			})
		}

		perplexityReq := perplexityRequest{
			Model:    model,
			Messages: messages,
			Stream:   true,
		}

		reqBody, err := json.Marshal(perplexityReq)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("failed to marshal perplexity request: %v", err))
			return
		}

		req, err := http.NewRequestWithContext(ctx, "POST", "https://api.perplexity.ai/chat/completions", strings.NewReader(string(reqBody)))
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("failed to create perplexity request: %v", err))
			return
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+request.Opts.APIToken)

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
			rtn <- makeAIError(fmt.Errorf("failed to send perplexity request: %v", err))
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			rtn <- makeAIError(fmt.Errorf("Perplexity API error: %s - %s", resp.Status, string(bodyBytes)))
			return
		}

		reader := bufio.NewReader(resp.Body)
		sentHeader := false

		for {
			// Check for context cancellation
			select {
			case <-ctx.Done():
				rtn <- makeAIError(fmt.Errorf("request cancelled: %v", ctx.Err()))
				return
			default:
			}

			line, err := reader.ReadString('\n')
			if err == io.EOF {
				break
			}
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("error reading stream: %v", err))
				break
			}

			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "data: ") {
				continue
			}

			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var response perplexityResponse
			if err := json.Unmarshal([]byte(data), &response); err != nil {
				rtn <- makeAIError(fmt.Errorf("error unmarshaling response: %v", err))
				break
			}

			if !sentHeader {
				pk := MakeWaveAIPacket()
				pk.Model = response.Model
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				sentHeader = true
			}

			for _, choice := range response.Choices {
				pk := MakeWaveAIPacket()
				pk.Text = choice.Delta.Content
				pk.FinishReason = choice.FinishReason
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
			}
		}
	}()

	return rtn
}
