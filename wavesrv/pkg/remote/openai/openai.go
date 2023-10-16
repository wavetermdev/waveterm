package openai

import (
	"context"
	"fmt"
	"io"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/commandlinedev/apishell/pkg/packet"
	"github.com/commandlinedev/prompt-server/pkg/sstore"
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

func convertPrompt(prompt []sstore.OpenAIPromptMessageType) []openaiapi.ChatCompletionMessage {
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
	client := openaiapi.NewClient(opts.APIToken)
	req := openaiapi.ChatCompletionRequest{
		Model:     opts.Model,
		Messages:  convertPrompt(prompt),
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
	client := openaiapi.NewClient(opts.APIToken)
	req := openaiapi.ChatCompletionRequest{
		Model:     opts.Model,
		Messages:  convertPrompt(prompt),
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
