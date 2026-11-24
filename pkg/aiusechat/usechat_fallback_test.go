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
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const fallbackReplyText = "fallback ok"

// httptest.ResponseRecorder has no write deadline, which SSEHandlerCh.SetupSSE resets
type sseTestWriter struct {
	*httptest.ResponseRecorder
}

func (w *sseTestWriter) SetWriteDeadline(time.Time) error { return nil }

type premiumFallbackStub struct {
	lock            sync.Mutex
	requests        []map[string]any
	failFallback    bool
	toolBeforeLimit bool
	toolAfterLimit  bool
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
	if s.toolBeforeLimit && reqNum == 1 {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, makeFallbackToolStream(uctypes.PremiumOpenAIModel))
		return
	}
	if reqNum == 1 || s.toolBeforeLimit && reqNum == 2 {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Wave-RateLimit", "req=10, reqlimit=200, preq=0, preqlimit=50, reset=4102444800")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"success":false,"error":"premium limit reached"}`)
		return
	}
	if s.failFallback {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"error":{"message":"fallback model unavailable"}}`)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	if s.toolAfterLimit && reqNum == 2 {
		_, _ = io.WriteString(w, makeFallbackToolStream(uctypes.DefaultOpenAIModel))
		return
	}
	_, _ = io.WriteString(w, makeFallbackStream(uctypes.DefaultOpenAIModel))
}

func makeFallbackToolStream(model string) string {
	return fmt.Sprintf(`event: response.created
data: {"type":"response.created","response":{"id":"resp_tool","model":%q}}

event: response.in_progress
data: {"type":"response.in_progress"}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_tool","model":%q,"status":"completed","output":[{"id":"fc_stub","type":"function_call","call_id":"call_stub","name":"adder","arguments":"{\"values\":[2,2]}"}]}}

`, model, model)
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

type premiumFallbackRun struct {
	aiOpts  uctypes.AIOptsType
	chatId  string
	rec     *sseTestWriter
	metrics *uctypes.AIMetrics
	err     error
}

func runPremiumFallback(t *testing.T, stub *premiumFallbackStub) *premiumFallbackRun {
	restoreGlobalRateLimit(t)
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)

	run := &premiumFallbackRun{
		aiOpts: uctypes.AIOptsType{
			Provider:      uctypes.AIProvider_Wave,
			APIType:       uctypes.APIType_OpenAIResponses,
			Model:         uctypes.PremiumOpenAIModel,
			Endpoint:      server.URL,
			ThinkingLevel: uctypes.ThinkingLevelLow,
			Verbosity:     uctypes.VerbosityLevelLow,
			MaxTokens:     1234,
			WaveAIPremium: true,
		},
		chatId: uuid.New().String(),
		rec:    &sseTestWriter{httptest.NewRecorder()},
	}
	backend, err := GetBackendByAPIType(run.aiOpts.APIType)
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
	t.Cleanup(func() { chatstore.DefaultChatStore.Delete(run.chatId) })
	if err := chatstore.DefaultChatStore.PostMessage(run.chatId, &run.aiOpts, userMsg); err != nil {
		t.Fatalf("PostMessage failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sseHandler := sse.MakeSSEHandlerCh(run.rec, ctx)
	chatOpts := uctypes.WaveChatOpts{
		ChatId:   run.chatId,
		ClientId: "test-client",
		Config:   run.aiOpts,
		Tools:    []uctypes.ToolDefinition{GetAdderToolDefinition()},
	}
	run.metrics, run.err = RunAIChat(ctx, sseHandler, backend, chatOpts)
	sseHandler.Close()
	return run
}

func TestRunAIChatPremiumRateLimitFallbackStreamsReply(t *testing.T) {
	run := runPremiumFallback(t, &premiumFallbackStub{})
	if run.err != nil {
		t.Fatalf("RunAIChat failed: %v", run.err)
	}
	if contentType := run.rec.Header().Get("Content-Type"); contentType != sse.SSEContentType {
		t.Errorf("response content type = %q, want %q", contentType, sse.SSEContentType)
	}
	body := run.rec.Body.String()
	if count := strings.Count(body, sse.SSEStreamStartMsg); count != 1 {
		t.Errorf("expected exactly one stream initialization, got %d", count)
	}
	if count := strings.Count(body, `"type":"start"}`); count != 1 {
		t.Errorf("expected exactly one start message in the stream, got %d", count)
	}
	for _, want := range []string{fmt.Sprintf(`"delta":%q`, fallbackReplyText), `{"type":"finish"}`} {
		if !strings.Contains(body, want) {
			t.Errorf("stream is missing %s, got %q", want, body)
		}
	}
}

func TestRunAIChatPremiumRateLimitFallbackWithTools(t *testing.T) {
	for _, beforeLimit := range []bool{false, true} {
		t.Run(fmt.Sprintf("tool before limit %v", beforeLimit), func(t *testing.T) {
			stub := &premiumFallbackStub{toolBeforeLimit: beforeLimit, toolAfterLimit: !beforeLimit}
			run := runPremiumFallback(t, stub)
			if run.err != nil || run.metrics.HadError {
				t.Fatalf("fallback failed: err=%v, metrics=%+v", run.err, run.metrics)
			}
			body := run.rec.Body.String()
			for _, want := range []string{sse.SSEStreamStartMsg, `"type":"start"}`, `{"type":"finish"}`, `data: [DONE]`} {
				if count := strings.Count(body, want); count != 1 {
					t.Errorf("expected %q exactly once, got %d in %q", want, count, body)
				}
			}
			if !strings.Contains(body, fallbackReplyText) {
				t.Errorf("stream is missing the fallback reply: %q", body)
			}
			requests := stub.getRequests()
			if len(requests) != 3 {
				t.Fatalf("expected 3 requests, got %d", len(requests))
			}
			last := requests[2]
			if last["model"] != uctypes.DefaultOpenAIModel {
				t.Errorf("tool continuation model = %v, want %s", last["model"], uctypes.DefaultOpenAIModel)
			}
			if effort, _ := getNestedString(last, "reasoning", "effort"); effort != uctypes.ThinkingLevelMedium {
				t.Errorf("tool continuation effort = %q, want medium", effort)
			}
			if run.metrics.ToolUseCount != 1 || run.metrics.ToolUseErrorCount != 0 {
				t.Errorf("tool did not complete successfully: %+v", run.metrics)
			}
			wantPremium := 1
			if beforeLimit {
				wantPremium = 2
			}
			if run.metrics.PremiumReqCount != wantPremium {
				t.Errorf("premium requests = %d, want %d", run.metrics.PremiumReqCount, wantPremium)
			}
		})
	}
}

func TestRunAIChatPremiumRateLimitFallbackFailureIsReturned(t *testing.T) {
	run := runPremiumFallback(t, &premiumFallbackStub{failFallback: true})
	if run.err == nil || !strings.Contains(run.err.Error(), "fallback model unavailable") {
		t.Fatalf("expected the fallback request error to be returned to the caller, got %v", run.err)
	}
	if body := run.rec.Body.String(); body != "" {
		t.Errorf("no stream should have been written before the fallback failed, got %q", body)
	}
}

func TestRunAIChatPremiumRateLimitFallback(t *testing.T) {
	stub := &premiumFallbackStub{}
	run := runPremiumFallback(t, stub)
	aiOpts, chatId, metrics := run.aiOpts, run.chatId, run.metrics
	if run.err != nil {
		t.Fatalf("RunAIChat failed: %v", run.err)
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
