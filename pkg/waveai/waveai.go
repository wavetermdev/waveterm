// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wcloud"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"

	"github.com/gorilla/websocket"
)

const OpenAIPacketStr = "openai"
const OpenAICloudReqStr = "openai-cloudreq"
const PacketEOFStr = "EOF"
const DefaultAzureAPIVersion = "2023-05-15"

type OpenAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

func MakeOpenAIPacket() *wshrpc.OpenAIPacketType {
	return &wshrpc.OpenAIPacketType{Type: OpenAIPacketStr}
}

type OpenAICmdInfoChatMessage struct {
	MessageID           int                            `json:"messageid"`
	IsAssistantResponse bool                           `json:"isassistantresponse,omitempty"`
	AssistantResponse   *OpenAICmdInfoPacketOutputType `json:"assistantresponse,omitempty"`
	UserQuery           string                         `json:"userquery,omitempty"`
	UserEngineeredQuery string                         `json:"userengineeredquery,omitempty"`
}

type OpenAICloudReqPacketType struct {
	Type       string                           `json:"type"`
	ClientId   string                           `json:"clientid"`
	Prompt     []wshrpc.OpenAIPromptMessageType `json:"prompt"`
	MaxTokens  int                              `json:"maxtokens,omitempty"`
	MaxChoices int                              `json:"maxchoices,omitempty"`
}

func MakeOpenAICloudReqPacket() *OpenAICloudReqPacketType {
	return &OpenAICloudReqPacketType{
		Type: OpenAICloudReqStr,
	}
}

func GetWSEndpoint() string {
	if !wavebase.IsDevMode() {
		return WCloudWSEndpoint
	} else {
		endpoint := os.Getenv(WCloudWSEndpointVarName)
		if endpoint == "" {
			panic("Invalid WCloud websocket dev endpoint, WCLOUD_WS_ENDPOINT not set or invalid")
		}
		return endpoint
	}
}

const DefaultMaxTokens = 2048
const DefaultModel = "gpt-4o-mini"
const WCloudWSEndpoint = "wss://wsapi.waveterm.dev/"
const WCloudWSEndpointVarName = "WCLOUD_WS_ENDPOINT"

const CloudWebsocketConnectTimeout = 1 * time.Minute

func IsCloudAIRequest(opts *wshrpc.OpenAIOptsType) bool {
	if opts == nil {
		return true
	}
	return opts.BaseURL == "" && opts.APIToken == ""
}

func convertUsage(resp openaiapi.ChatCompletionResponse) *wshrpc.OpenAIUsageType {
	if resp.Usage.TotalTokens == 0 {
		return nil
	}
	return &wshrpc.OpenAIUsageType{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}

func ConvertPrompt(prompt []wshrpc.OpenAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	for _, p := range prompt {
		msg := openaiapi.ChatCompletionMessage{Role: p.Role, Content: p.Content, Name: p.Name}
		rtn = append(rtn, msg)
	}
	return rtn
}

func makeAIError(err error) wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType] {
	return wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: err}
}

func RunAICommand(ctx context.Context, request wshrpc.OpenAiStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType] {
	if IsCloudAIRequest(request.Opts) {
		log.Print("sending ai chat message to default waveterm cloud endpoint\n")
		return RunCloudCompletionStream(ctx, request)
	}
	log.Printf("sending ai chat message to user-configured endpoint %s\n", request.Opts.BaseURL)
	return RunLocalCompletionStream(ctx, request)
}

