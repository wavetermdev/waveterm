// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"

	"github.com/google/generative-ai-go/genai"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type GoogleBackend struct{}

var _ AIBackend = GoogleBackend{}

func (GoogleBackend) StreamCompletion(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	var clientOptions []option.ClientOption
	clientOptions = append(clientOptions, option.WithAPIKey(request.Opts.APIToken))

	// Configure proxy if specified
	if request.Opts.ProxyURL != "" {
		proxyURL, err := url.Parse(request.Opts.ProxyURL)
		if err != nil {
			rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])
			go func() {
				defer close(rtn)
				rtn <- makeAIError(fmt.Errorf("invalid proxy URL: %v", err))
			}()
			return rtn
		}
		transport := &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		}
		httpClient := &http.Client{
			Transport: transport,
		}
		clientOptions = append(clientOptions, option.WithHTTPClient(httpClient))
	}

	client, err := genai.NewClient(ctx, clientOptions...)
	if err != nil {
		log.Printf("failed to create client: %v", err)
		return nil
	}

	model := client.GenerativeModel(request.Opts.Model)
	if model == nil {
		log.Println("model not found")
		client.Close()
		return nil
	}

	cs := model.StartChat()
	cs.History = extractHistory(request.Prompt)
	iter := cs.SendMessageStream(ctx, extractPrompt(request.Prompt))

	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])

	go func() {
		defer client.Close()
		defer close(rtn)
		for {
			// Check for context cancellation
			if err := ctx.Err(); err != nil {
				rtn <- makeAIError(fmt.Errorf("request cancelled: %v", err))
				break
			}

			resp, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("Google API error: %v", err))
				break
			}

			rtn <- wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Response: wshrpc.WaveAIPacketType{Text: convertCandidatesToText(resp.Candidates)}}
		}
	}()
	return rtn
}

func extractHistory(history []wshrpc.WaveAIPromptMessageType) []*genai.Content {
	var rtn []*genai.Content
	for _, h := range history[:len(history)-1] {
		if h.Role == "user" || h.Role == "model" {
			rtn = append(rtn, &genai.Content{
				Role:  h.Role,
				Parts: []genai.Part{genai.Text(h.Content)},
			})
		}
	}
	return rtn
}

func extractPrompt(prompt []wshrpc.WaveAIPromptMessageType) genai.Part {
	p := prompt[len(prompt)-1]
	return genai.Text(p.Content)
}

func convertCandidatesToText(candidates []*genai.Candidate) string {
	var rtn string
	for _, c := range candidates {
		for _, p := range c.Content.Parts {
			rtn += fmt.Sprintf("%v", p)
		}
	}
	return rtn
}
