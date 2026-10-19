// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/launchdarkly/eventsource"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type openaiTestRecorder struct {
	*httptest.ResponseRecorder
}

// SetWriteDeadline lets ResponseController initialize SSE without a real connection.
func (r *openaiTestRecorder) SetWriteDeadline(time.Time) error {
	return nil
}

type openaiTestStream struct {
	state    *openaiStreamingState
	handler  *sse.SSEHandlerCh
	recorder *openaiTestRecorder
}

// makeOpenAITestStream uses the real SSE writer so dropped UI events remain observable.
func makeOpenAITestStream(t *testing.T, opts uctypes.WaveChatOpts) *openaiTestStream {
	t.Helper()
	recorder := &openaiTestRecorder{httptest.NewRecorder()}
	handler := sse.MakeSSEHandlerCh(recorder, context.Background())
	if err := handler.SetupSSE(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(handler.Close)
	return &openaiTestStream{
		state:    &openaiStreamingState{blockMap: map[openaiBlockKey]*openaiBlockState{}, chatOpts: opts},
		handler:  handler,
		recorder: recorder,
	}
}

// send decodes wire events rather than bypassing their JSON fields with Go structs.
func (s *openaiTestStream) send(t *testing.T, data string) (*uctypes.WaveStopReason, []*OpenAIChatMessage) {
	t.Helper()
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(data), &envelope); err != nil {
		t.Fatal(err)
	}
	decoder := eventsource.NewDecoder(strings.NewReader("event: " + envelope.Type + "\ndata: " + data + "\n\n"))
	event, err := decoder.Decode()
	if err != nil {
		t.Fatal(err)
	}
	return handleOpenAIEvent(event, s.handler, s.state, nil)
}

// parts drains the asynchronous writer before reading its recorder to avoid races.
func (s *openaiTestStream) parts(t *testing.T) []map[string]any {
	t.Helper()
	s.handler.Close()
	var parts []map[string]any
	decoder := eventsource.NewDecoder(strings.NewReader(s.recorder.Body.String()))
	for {
		event, err := decoder.Decode()
		if err != nil {
			t.Fatal(err)
		}
		if event.Data() == "[DONE]" {
			return parts
		}
		var part map[string]any
		if err := json.Unmarshal([]byte(event.Data()), &part); err != nil {
			t.Fatal(err)
		}
		parts = append(parts, part)
	}
}

// TestResponsesTextStreamingItemIDs guards both UI and saved text against provider ID churn.
func TestResponsesTextStreamingItemIDs(t *testing.T) {
	for _, tc := range []struct {
		name string
		ids  [4]string
	}{
		{name: "stable", ids: [4]string{"msg-1", "msg-1", "msg-1", "msg-1"}},
		{name: "changing", ids: [4]string{"part-added", "delta-1", "delta-2", "part-done"}},
		{name: "empty"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stream := makeOpenAITestStream(t, uctypes.WaveChatOpts{})
			stream.send(t, fmt.Sprintf(`{"type":"response.content_part.added","item_id":%q,"output_index":1,"content_index":0,"part":{"type":"output_text","text":""}}`, tc.ids[0]))
			stream.send(t, fmt.Sprintf(`{"type":"response.output_text.delta","item_id":%q,"output_index":1,"content_index":0,"delta":"O"}`, tc.ids[1]))
			stream.send(t, fmt.Sprintf(`{"type":"response.output_text.delta","item_id":%q,"output_index":1,"content_index":0,"delta":"K"}`, tc.ids[2]))
			stream.send(t, fmt.Sprintf(`{"type":"response.content_part.done","item_id":%q,"output_index":1,"content_index":0,"part":{"type":"output_text","text":"OK"}}`, tc.ids[3]))

			partial := extractPartialTextFromState(stream.state)
			if len(partial) != 1 || partial[0].Message.Content[0].Text != "OK" {
				t.Fatalf("partial message lost streamed text: %#v", partial)
			}
			stop, messages := stream.send(t, `{"type":"response.completed","response":{"status":"completed","output":[{"type":"message","id":"final-id","role":"assistant","content":[{"type":"output_text","text":"OK"}]}]}}`)
			if stop == nil || stop.Kind != uctypes.StopKindDone || len(messages) != 1 || messages[0].Message.Content[0].Text != "OK" {
				t.Fatalf("unexpected completed response: stop=%#v messages=%#v", stop, messages)
			}

			parts := stream.parts(t)
			wantTypes := []string{"text-start", "text-delta", "text-delta", "text-end"}
			if len(parts) != len(wantTypes) {
				t.Fatalf("got parts %#v, want %v", parts, wantTypes)
			}
			id := parts[0]["id"]
			if id == nil || id == "" {
				t.Fatal("missing local text ID")
			}
			for i, want := range wantTypes {
				if parts[i]["type"] != want || parts[i]["id"] != id {
					t.Errorf("part %d: got %#v, want type %q and ID %v", i, parts[i], want, id)
				}
			}
			if parts[1]["delta"] != "O" || parts[2]["delta"] != "K" {
				t.Errorf("text deltas lost: %#v", parts)
			}
		})
	}
}

