// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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
	return &wshrpc.WaveAIPacketType{Type: WaveAIPacketstr, RunInAutonomousMode: false}
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
	var backendType string
	if request.Opts.APIType == ApiType_Anthropic {
		backend = AnthropicBackend{}
		backendType = ApiType_Anthropic
	} else if request.Opts.APIType == ApiType_Perplexity {
		backend = PerplexityBackend{}
		backendType = ApiType_Perplexity
	} else if request.Opts.APIType == APIType_Google {
		backend = GoogleBackend{}
		backendType = APIType_Google
	} else if IsCloudAIRequest(request.Opts) {
		endpoint = "waveterm cloud"
		request.Opts.APIType = APIType_OpenAI
		request.Opts.Model = "default"
		backend = WaveAICloudBackend{}
		backendType = "wave"
	} else {
		backend = OpenAIBackend{}
		backendType = APIType_OpenAI
	}
	if backend == nil {
		log.Printf("no backend found for %s\n", request.Opts.APIType)
		return nil
	}
	telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
		Event: "action:runaicmd",
		Props: telemetrydata.TEventProps{
			AiBackendType: backendType,
		},
	})

	log.Printf("sending ai chat message to %s endpoint %q using model %s\n", request.Opts.APIType, endpoint, request.Opts.Model)
	return backend.StreamCompletion(ctx, request)
}

// ReadFileForAIAttachment reads a file for AI context attachment with size limits
func ReadFileForAIAttachment(filePath string) (wshrpc.FileAttachment, error) {
	attachment := wshrpc.FileAttachment{
		FilePath: filePath,
		FileName: filepath.Base(filePath),
	}

	// Expand home directory if needed
	expandedPath, err := wavebase.ExpandHomeDir(filePath)
	if err != nil {
		return attachment, err
	}

	// Check if file exists and get info
	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return attachment, err
	}

	// Don't allow very large files (limit to 100KB)
	const maxFileSize = 100 * 1024
	if fileInfo.Size() > maxFileSize {
		return attachment, fmt.Errorf("file too large for attachment: %s (%d bytes, max %d bytes)",
			filePath, fileInfo.Size(), maxFileSize)
	}

	// Don't allow directories
	if fileInfo.IsDir() {
		return attachment, fmt.Errorf("directories cannot be attached: %s", filePath)
	}

	// Read file content
	content, err := ioutil.ReadFile(expandedPath)
	if err != nil {
		return attachment, err
	}

	attachment.FileContent = string(content)
	return attachment, nil
}
