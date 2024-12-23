// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const OpenAIPacketStr = "openai"
const OpenAICloudReqStr = "openai-cloudreq"
const PacketEOFStr = "EOF"
const DefaultAzureAPIVersion = "2023-05-15"
const ApiType_Anthropic = "anthropic"
const ApiType_Perplexity = "perplexity"

type WaveAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

func MakeWaveAIPacket() *wshrpc.WaveAIPacketType {
	return &wshrpc.WaveAIPacketType{Type: OpenAIPacketStr}
}

type WaveAICmdInfoChatMessage struct {
	MessageID           int                            `json:"messageid"`
	IsAssistantResponse bool                           `json:"isassistantresponse,omitempty"`
	AssistantResponse   *WaveAICmdInfoPacketOutputType `json:"assistantresponse,omitempty"`
	UserQuery           string                         `json:"userquery,omitempty"`
	UserEngineeredQuery string                         `json:"userengineeredquery,omitempty"`
}

type AIBackend interface {
	StreamCompletion(
		ctx context.Context,
		request wshrpc.WaveAIStreamRequest,
	) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]
}

const DefaultMaxTokens = 2048
const DefaultModel = "gpt-4o-mini"
const WCloudWSEndpoint = "wss://wsapi.waveterm.dev/"
const WCloudWSEndpointVarName = "WCLOUD_WS_ENDPOINT"

const CloudWebsocketConnectTimeout = 1 * time.Minute

func IsCloudAIRequest(opts *wshrpc.WaveAIOptsType) bool {
	if opts == nil {
		return true
	}
	return opts.BaseURL == "" && opts.APIToken == ""
}

func makeAIError(err error) wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	return wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]{Error: err}
}

func RunAICommand(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{NumAIReqs: 1}, "RunAICommand")
	if request.Opts.APIType == ApiType_Anthropic {
		endpoint := request.Opts.BaseURL
		if endpoint == "" {
			endpoint = "default"
		}
		log.Printf("sending ai chat message to anthropic endpoint %q using model %s\n", endpoint, request.Opts.Model)
		anthropicBackend := AnthropicBackend{}
		return anthropicBackend.StreamCompletion(ctx, request)
	}
	if request.Opts.APIType == ApiType_Perplexity {
		endpoint := request.Opts.BaseURL
		if endpoint == "" {
			endpoint = "default"
		}
		log.Printf("sending ai chat message to perplexity endpoint %q using model %s\n", endpoint, request.Opts.Model)
		perplexityBackend := PerplexityBackend{}
		return perplexityBackend.StreamCompletion(ctx, request)
	}
	if IsCloudAIRequest(request.Opts) {
		log.Print("sending ai chat message to default waveterm cloud endpoint\n")
		cloudBackend := WaveAICloudBackend{}
		return cloudBackend.StreamCompletion(ctx, request)
	} else {
		log.Printf("sending ai chat message to user-configured endpoint %s using model %s\n", request.Opts.BaseURL, request.Opts.Model)
		openAIBackend := OpenAIBackend{}
		return openAIBackend.StreamCompletion(ctx, request)
	}
}