// TestResponsesTextStreamingSeparateParts covers content parts that legitimately share an item ID.
func TestResponsesTextStreamingSeparateParts(t *testing.T) {
	stream := makeOpenAITestStream(t, uctypes.WaveChatOpts{})
	positions := [][2]int{{0, 0}, {0, 1}, {1, 0}}
	for _, pos := range positions {
		stream.send(t, fmt.Sprintf(`{"type":"response.content_part.added","item_id":"message-%d","output_index":%d,"content_index":%d,"part":{"type":"output_text"}}`, pos[0], pos[0], pos[1]))
	}
	for i, pos := range positions {
		stream.send(t, fmt.Sprintf(`{"type":"response.output_text.delta","item_id":"message-%d","output_index":%d,"content_index":%d,"delta":"part-%d"}`, pos[0], pos[0], pos[1], i))
	}
	for _, pos := range positions {
		stream.send(t, fmt.Sprintf(`{"type":"response.content_part.done","item_id":"message-%d","output_index":%d,"content_index":%d}`, pos[0], pos[0], pos[1]))
	}

	parts := stream.parts(t)
	if len(parts) != 9 {
		t.Fatalf("got %d parts, want 9: %#v", len(parts), parts)
	}
	ids := map[any]bool{}
	for i := range positions {
		id := parts[i]["id"]
		if id == nil || ids[id] {
			t.Fatalf("text parts share an ID: %#v", parts)
		}
		ids[id] = true
		if parts[i]["type"] != "text-start" || parts[i+3]["type"] != "text-delta" || parts[i+6]["type"] != "text-end" ||
			parts[i+3]["id"] != id || parts[i+6]["id"] != id || parts[i+3]["delta"] != fmt.Sprintf("part-%d", i) {
			t.Errorf("part %d was routed to the wrong text block: %#v", i, parts)
		}
	}
}

// TestResponsesReasoningStreamingChangingItemIDs keeps summary separators and completion on one UI block.
func TestResponsesReasoningStreamingChangingItemIDs(t *testing.T) {
	stream := makeOpenAITestStream(t, uctypes.WaveChatOpts{})
	for _, data := range []string{
		`{"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"reasoning-added"}}`,
		`{"type":"response.reasoning_summary_part.added","output_index":0,"summary_index":0,"item_id":"summary-added-0"}`,
		`{"type":"response.reasoning_summary_text.delta","output_index":0,"summary_index":0,"item_id":"summary-delta-0","delta":"First"}`,
		`{"type":"response.reasoning_summary_part.added","output_index":0,"summary_index":1,"item_id":"summary-added-1"}`,
		`{"type":"response.reasoning_summary_text.delta","output_index":0,"summary_index":1,"item_id":"summary-delta-1","delta":"Second"}`,
		`{"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"reasoning-done"}}`,
	} {
		stream.send(t, data)
	}
	parts := stream.parts(t)
	if len(parts) != 5 {
		t.Fatalf("got parts %#v, want reasoning start, three deltas and end", parts)
	}
	for _, part := range parts {
		if part["id"] != parts[0]["id"] {
			t.Errorf("reasoning block ID changed: %#v", parts)
		}
	}
	if parts[0]["type"] != "reasoning-start" || parts[4]["type"] != "reasoning-end" ||
		parts[1]["delta"] != "First" || parts[2]["delta"] != "\n\n" || parts[3]["delta"] != "Second" {
		t.Errorf("reasoning was lost or incorrectly separated: %#v", parts)
	}
}

