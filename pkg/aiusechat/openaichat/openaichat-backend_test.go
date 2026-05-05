// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestReasoningContentRoundTrip(t *testing.T) {
	original := ChatRequestMessage{
		Role:             "assistant",
		Content:          "The answer is 42.",
		ReasoningContent: "Let me think about this carefully...",
		ToolCalls: []ToolCall{
			{ID: "call_1", Type: "function", Function: ToolFunctionCall{Name: "search", Arguments: `{}`}},
		},
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var restored ChatRequestMessage
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if restored.Role != original.Role {
		t.Errorf("Role: got %q, want %q", restored.Role, original.Role)
	}
	if restored.Content != original.Content {
		t.Errorf("Content: got %q, want %q", restored.Content, original.Content)
	}
	if restored.ReasoningContent != original.ReasoningContent {
		t.Errorf("ReasoningContent: got %q, want %q", restored.ReasoningContent, original.ReasoningContent)
	}
	if len(restored.ToolCalls) != len(original.ToolCalls) {
		t.Fatalf("ToolCalls length: got %d, want %d", len(restored.ToolCalls), len(original.ToolCalls))
	}
	if restored.ToolCalls[0].ID != original.ToolCalls[0].ID {
		t.Errorf("ToolCalls[0].ID: got %q, want %q", restored.ToolCalls[0].ID, original.ToolCalls[0].ID)
	}
	if restored.ToolCalls[0].Function.Name != original.ToolCalls[0].Function.Name {
		t.Errorf("ToolCalls[0].Function.Name: got %q, want %q", restored.ToolCalls[0].Function.Name, original.ToolCalls[0].Function.Name)
	}
}

func TestReasoningContentOmittedWhenEmpty(t *testing.T) {
	msg := ChatRequestMessage{
		Role:    "user",
		Content: "Hello",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	jsonStr := string(data)
	if strings.Contains(jsonStr, "reasoning_content") {
		t.Errorf("JSON should NOT contain 'reasoning_content' when empty, got: %s", jsonStr)
	}
}

func TestStreamChunkWithReasoningContent(t *testing.T) {
	chunkJSON := `{"choices":[{"delta":{"reasoning_content":"I need to search for this...","content":"Let me search."}}]}`

	var chunk StreamChunk
	if err := json.Unmarshal([]byte(chunkJSON), &chunk); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if len(chunk.Choices) == 0 {
		t.Fatal("expected at least one choice")
	}

	delta := chunk.Choices[0].Delta
	if delta.ReasoningContent != "I need to search for this..." {
		t.Errorf("ReasoningContent: got %q, want %q", delta.ReasoningContent, "I need to search for this...")
	}
	if delta.Content != "Let me search." {
		t.Errorf("Content: got %q, want %q", delta.Content, "Let me search.")
	}
}

func TestCleanPreservesReasoningContent(t *testing.T) {
	msg := &ChatRequestMessage{
		Role:             "assistant",
		Content:          "text",
		ReasoningContent: "thinking",
		ToolCalls: []ToolCall{
			{ID: "call_1", Type: "function", Function: ToolFunctionCall{Name: "f", Arguments: "{}"}, ToolUseData: &uctypes.UIMessageDataToolUse{}},
		},
	}

	cleaned := msg.clean()

	if cleaned == msg {
		t.Error("clean() should return a different pointer")
	}

	if cleaned.ReasoningContent != "thinking" {
		t.Errorf("ReasoningContent: got %q, want %q", cleaned.ReasoningContent, "thinking")
	}

	if cleaned.Content != "text" {
		t.Errorf("Content: got %q, want %q", cleaned.Content, "text")
	}

	if len(cleaned.ToolCalls) != 1 {
		t.Fatalf("ToolCalls length: got %d, want 1", len(cleaned.ToolCalls))
	}
	if cleaned.ToolCalls[0].ToolUseData != nil {
		t.Error("ToolCalls[0].ToolUseData should be nil after clean()")
	}
}

func TestExtractPartialTextMessageWithReasoning(t *testing.T) {
	msg := extractPartialTextMessage("msg-1", "partial text", "partial reasoning")
	if msg == nil {
		t.Fatal("expected non-nil message when text is present")
	}
	if msg.MessageId != "msg-1" {
		t.Errorf("MessageId: got %q, want %q", msg.MessageId, "msg-1")
	}
	if msg.Message.Content != "partial text" {
		t.Errorf("Content: got %q, want %q", msg.Message.Content, "partial text")
	}
	if msg.Message.ReasoningContent != "partial reasoning" {
		t.Errorf("ReasoningContent: got %q, want %q", msg.Message.ReasoningContent, "partial reasoning")
	}
	if msg.Message.Role != "assistant" {
		t.Errorf("Role: got %q, want %q", msg.Message.Role, "assistant")
	}
}

func TestExtractPartialTextMessageWithOnlyReasoning(t *testing.T) {
	msg := extractPartialTextMessage("msg-2", "", "some reasoning")
	if msg == nil {
		t.Fatal("expected non-nil message when reasoning is present")
	}
	if msg.Message.Content != "" {
		t.Errorf("Content: got %q, want empty", msg.Message.Content)
	}
	if msg.Message.ReasoningContent != "some reasoning" {
		t.Errorf("ReasoningContent: got %q, want %q", msg.Message.ReasoningContent, "some reasoning")
	}
}

func TestExtractPartialTextMessageEmpty(t *testing.T) {
	msg := extractPartialTextMessage("msg-3", "", "")
	if msg != nil {
		t.Fatal("expected nil when both text and reasoning are empty")
	}
}
