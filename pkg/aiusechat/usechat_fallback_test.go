// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const fallbackReplyText = "fallback ok"

type premiumFallbackStub struct {
	lock     sync.Mutex
	requests []map[string]any
}

func (s *premiumFallbackStub) getRequests() []map[string]any {
	s.lock.Lock()
	defer s.lock.Unlock()
	return append([]map[string]any(nil), s.requests...)
}

func (s *premiumFallbackStub) recordRequest(r *http.Request) int {
	body, _ := io.ReadAll(r.Body)
	var parsed map[string]any
	_ = json.Unmarshal(body, &parsed)
	s.lock.Lock()
	defer s.lock.Unlock()
	s.requests = append(s.requests, parsed)
	return len(s.requests)
}

func (s *premiumFallbackStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	reqNum := s.recordRequest(r)
	if reqNum == 1 {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Wave-RateLimit", "req=10, reqlimit=200, preq=0, preqlimit=50, reset=4102444800")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"success":false,"error":"premium limit reached"}`)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	_, _ = io.WriteString(w, makeFallbackStream(uctypes.DefaultOpenAIModel))
}

func makeFallbackStream(model string) string {
	events := []struct{ name, data string }{
		{"response.created", fmt.Sprintf(`{"type":"response.created","sequence_number":0,"response":{"id":"resp_stub","object":"response","status":"in_progress","model":%q,"output":[]}}`, model)},
		{"response.in_progress", fmt.Sprintf(`{"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_stub","object":"response","status":"in_progress","model":%q,"output":[]}}`, model)},
		{"response.output_item.added", `{"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"msg_stub","type":"message","status":"in_progress","content":[],"role":"assistant"}}`},
		{"response.content_part.added", `{"type":"response.content_part.added","sequence_number":3,"item_id":"msg_stub","output_index":0,"content_index":0,"part":{"type":"output_text","annotations":[],"text":""}}`},
		{"response.output_text.delta", fmt.Sprintf(`{"type":"response.output_text.delta","sequence_number":4,"item_id":"msg_stub","output_index":0,"content_index":0,"delta":%q}`, fallbackReplyText)},
		{"response.output_text.done", fmt.Sprintf(`{"type":"response.output_text.done","sequence_number":5,"item_id":"msg_stub","output_index":0,"content_index":0,"text":%q}`, fallbackReplyText)},
		{"response.content_part.done", fmt.Sprintf(`{"type":"response.content_part.done","sequence_number":6,"item_id":"msg_stub","output_index":0,"content_index":0,"part":{"type":"output_text","annotations":[],"text":%q}}`, fallbackReplyText)},
		{"response.output_item.done", fmt.Sprintf(`{"type":"response.output_item.done","sequence_number":7,"output_index":0,"item":{"id":"msg_stub","type":"message","status":"completed","content":[{"type":"output_text","annotations":[],"text":%q}],"role":"assistant"}}`, fallbackReplyText)},
		{"response.completed", fmt.Sprintf(`{"type":"response.completed","sequence_number":8,"response":{"id":"resp_stub","object":"response","status":"completed","model":%q,"output":[{"id":"msg_stub","type":"message","status":"completed","content":[{"type":"output_text","annotations":[],"text":%q}],"role":"assistant"}],"usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}}}`, model, fallbackReplyText)},
	}
	var sb strings.Builder
	for _, ev := range events {
		fmt.Fprintf(&sb, "event: %s\ndata: %s\n\n", ev.name, ev.data)
	}
	return sb.String()
}

func getNestedString(m map[string]any, key string, subKey string) (string, bool) {
	sub, ok := m[key].(map[string]any)
	if !ok {
		return "", false
	}
	val, ok := sub[subKey].(string)
	return val, ok
}

func restoreGlobalRateLimit(t *testing.T) {
	prev := GetGlobalRateLimit()
	t.Cleanup(func() {
		rateLimitLock.Lock()
		defer rateLimitLock.Unlock()
		globalRateLimitInfo = prev
	})
}

func TestRunAIChatPremiumRateLimitFallback(t *testing.T) {
	restoreGlobalRateLimit(t)
	stub := &premiumFallbackStub{}
	server := httptest.NewServer(stub)
	defer server.Close()

	aiOpts := uctypes.AIOptsType{
		Provider:      uctypes.AIProvider_Wave,
		APIType:       uctypes.APIType_OpenAIResponses,
		Model:         uctypes.PremiumOpenAIModel,
		Endpoint:      server.URL,
		ThinkingLevel: uctypes.ThinkingLevelLow,
		Verbosity:     uctypes.VerbosityLevelLow,
		MaxTokens:     1234,
		WaveAIPremium: true,
	}
	backend, err := GetBackendByAPIType(aiOpts.APIType)
	if err != nil {
		t.Fatalf("GetBackendByAPIType failed: %v", err)
	}
	userMsg, err := backend.ConvertAIMessageToNativeChatMessage(uctypes.AIMessage{
		MessageId: uuid.New().String(),
		Parts:     []uctypes.AIMessagePart{{Type: uctypes.AIMessagePartTypeText, Text: "hello"}},
	})
	if err != nil {
		t.Fatalf("ConvertAIMessageToNativeChatMessage failed: %v", err)
	}
	chatId := uuid.New().String()
	defer chatstore.DefaultChatStore.Delete(chatId)
	if err := chatstore.DefaultChatStore.PostMessage(chatId, &aiOpts, userMsg); err != nil {
		t.Fatalf("PostMessage failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sseHandler := sse.MakeSSEHandlerCh(httptest.NewRecorder(), ctx)
	chatOpts := uctypes.WaveChatOpts{
		ChatId:   chatId,
		ClientId: "test-client",
		Config:   aiOpts,
	}
	metrics, err := RunAIChat(ctx, sseHandler, backend, chatOpts)
	if err != nil {
		t.Fatalf("RunAIChat failed: %v", err)
	}
	if metrics.HadError {
		t.Fatalf("RunAIChat reported an error during the premium rate limit fallback")
	}

	requests := stub.getRequests()
	if len(requests) != 2 {
		t.Fatalf("expected the premium request and one fallback request, got %d requests", len(requests))
	}
	if model := requests[0]["model"]; model != uctypes.PremiumOpenAIModel {
		t.Errorf("first request model = %v, want %q", model, uctypes.PremiumOpenAIModel)
	}
	if effort, _ := getNestedString(requests[0], "reasoning", "effort"); effort != uctypes.ThinkingLevelLow {
		t.Errorf("first request reasoning effort = %q, want %q", effort, uctypes.ThinkingLevelLow)
	}

	fallback := requests[1]
	if model := fallback["model"]; model != uctypes.DefaultOpenAIModel {
		t.Errorf("fallback request model = %v, want %q", model, uctypes.DefaultOpenAIModel)
	}
	if effort, _ := getNestedString(fallback, "reasoning", "effort"); effort != uctypes.ThinkingLevelMedium {
		t.Errorf("fallback request reasoning effort = %q, want %q", effort, uctypes.ThinkingLevelMedium)
	}
	if verbosity, _ := getNestedString(fallback, "text", "verbosity"); verbosity != uctypes.VerbosityLevelLow {
		t.Errorf("fallback request text verbosity = %q, want %q", verbosity, uctypes.VerbosityLevelLow)
	}
	if maxTokens, _ := fallback["max_output_tokens"].(float64); int(maxTokens) != aiOpts.MaxTokens {
		t.Errorf("fallback request max_output_tokens = %v, want %d", fallback["max_output_tokens"], aiOpts.MaxTokens)
	}
	if stream, _ := fallback["stream"].(bool); !stream {
		t.Errorf("fallback request is not a streaming request")
	}
	// the gpt-6 migration guide says to drop these from reasoning requests (logprobs live under include)
	for _, key := range []string{"temperature", "top_p", "top_logprobs", "include"} {
		if _, found := fallback[key]; found {
			t.Errorf("fallback request unexpectedly sets %q", key)
		}
	}

	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil || len(chat.NativeMessages) != 2 {
		t.Fatalf("expected the user message and the fallback reply in the chat, got %+v", chat)
	}
	if role := chat.NativeMessages[1].GetRole(); role != "assistant" {
		t.Errorf("last chat message role = %q, want assistant", role)
	}
}
