// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type OpenAIBackend struct{}

var _ AIBackend = OpenAIBackend{}

const DefaultAzureAPIVersion = "2023-05-15"

// copied from go-openai/config.go
func defaultAzureMapperFn(model string) string {
	return regexp.MustCompile(`[.:]`).ReplaceAllString(model, "")
}

func setApiType(opts *wshrpc.WaveAIOptsType, clientConfig *openaiapi.ClientConfig) error {
	ourApiType := strings.ToLower(opts.APIType)
	if ourApiType == "" || ourApiType == APIType_OpenAI || ourApiType == strings.ToLower(string(openaiapi.APITypeOpenAI)) {
		clientConfig.APIType = openaiapi.APITypeOpenAI
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeAzure)) {
		clientConfig.APIType = openaiapi.APITypeAzure
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeAzureAD)) {
		clientConfig.APIType = openaiapi.APITypeAzureAD
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openaiapi.APITypeCloudflareAzure)) {
		clientConfig.APIType = openaiapi.APITypeCloudflareAzure
		clientConfig.APIVersion = DefaultAzureAPIVersion
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
		rtn = append(rtn, msg)
	}
	return rtn
}

func (OpenAIBackend) StreamCompletion(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType])
	go func() {
		defer func() {
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

		// Configure proxy if specified
		if request.Opts.ProxyURL != "" {
			proxyURL, err := url.Parse(request.Opts.ProxyURL)
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("invalid proxy URL: %v", err))
				return
			}
			transport := &http.Transport{
				Proxy: http.ProxyURL(proxyURL),
			}
			clientConfig.HTTPClient = &http.Client{
				Transport: transport,
			}
		}

		client := openaiapi.NewClientWithConfig(clientConfig)
		req := openaiapi.ChatCompletionRequest{
			Model:    request.Opts.Model,
			Messages: convertPrompt(request.Prompt),
		}

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
