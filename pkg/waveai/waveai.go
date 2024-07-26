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
	"time"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"

	"github.com/gorilla/websocket"
)

const OpenAIPacketStr = "openai"
const OpenAICloudReqStr = "openai-cloudreq"
const PacketEOFStr = "EOF"

type OpenAIUsageType struct {
	PromptTokens     int `json:"prompt_tokens,omitempty"`
	CompletionTokens int `json:"completion_tokens,omitempty"`
	TotalTokens      int `json:"total_tokens,omitempty"`
}

type OpenAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

type OpenAIPacketType struct {
	Type         string           `json:"type"`
	Model        string           `json:"model,omitempty"`
	Created      int64            `json:"created,omitempty"`
	FinishReason string           `json:"finish_reason,omitempty"`
	Usage        *OpenAIUsageType `json:"usage,omitempty"`
	Index        int              `json:"index,omitempty"`
	Text         string           `json:"text,omitempty"`
	Error        string           `json:"error,omitempty"`
}

func MakeOpenAIPacket() *OpenAIPacketType {
	return &OpenAIPacketType{Type: OpenAIPacketStr}
}

type OpenAICmdInfoChatMessage struct {
	MessageID           int                            `json:"messageid"`
	IsAssistantResponse bool                           `json:"isassistantresponse,omitempty"`
	AssistantResponse   *OpenAICmdInfoPacketOutputType `json:"assistantresponse,omitempty"`
	UserQuery           string                         `json:"userquery,omitempty"`
	UserEngineeredQuery string                         `json:"userengineeredquery,omitempty"`
}

type OpenAIPromptMessageType struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type OpenAICloudReqPacketType struct {
	Type       string                    `json:"type"`
	ClientId   string                    `json:"clientid"`
	Prompt     []OpenAIPromptMessageType `json:"prompt"`
	MaxTokens  int                       `json:"maxtokens,omitempty"`
	MaxChoices int                       `json:"maxchoices,omitempty"`
}

type OpenAIOptsType struct {
	Model      string `json:"model"`
	APIToken   string `json:"apitoken"`
	BaseURL    string `json:"baseurl,omitempty"`
	MaxTokens  int    `json:"maxtokens,omitempty"`
	MaxChoices int    `json:"maxchoices,omitempty"`
	Timeout    int    `json:"timeout,omitempty"`
}

func MakeOpenAICloudReqPacket() *OpenAICloudReqPacketType {
	return &OpenAICloudReqPacketType{
		Type: OpenAICloudReqStr,
	}
}

type OpenAiStreamRequest struct {
	ClientId string                    `json:"clientid,omitempty"`
	Opts     *OpenAIOptsType           `json:"opts"`
	Prompt   []OpenAIPromptMessageType `json:"prompt"`
}

func GetWSEndpoint() string {
	return PCloudWSEndpoint
	if !wavebase.IsDevMode() {
		return PCloudWSEndpoint
	} else {
		endpoint := os.Getenv(PCloudWSEndpointVarName)
		if endpoint == "" {
			panic("Invalid PCloud ws dev endpoint, PCLOUD_WS_ENDPOINT not set or invalid")
		}
		return endpoint
	}
}

const DefaultMaxTokens = 1000
const DefaultModel = "gpt-3.5-turbo"
const DefaultStreamChanSize = 10
const PCloudWSEndpoint = "wss://wsapi.waveterm.dev/"
const PCloudWSEndpointVarName = "PCLOUD_WS_ENDPOINT"

const CloudWebsocketConnectTimeout = 1 * time.Minute

