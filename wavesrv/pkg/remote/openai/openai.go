// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/gorilla/websocket"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/pcloud"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

// https://github.com/tiktoken-go/tokenizer

const DefaultMaxTokens = 1000
const DefaultModel = "gpt-3.5-turbo"
const DefaultStreamChanSize = 10

const CloudWebsocketConnectTimeout = 1 * time.Minute

func convertUsage(resp openaiapi.ChatCompletionResponse) *packet.OpenAIUsageType {
	if resp.Usage.TotalTokens == 0 {
		return nil
	}
	return &packet.OpenAIUsageType{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}

func ConvertPrompt(prompt []packet.OpenAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	for _, p := range prompt {
		msg := openaiapi.ChatCompletionMessage{Role: p.Role, Content: p.Content, Name: p.Name}
		rtn = append(rtn, msg)
	}
	return rtn
}

func RunCompletion(ctx context.Context, opts *sstore.OpenAIOptsType, prompt []packet.OpenAIPromptMessageType) ([]*packet.OpenAIPacketType, error) {
	if opts == nil {
		return nil, fmt.Errorf("no openai opts found")
	}
	if opts.Model == "" {
		return nil, fmt.Errorf("no openai model specified")
	}
	if opts.APIToken == "" {
		return nil, fmt.Errorf("no api token")
	}
	clientConfig := openaiapi.DefaultConfig(opts.APIToken)
	if opts.BaseURL != "" {
		clientConfig.BaseURL = opts.BaseURL
	}
	client := openaiapi.NewClientWithConfig(clientConfig)
	req := openaiapi.ChatCompletionRequest{
		Model:     opts.Model,
		Messages:  ConvertPrompt(prompt),
		MaxTokens: opts.MaxTokens,
	}
	if opts.MaxChoices > 1 {
		req.N = opts.MaxChoices
	}
	apiResp, err := client.CreateChatCompletion(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("error calling openai API: %v", err)
	}
	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("no response received")
	}
	return marshalResponse(apiResp), nil
}

func RunCloudCompletionStream(ctx context.Context, clientId string, opts *sstore.OpenAIOptsType, prompt []packet.OpenAIPromptMessageType) (chan *packet.OpenAIPacketType, *websocket.Conn, error) {
	if opts == nil {
		return nil, nil, fmt.Errorf("no openai opts found")
	}
	websocketContext, dialCancelFn := context.WithTimeout(context.Background(), CloudWebsocketConnectTimeout)
	defer dialCancelFn()
	conn, _, err := websocket.DefaultDialer.DialContext(websocketContext, pcloud.GetWSEndpoint(), nil)
	if err == context.DeadlineExceeded {
		return nil, nil, fmt.Errorf("OpenAI request, timed out connected to cloud server: %v", err)
	} else if err != nil {
		return nil, nil, fmt.Errorf("OpenAI request, websocket connect error: %v", err)
	}
	reqPk := packet.MakeOpenAICloudReqPacket()
	reqPk.ClientId = clientId
	reqPk.Prompt = prompt
	reqPk.MaxTokens = opts.MaxTokens
	reqPk.MaxChoices = opts.MaxChoices
	configMessageBuf, err := json.Marshal(reqPk)
	err = conn.WriteMessage(websocket.TextMessage, configMessageBuf)
	if err != nil {
		return nil, nil, fmt.Errorf("OpenAI request, websocket write config error: %v", err)
	}
	rtn := make(chan *packet.OpenAIPacketType, DefaultStreamChanSize)
	go func() {
		defer close(rtn)
		defer conn.Close()
		for {
			_, socketMessage, err := conn.ReadMessage()
			if err == io.EOF {
				break
			}
			if err != nil {
				errPk := CreateErrorPacket(fmt.Sprintf("OpenAI request, websocket error reading message: %v", err))
				rtn <- errPk
				break
			}
			var streamResp *packet.OpenAIPacketType
			err = json.Unmarshal(socketMessage, &streamResp)
			if err != nil {
				errPk := CreateErrorPacket(fmt.Sprintf("OpenAI request, websocket response json decode error: %v", err))
				rtn <- errPk
				break
			}
			if streamResp.Error == packet.PacketEOFStr {
				// got eof packet from socket
				break
			} else if streamResp.Error != "" {
				// use error from server directly
				errPk := CreateErrorPacket(streamResp.Error)
				rtn <- errPk
				break
			}
			rtn <- streamResp
		}
	}()
	return rtn, conn, err
}

func RunCompletionStream(ctx context.Context, opts *sstore.OpenAIOptsType, prompt []packet.OpenAIPromptMessageType) (chan *packet.OpenAIPacketType, error) {
	if opts == nil {
		return nil, fmt.Errorf("no openai opts found")
	}
	if opts.Model == "" {
		return nil, fmt.Errorf("no openai model specified")
	}
	if opts.APIToken == "" {
		return nil, fmt.Errorf("no api token")
	}
	clientConfig := openaiapi.DefaultConfig(opts.APIToken)
	if opts.BaseURL != "" {
		clientConfig.BaseURL = opts.BaseURL
	}
	client := openaiapi.NewClientWithConfig(clientConfig)
	req := openaiapi.ChatCompletionRequest{
		Model:     opts.Model,
		Messages:  ConvertPrompt(prompt),
		MaxTokens: opts.MaxTokens,
		Stream:    true,
	}
	if opts.MaxChoices > 1 {
		req.N = opts.MaxChoices
	}
	apiResp, err := client.CreateChatCompletionStream(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("error calling openai API: %v", err)
	}
	rtn := make(chan *packet.OpenAIPacketType, DefaultStreamChanSize)
	go func() {
		sentHeader := false
		defer close(rtn)
		for {
			streamResp, err := apiResp.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				errPk := CreateErrorPacket(fmt.Sprintf("error in recv of streaming data: %v", err))
				rtn <- errPk
				break
			}
			if streamResp.Model != "" && !sentHeader {
				pk := packet.MakeOpenAIPacket()
				pk.Model = streamResp.Model
				pk.Created = streamResp.Created
				rtn <- pk
				sentHeader = true
			}
			for _, choice := range streamResp.Choices {
				pk := packet.MakeOpenAIPacket()
				pk.Index = choice.Index
				pk.Text = choice.Delta.Content
				pk.FinishReason = choice.FinishReason
				rtn <- pk
			}
		}
	}()
	return rtn, err
}

func marshalResponse(resp openaiapi.ChatCompletionResponse) []*packet.OpenAIPacketType {
	var rtn []*packet.OpenAIPacketType
	headerPk := packet.MakeOpenAIPacket()
	headerPk.Model = resp.Model
	headerPk.Created = resp.Created
	headerPk.Usage = convertUsage(resp)
	rtn = append(rtn, headerPk)
	for _, choice := range resp.Choices {
		choicePk := packet.MakeOpenAIPacket()
		choicePk.Index = choice.Index
		choicePk.Text = choice.Message.Content
		choicePk.FinishReason = choice.FinishReason
		rtn = append(rtn, choicePk)
	}
	return rtn
}

func CreateErrorPacket(errStr string) *packet.OpenAIPacketType {
	errPk := packet.MakeOpenAIPacket()
	errPk.FinishReason = "error"
	errPk.Error = errStr
	return errPk
}

func CreateTextPacket(text string) *packet.OpenAIPacketType {
	pk := packet.MakeOpenAIPacket()
	pk.Text = text
	return pk
}
