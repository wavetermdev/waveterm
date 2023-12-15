// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/gorilla/websocket"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

// https://github.com/tiktoken-go/tokenizer

const DefaultMaxTokens = 1000
const DefaultModel = "gpt-3.5-turbo"
const DefaultStreamChanSize = 10

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

func ConvertPrompt(prompt []sstore.OpenAIPromptMessageType) []openaiapi.ChatCompletionMessage {
	var rtn []openaiapi.ChatCompletionMessage
	for _, p := range prompt {
		msg := openaiapi.ChatCompletionMessage{Role: p.Role, Content: p.Content, Name: p.Name}
		rtn = append(rtn, msg)
	}
	return rtn
}

func RunCompletion(ctx context.Context, opts *sstore.OpenAIOptsType, prompt []sstore.OpenAIPromptMessageType) ([]*packet.OpenAIPacketType, error) {
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

func RunCloudCompletion(ctx context.Context, opts *sstore.OpenAIOptsType, prompt []sstore.OpenAIPromptMessageType) ([]*packet.OpenAIPacketType, error) {
	if opts == nil {
		return nil, fmt.Errorf("no openai opts found")
	}
	if opts.Model == "" {
		return nil, fmt.Errorf("no openai model specified")
	}
	cloudCompletionRequestConfig := sstore.OpenAICloudCompletionRequest{
		Model:      opts.Model,
		Prompt:     prompt,
		MaxTokens:  opts.MaxTokens,
		MaxChoices: opts.MaxChoices,
	}
	const cloudTestAddr = "http://127.0.0.1:7999/api/chat-completion"
	payloadBuf := new(bytes.Buffer)
	json.NewEncoder(payloadBuf).Encode(cloudCompletionRequestConfig)
	httpreq, err := http.NewRequest("POST", cloudTestAddr, payloadBuf)
	if err != nil {
		return nil, fmt.Errorf("request create err: %v", err)
	}
	httpresp, err := http.DefaultClient.Do(httpreq)
	if err != nil {
		return nil, fmt.Errorf("request err: %v", err)
	}
	defer httpresp.Body.Close()
	body, err := io.ReadAll(httpresp.Body)
	var apiResp openaiapi.ChatCompletionResponse
	type jsonResponse struct {
		Data openaiapi.ChatCompletionResponse
	}
	var httpjsonresp jsonResponse
	err = json.Unmarshal(body, &httpjsonresp)
	if err != nil {
		return nil, fmt.Errorf("error decoding json output %v", err)
	}
	apiResp = httpjsonresp.Data
	return marshalResponse(apiResp), nil
}

func RunCloudCompletionStream(ctx context.Context, opts *sstore.OpenAIOptsType, prompt []sstore.OpenAIPromptMessageType) (chan *packet.OpenAIPacketType, error) {
	const AWSLambdaCentralWSAddr = "wss://5lfzlg5crl.execute-api.us-west-2.amazonaws.com/dev/"
	if opts == nil {
		return nil, fmt.Errorf("no openai opts found")
	}
	if opts.Model == "" {
		return nil, fmt.Errorf("no openai model specified")
	}
	conn, _, err := websocket.DefaultDialer.Dial(AWSLambdaCentralWSAddr, nil)
	if err != nil {
		log.Printf("Websocket error: %v", err)
		return nil, fmt.Errorf("Websocket error: %v", err)
	}
	cloudCompletionRequestConfig := sstore.OpenAICloudCompletionRequest{
		Model:      opts.Model,
		Prompt:     prompt,
		MaxTokens:  opts.MaxTokens,
		MaxChoices: opts.MaxChoices,
	}
	configMessageBuf := new(bytes.Buffer)
	json.NewEncoder(configMessageBuf).Encode(cloudCompletionRequestConfig)
	err = conn.WriteMessage(websocket.TextMessage, configMessageBuf.Bytes())
	if err != nil {
		return nil, fmt.Errorf("Websocker write config error: %v", err)
	}
	rtn := make(chan *packet.OpenAIPacketType, DefaultStreamChanSize)
	go func() {
		defer close(rtn)
		for {
			_, socketMessage, err := conn.ReadMessage()
			if err == io.EOF {
				break
			}
			if err != nil {
				errPk := CreateErrorPacket(fmt.Sprintf("Websocket error: %v", err))
				rtn <- errPk
				break
			}
			decoder := json.NewDecoder(bytes.NewReader(socketMessage))
			var streamResp *packet.OpenAIPacketType
			err = decoder.Decode(&streamResp)
			if err != nil {
				errPk := CreateErrorPacket(fmt.Sprintf("Websocket response json decode error: %v", err))
				rtn <- errPk
			}
			rtn <- streamResp
		}
	}()
	return rtn, err
}

func RunCompletionStream(ctx context.Context, opts *sstore.OpenAIOptsType, prompt []sstore.OpenAIPromptMessageType) (chan *packet.OpenAIPacketType, error) {
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