// TestResponsesToolProgressChangingItemIDs preserves call IDs across interleaved provider events.
func TestResponsesToolProgressChangingItemIDs(t *testing.T) {
	stream := makeOpenAITestStream(t, uctypes.WaveChatOpts{
		Tools: []uctypes.ToolDefinition{{
			Name: "read_file",
			ToolProgressDesc: func(input any) ([]string, error) {
				return []string{input.(map[string]any)["path"].(string)}, nil
			},
		}},
	})
	for _, data := range []string{
		`{"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"tool-added-1","call_id":"call-1","name":"read_file"}}`,
		`{"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","id":"tool-added-2","call_id":"call-2","name":"read_file"}}`,
		`{"type":"response.function_call_arguments.delta","output_index":1,"item_id":"tool-delta-1","delta":"{\"path\":\"first\"}"}`,
		`{"type":"response.function_call_arguments.delta","output_index":2,"item_id":"tool-delta-2","delta":"{\"path\":\"second\"}"}`,
		`{"type":"response.function_call_arguments.done","output_index":2,"item_id":"tool-done-2","arguments":"{\"path\":\"second\"}"}`,
		`{"type":"response.function_call_arguments.done","output_index":1,"item_id":"tool-done-1","arguments":"{\"path\":\"first\"}"}`,
	} {
		stream.send(t, data)
	}
	parts := stream.parts(t)
	if len(parts) != 4 {
		t.Fatalf("tool progress lost: %#v", parts)
	}
	wantCalls := []string{"call-1", "call-2", "call-2", "call-1"}
	wantPaths := []string{"first", "second", "second", "first"}
	for i, part := range parts {
		data := part["data"].(map[string]any)
		lines := data["statuslines"].([]any)
		if part["type"] != "data-toolprogress" || data["toolcallid"] != wantCalls[i] || len(lines) != 1 || lines[0] != wantPaths[i] {
			t.Errorf("tool progress routed to the wrong call: %#v", part)
		}
	}
}

// TestExtractPartialTextFromState preserves response order when cancellation bypasses the final output.
func TestExtractPartialTextFromState(t *testing.T) {
	state := &openaiStreamingState{blockMap: map[openaiBlockKey]*openaiBlockState{
		{outputIndex: 2, contentIndex: 0}: {kind: openaiBlockText, accumulatedText: "third"},
		{outputIndex: 1, contentIndex: 1}: {kind: openaiBlockText, accumulatedText: "second"},
		{outputIndex: 1, contentIndex: 0}: {kind: openaiBlockText, accumulatedText: "first"},
		{outputIndex: 0}:                  {kind: openaiBlockReasoning, accumulatedText: "skip reasoning"},
		{outputIndex: 3}:                  {kind: openaiBlockText},
		{outputIndex: 4}:                  {kind: openaiBlockToolUse, accumulatedText: "skip tool"},
	}}
	// Repeated extraction exposes map iteration changes without relying on insertion order.
	for range 32 {
		messages := extractPartialTextFromState(state)
		if len(messages) != 1 || messages[0].Message == nil {
			t.Fatalf("expected one partial assistant message, got %#v", messages)
		}
		message := messages[0].Message
		if message.Role != "assistant" || len(message.Content) != 3 {
			t.Fatalf("unexpected partial message: %#v", message)
		}
		for i, want := range []string{"first", "second", "third"} {
			if message.Content[i].Type != "output_text" || message.Content[i].Text != want {
				t.Fatalf("partial content %d: got %#v, want %q", i, message.Content[i], want)
			}
		}
	}
	delete(state.blockMap, openaiBlockKey{outputIndex: 1, contentIndex: 0})
	delete(state.blockMap, openaiBlockKey{outputIndex: 1, contentIndex: 1})
	delete(state.blockMap, openaiBlockKey{outputIndex: 2, contentIndex: 0})
	if messages := extractPartialTextFromState(state); messages != nil {
		t.Fatalf("expected no partial message for empty or non-text blocks, got %#v", messages)
	}
}
