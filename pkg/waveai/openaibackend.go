// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"sync"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type OpenAIBackend struct{}

var _ AIBackend = OpenAIBackend{}

const DefaultAzureAPIVersion = "2023-05-15"
const debugAzureURLs = true

// copied from go-openai/config.go
func defaultAzureMapperFn(model string) string {
	return regexp.MustCompile(`[.:]`).ReplaceAllString(model, "")
}

// Note: customAzureDeploymentURL function has been moved to azuremod.go

func setApiType(opts *wshrpc.WaveAIOptsType, clientConfig *openaiapi.ClientConfig) error {
	ourApiType := strings.ToLower(opts.APIType)
	if ourApiType == "" || ourApiType == APIType_OpenAI || ourApiType == strings.ToLower(string(openaiapi.APITypeOpenAI)) {
		clientConfig.APIType = openaiapi.APITypeOpenAI
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeAzure)) {
		clientConfig.APIType = openaiapi.APITypeAzure
		// Always prioritize user-provided API version for Azure
		if opts.APIVersion != "" {
			clientConfig.APIVersion = opts.APIVersion
		} else {
			clientConfig.APIVersion = DefaultAzureAPIVersion
		}
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeAzureAD)) {
		clientConfig.APIType = openaiapi.APITypeAzureAD
		if opts.APIVersion != "" {
			clientConfig.APIVersion = opts.APIVersion
		} else {
			clientConfig.APIVersion = DefaultAzureAPIVersion
		}
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeCloudflareAzure)) {
		clientConfig.APIType = openaiapi.APITypeCloudflareAzure
		if opts.APIVersion != "" {
			clientConfig.APIVersion = opts.APIVersion
		} else {
			clientConfig.APIVersion = DefaultAzureAPIVersion
		}
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else {
		return fmt.Errorf("invalid api type %q", opts.APIType)
	}
}

func convertPrompt(prompt []wshrpc.WaveAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	for _, p := range prompt {
		msg := openaiapi.ChatCompletionMessage{Role: p.Role, Content: p.Content, Name: p.Name}

		// Handle file attachments by adding them to the content
		if len(p.FileAttachments) > 0 {
			var contentBuilder strings.Builder
			contentBuilder.WriteString(p.Content)

			for _, attachment := range p.FileAttachments {
				contentBuilder.WriteString("\n\n")
				contentBuilder.WriteString("File: " + attachment.FileName + "\n")
				contentBuilder.WriteString("```\n")
				contentBuilder.WriteString(attachment.FileContent)
				contentBuilder.WriteString("\n```")
			}

			msg.Content = contentBuilder.String()
		}

		rtn = append(rtn, msg)
	}
	return rtn
}

// Enhanced version with validation
func convertPromptWithValidation(prompt []wshrpc.WaveAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	log.Printf("Converting %d messages", len(prompt))

	for i, p := range prompt {
		// For debugging
		content := p.Content
		if len(content) > 50 {
			content = content[:50] + "..."
		}
		log.Printf("Original message %d: Role=%s, Content=%s", i, p.Role, content)

		// Clean up role names
		role := p.Role
		if role == "" || role == "error" {
			log.Printf("Fixing invalid role '%s' at index %d", role, i)
			role = "user" // Default role
		}

		msg := openaiapi.ChatCompletionMessage{
			Role:    role,
			Content: p.Content,
			Name:    p.Name,
		}

		// Handle file attachments by adding them to the content
		if len(p.FileAttachments) > 0 {
			log.Printf("Message %d has %d file attachments", i, len(p.FileAttachments))

			var contentBuilder strings.Builder
			contentBuilder.WriteString(p.Content)

			for _, attachment := range p.FileAttachments {
				contentBuilder.WriteString("\n\n")
				contentBuilder.WriteString("File: " + attachment.FileName + "\n")
				contentBuilder.WriteString("```\n")
				contentBuilder.WriteString(attachment.FileContent)
				contentBuilder.WriteString("\n```")
			}

			msg.Content = contentBuilder.String()
		}

		rtn = append(rtn, msg)
	}

	// Make sure we have at least one message
	if len(rtn) == 0 {
		log.Printf("No valid messages found, adding a default message")
		rtn = append(rtn, openaiapi.ChatCompletionMessage{
			Role:    "user",
			Content: "Hello",
		})
	}

	return rtn
}

