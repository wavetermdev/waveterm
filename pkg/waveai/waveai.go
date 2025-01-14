// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const WaveAIPacketstr = "waveai"
const ApiType_Anthropic = "anthropic"
const ApiType_Perplexity = "perplexity"
const APIType_Google = "google"
const APIType_OpenAI = "openai"

type WaveAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

func MakeWaveAIPacket() *wshrpc.WaveAIPacketType {
	return &wshrpc.WaveAIPacketType{Type: WaveAIPacketstr}
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

	endpoint := request.Opts.BaseURL
	if endpoint == "" {
		endpoint = "default"
	}
	var backend AIBackend
	if request.Opts.APIType == ApiType_Anthropic {
		backend = AnthropicBackend{}
	} else if request.Opts.APIType == ApiType_Perplexity {
		backend = PerplexityBackend{}
	} else if request.Opts.APIType == APIType_Google {
		backend = GoogleBackend{}
	} else if IsCloudAIRequest(request.Opts) {
		endpoint = "waveterm cloud"
		request.Opts.APIType = APIType_OpenAI
		request.Opts.Model = "default"
		backend = WaveAICloudBackend{}
	} else {
		request.Opts.APIType = APIType_OpenAI
		backend = OpenAIBackend{}
	}
	if backend == nil {
		log.Printf("no backend found for %s\n", request.Opts.APIType)
		return nil
	}

	log.Printf("sending ai chat message to %s endpoint %q using model %s\n", request.Opts.APIType, endpoint, request.Opts.Model)
	return backend.StreamCompletion(ctx, request)
}