func RunCloudCompletionStream(ctx context.Context, request wshrpc.OpenAiStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType])
	wsEndpoint := wcloud.GetWSEndpoint()
	go func() {
		defer close(rtn)
		if wsEndpoint == "" {
			rtn <- makeAIError(fmt.Errorf("no cloud ws endpoint found"))
			return
		}
		if request.Opts == nil {
			rtn <- makeAIError(fmt.Errorf("no openai opts found"))
			return
		}
		websocketContext, dialCancelFn := context.WithTimeout(context.Background(), CloudWebsocketConnectTimeout)
		defer dialCancelFn()
		conn, _, err := websocket.DefaultDialer.DialContext(websocketContext, wsEndpoint, nil)
		if err == context.DeadlineExceeded {
			rtn <- makeAIError(fmt.Errorf("OpenAI request, timed out connecting to cloud server: %v", err))
			return
		} else if err != nil {
			rtn <- makeAIError(fmt.Errorf("OpenAI request, websocket connect error: %v", err))
			return
		}
		defer func() {
			err = conn.Close()
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("unable to close openai channel: %v", err))
			}
		}()
		reqPk := MakeOpenAICloudReqPacket()
		reqPk.ClientId = request.ClientId
		reqPk.Prompt = request.Prompt
		reqPk.MaxTokens = request.Opts.MaxTokens
		reqPk.MaxChoices = request.Opts.MaxChoices
		configMessageBuf, err := json.Marshal(reqPk)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("OpenAI request, packet marshal error: %v", err))
			return
		}
		err = conn.WriteMessage(websocket.TextMessage, configMessageBuf)
		if err != nil {
			rtn <- makeAIError(fmt.Errorf("OpenAI request, websocket write config error: %v", err))
			return
		}
		for {
			_, socketMessage, err := conn.ReadMessage()
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("err received: %v", err)
				rtn <- makeAIError(fmt.Errorf("OpenAI request, websocket error reading message: %v", err))
				break
			}
			var streamResp *wshrpc.OpenAIPacketType
			err = json.Unmarshal(socketMessage, &streamResp)
			if err != nil {
				rtn <- makeAIError(fmt.Errorf("OpenAI request, websocket response json decode error: %v", err))
				break
			}
			if streamResp.Error == PacketEOFStr {
				// got eof packet from socket
				break
			} else if streamResp.Error != "" {
				// use error from server directly
				rtn <- makeAIError(fmt.Errorf("%v", streamResp.Error))
				break
			}
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Response: *streamResp}
		}
	}()
	return rtn
}

// copied from go-openai/config.go
func defaultAzureMapperFn(model string) string {
	return regexp.MustCompile(`[.:]`).ReplaceAllString(model, "")
}

func setApiType(opts *wshrpc.OpenAIOptsType, clientConfig *openai.ClientConfig) error {
	ourApiType := strings.ToLower(opts.APIType)
	if ourApiType == "" || ourApiType == strings.ToLower(string(openai.APITypeOpenAI)) {
		clientConfig.APIType = openai.APITypeOpenAI
		return nil
	} else if ourApiType == strings.ToLower(string(openai.APITypeAzure)) {
		clientConfig.APIType = openai.APITypeAzure
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openai.APITypeAzureAD)) {
		clientConfig.APIType = openai.APITypeAzureAD
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else if ourApiType == strings.ToLower(string(openai.APITypeCloudflareAzure)) {
		clientConfig.APIType = openai.APITypeCloudflareAzure
		clientConfig.APIVersion = DefaultAzureAPIVersion
		clientConfig.AzureModelMapperFunc = defaultAzureMapperFn
		return nil
	} else {
		return fmt.Errorf("invalid api type %q", opts.APIType)
	}
}

func RunLocalCompletionStream(ctx context.Context, request wshrpc.OpenAiStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType])
	go func() {
		defer close(rtn)
		if request.Opts == nil {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: fmt.Errorf("no openai opts found")}
			return
		}
		if request.Opts.Model == "" {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: fmt.Errorf("no openai model specified")}
			return
		}
		if request.Opts.BaseURL == "" && request.Opts.APIToken == "" {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: fmt.Errorf("no api token")}
			return
		}
		clientConfig := openaiapi.DefaultConfig(request.Opts.APIToken)
		if request.Opts.BaseURL != "" {
			clientConfig.BaseURL = request.Opts.BaseURL
		}
		err := setApiType(request.Opts, &clientConfig)
		if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: err}
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
			Model:     request.Opts.Model,
			Messages:  ConvertPrompt(request.Prompt),
			MaxTokens: request.Opts.MaxTokens,
			Stream:    true,
		}
		if request.Opts.MaxChoices > 1 {
			req.N = request.Opts.MaxChoices
		}
		apiResp, err := client.CreateChatCompletionStream(ctx, req)
		if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: fmt.Errorf("error calling openai API: %v", err)}
			return
		}
		sentHeader := false
		for {
			streamResp, err := apiResp.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("err received2: %v", err)
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, websocket error reading message: %v", err)}
				break
			}
			if streamResp.Model != "" && !sentHeader {
				pk := MakeOpenAIPacket()
				pk.Model = streamResp.Model
				pk.Created = streamResp.Created
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Response: *pk}
				sentHeader = true
			}
			for _, choice := range streamResp.Choices {
				pk := MakeOpenAIPacket()
				pk.Index = choice.Index
				pk.Text = choice.Delta.Content
				pk.FinishReason = string(choice.FinishReason)
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType]{Response: *pk}
			}
		}
	}()
	return rtn
}