func (OpenAIBackend) StreamCompletion(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])
	go func() {
		// Use a WaitGroup to track any additional goroutines we spawn
		var wg sync.WaitGroup

		// Create a context that we can cancel if needed
		ctx, cancel := context.WithCancel(ctx)
		defer cancel() // Make sure we cancel the context when we're done

		defer func() {
			// Wait for all goroutines to complete before closing the channel
			wg.Wait()

			panicErr := panichandler.PanicHandler("OpenAIBackend.StreamCompletion", recover())
			if panicErr != nil {
				rtn <- makeAIError(panicErr)
			}
			close(rtn)
		}()

		if request.Opts == nil {
			rtn <- makeAIError(errors.New("no openai opts found"))
			return
		}
		if request.Opts.Model == "" {
			rtn <- makeAIError(errors.New("no openai model specified"))
			return
		}
		if request.Opts.BaseURL == "" && request.Opts.APIToken == "" {
			rtn <- makeAIError(errors.New("no api token"))
			return
		}

		// Special handling for Azure API
		if strings.EqualFold(request.Opts.APIType, "azure") {
			customURL := customAzureDeploymentURL(
				request.Opts.BaseURL,
				request.Opts.Model,
				request.Opts.APIVersion,
			)
			log.Printf("Using custom Azure URL: %s", customURL)

			// Use streaming by default for Azure
			useStreaming := true

			// Log authentication method (without revealing the full key)
			if len(request.Opts.APIToken) > 0 {
				maskedToken := "****" + request.Opts.APIToken[len(request.Opts.APIToken)-4:]
				log.Printf("Using API key authentication, token ending in: %s", maskedToken)
			} else {
				log.Printf("No API token found!")
				rtn <- makeAIError(errors.New("no API token for Azure"))
				return
			}

			if useStreaming {
				// Use streaming implementation
				log.Printf("Using streaming mode for Azure OpenAI")
				streamChan, err := customDirectAzureStreamRequest(
					ctx,
					customURL,
					request.Opts.APIToken,
					convertPromptWithValidation(request.Prompt),
				)

				if err != nil {
					rtn <- makeAIError(fmt.Errorf("error setting up Azure API streaming: %v", err))
					return
				}

				// Add this goroutine to the WaitGroup
				wg.Add(1)

				// Forward messages from the streaming channel to our return channel
				go func() {
					defer wg.Done() // Mark this goroutine as done when it exits

					// Forward all messages from streamChan to rtn
					for msg := range streamChan {
						select {
						case rtn <- msg:
							// Message sent successfully
						case <-ctx.Done():
							// Parent context was cancelled, exit
							return
						}
					}
				}()

				// Return immediately - messages will be forwarded through the channel
				return
			} else {
				// Use non-streaming implementation (existing code)
				// Make direct HTTP request to Azure
				resp, err := customDirectAzureRequest(
					ctx,
					customURL,
					request.Opts.APIToken,
					convertPromptWithValidation(request.Prompt),
				)

				if err != nil {
					rtn <- makeAIError(fmt.Errorf("error calling Azure API directly: %v", err))
					return
				}

				// Parse response
				var azureResp struct {
					ID      string `json:"id"`
					Object  string `json:"object"`
					Created int64  `json:"created"`
					Model   string `json:"model"`
					Choices []struct {
						Index        int    `json:"index"`
						FinishReason string `json:"finish_reason"`
						Message      struct {
							Role    string `json:"role"`
							Content string `json:"content"`
						} `json:"message"`
					} `json:"choices"`
				}

				// Read and decode response body
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err != nil {
					rtn <- makeAIError(fmt.Errorf("error reading Azure response: %v", err))
					return
				}

				log.Printf("Azure response body: %s", string(body))

				err = json.Unmarshal(body, &azureResp)
				if err != nil {
					rtn <- makeAIError(fmt.Errorf("error parsing Azure response: %v", err))
					return
				}

				// Create and send header packet
				headerPk := MakeWaveAIPacket()
				headerPk.Model = azureResp.Model
				headerPk.Created = azureResp.Created
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *headerPk}

				// Send content packet(s)
				for i, choice := range azureResp.Choices {
					pk := MakeWaveAIPacket()
					pk.Index = i
					pk.Text = choice.Message.Content
					pk.FinishReason = choice.FinishReason
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				}

				return
			}
		}

		// Regular OpenAI API handling (non-Azure)
		clientConfig := openaiapi.DefaultConfig(request.Opts.APIToken)
		if request.Opts.BaseURL != "" {
			clientConfig.BaseURL = request.Opts.BaseURL
		}
		err := setApiType(request.Opts, &clientConfig)
		if err != nil {
			rtn <- makeAIError(err)
			return
		}
		if request.Opts.OrgID != "" {
			clientConfig.OrgID = request.Opts.OrgID
		}
		if request.Opts.APIVersion != "" {
			clientConfig.APIVersion = request.Opts.APIVersion
		}

		client := openaiapi.NewClientWithConfig(clientConfig)
		req := openaiapi.ChatCompletionRequest{
			Model:    request.Opts.Model,
			Messages: convertPrompt(request.Prompt),
		}

		// Add debug logging
		log.Printf("OpenAI config - BaseURL: %s, APIType: %s, APIVersion: %s, Model: %s",
			clientConfig.BaseURL, clientConfig.APIType, clientConfig.APIVersion, request.Opts.Model)

		// Handle o1 models differently - use non-streaming API
		if strings.HasPrefix(request.Opts.Model, "o1-") {
			req.MaxCompletionTokens = request.Opts.MaxTokens
			req.Stream = false

			// Make non-streaming API call
			resp, err := client.CreateChatCompletion(ctx, req)
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("error calling openai API: %v", err))
				return
			}

			// Send header packet
			headerPk := MakeWaveAIPacket()
			headerPk.Model = resp.Model
			headerPk.Created = resp.Created
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *headerPk}

			// Send content packet(s)
			for i, choice := range resp.Choices {
				pk := MakeWaveAIPacket()
				pk.Index = i
				pk.Text = choice.Message.Content
				pk.FinishReason = string(choice.FinishReason)
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
			}
			return
		}

		// Original streaming implementation for non-o1 models
		req.Stream = true
		req.MaxTokens = request.Opts.MaxTokens
		if request.Opts.MaxChoices > 1 {
			req.N = request.Opts.MaxChoices
		}

		apiResp, err := client.CreateChatCompletionStream(ctx, req)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("error calling openai API: %v", err))
			return
		}
		sentHeader := false
		for {
			streamResp, err := apiResp.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("OpenAI request, error reading message: %v", err))
				break
			}
			if streamResp.Model != "" && !sentHeader {
				pk := MakeWaveAIPacket()
				pk.Model = streamResp.Model
				pk.Created = streamResp.Created
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
				sentHeader = true
			}
			for _, choice := range streamResp.Choices {
				pk := MakeWaveAIPacket()
				pk.Index = choice.Index
				pk.Text = choice.Delta.Content
				pk.FinishReason = string(choice.FinishReason)
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: *pk}
			}
		}
	}()
	return rtn
}

// Note: customDirectAzureRequest and customDirectAzureStreamRequest functions have been moved to azuremod.go