func convertUsage(resp openaiapi.ChatCompletionResponse) *OpenAIUsageType {
	if resp.Usage.TotalTokens == 0 {
		return nil
	}
	return &OpenAIUsageType{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}

func ConvertPrompt(prompt []OpenAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	for _, p := range prompt {
		msg := openaiapi.ChatCompletionMessage{Role: p.Role, Content: p.Content, Name: p.Name}
		rtn = append(rtn, msg)
	}
	return rtn
}

func RunCloudCompletionStream(ctx context.Context, request OpenAiStreamRequest) chan wshrpc.RespOrErrorUnion[OpenAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[OpenAIPacketType])
	go func() {
		log.Printf("start: %v", request)
		defer close(rtn)
		if request.Opts == nil {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("no openai opts found")}
			return
		}
		websocketContext, dialCancelFn := context.WithTimeout(context.Background(), CloudWebsocketConnectTimeout)
		defer dialCancelFn()
		conn, _, err := websocket.DefaultDialer.DialContext(websocketContext, GetWSEndpoint(), nil)
		defer func() {
			err = conn.Close()
			if err != nil {
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("unable to close openai channel: %v", err)}
			}
		}()
		if err == context.DeadlineExceeded {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, timed out connecting to cloud server: %v", err)}
			return
		} else if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, websocket connect error: %v", err)}
			return
		}
		reqPk := MakeOpenAICloudReqPacket()
		reqPk.ClientId = request.ClientId
		reqPk.Prompt = request.Prompt
		reqPk.MaxTokens = request.Opts.MaxTokens
		reqPk.MaxChoices = request.Opts.MaxChoices
		configMessageBuf, err := json.Marshal(reqPk)
		if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, packet marshal error: %v", err)}
			return
		}
		err = conn.WriteMessage(websocket.TextMessage, configMessageBuf)
		if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, websocket write config error: %v", err)}
			return
		}
		for {
			log.Printf("loop")
			_, socketMessage, err := conn.ReadMessage()
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("err received: %v", err)
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, websocket error reading message: %v", err)}
				break
			}
			var streamResp *OpenAIPacketType
			err = json.Unmarshal(socketMessage, &streamResp)
			log.Printf("ai resp: %v", streamResp)
			if err != nil {
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, websocket response json decode error: %v", err)}
				break
			}
			if streamResp.Error == PacketEOFStr {
				// got eof packet from socket
				break
			} else if streamResp.Error != "" {
				// use error from server directly
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("%v", streamResp.Error)}
				break
			}
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Response: *streamResp}
		}
	}()
	return rtn
}

func RunLocalCompletionStream(ctx context.Context, request OpenAiStreamRequest) chan wshrpc.RespOrErrorUnion[OpenAIPacketType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[OpenAIPacketType])
	go func() {
		log.Printf("start2: %v", request)
		defer close(rtn)
		if request.Opts == nil {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("no openai opts found")}
			return
		}
		if request.Opts.Model == "" {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("no openai model specified")}
			return
		}
		if request.Opts.BaseURL == "" && request.Opts.APIToken == "" {
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("no api token")}
			return
		}
		clientConfig := openaiapi.DefaultConfig(request.Opts.APIToken)
		if request.Opts.BaseURL != "" {
			clientConfig.BaseURL = request.Opts.BaseURL
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
			rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("error calling openai API: %v", err)}
			return
		}
		sentHeader := false
		for {
			log.Printf("loop2")
			streamResp, err := apiResp.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("err received2: %v", err)
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Error: fmt.Errorf("OpenAI request, websocket error reading message: %v", err)}
				break
			}
			if streamResp.Model != "" && !sentHeader {
				pk := MakeOpenAIPacket()
				pk.Model = streamResp.Model
				pk.Created = streamResp.Created
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Response: *pk}
				sentHeader = true
			}
			for _, choice := range streamResp.Choices {
				pk := MakeOpenAIPacket()
				pk.Index = choice.Index
				pk.Text = choice.Delta.Content
				pk.FinishReason = string(choice.FinishReason)
				rtn <- wshrpc.RespOrErrorUnion[OpenAIPacketType]{Response: *pk}
			}
		}
	}()
	return rtn
}

func marshalResponse(resp openaiapi.ChatCompletionResponse) []*OpenAIPacketType {
	var rtn []*OpenAIPacketType
	headerPk := MakeOpenAIPacket()
	headerPk.Model = resp.Model
	headerPk.Created = resp.Created
	headerPk.Usage = convertUsage(resp)
	rtn = append(rtn, headerPk)
	for _, choice := range resp.Choices {
		choicePk := MakeOpenAIPacket()
		choicePk.Index = choice.Index
		choicePk.Text = choice.Message.Content
		choicePk.FinishReason = string(choice.FinishReason)
		rtn = append(rtn, choicePk)
	}
	return rtn
}

func CreateErrorPacket(errStr string) *OpenAIPacketType {
	errPk := MakeOpenAIPacket()
	errPk.FinishReason = "error"
	errPk.Error = errStr
	return errPk
}

func CreateTextPacket(text string) *OpenAIPacketType {
	pk := MakeOpenAIPacket()
	pk.Text = text
	return pk
}