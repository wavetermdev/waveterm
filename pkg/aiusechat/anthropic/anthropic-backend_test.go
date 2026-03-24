// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package anthropic

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestConvertPartsToAnthropicBlocks_TextOnly(t *testing.T) {
	parts := []uctypes.UIMessagePart{
		{Type: "text", Text: "Hello world"},
		{Type: "text", Text: "Default text"},
	}

	blocks, err := convertPartsToAnthropicBlocks(parts, "user")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}

	// Check first block
	block1 := blocks[0]
	if block1.Type != "text" {
		t.Errorf("expected type 'text', got %v", block1.Type)
	}
	if block1.Text != "Hello world" {
		t.Errorf("expected text 'Hello world', got %v", block1.Text)
	}

	// Check second block (empty type defaults to text)
	block2 := blocks[1]
	if block2.Type != "text" {
		t.Errorf("expected type 'text', got %v", block2.Type)
	}
	if block2.Text != "Default text" {
		t.Errorf("expected text 'Default text', got %v", block2.Text)
	}
}

func TestConvertPartsToAnthropicBlocks_SkipsUnknownTypes(t *testing.T) {
	parts := []uctypes.UIMessagePart{
		{Type: "text", Text: "Valid text"},
		{Type: "unknown_type", Text: "Should be skipped"},
		{Type: "text", Text: "Another valid text"},
	}

	blocks, err := convertPartsToAnthropicBlocks(parts, "user")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks (unknown type skipped), got %d", len(blocks))
	}

	block1 := blocks[0]
	if block1.Text != "Valid text" {
		t.Errorf("expected first text 'Valid text', got %v", block1.Text)
	}

	block2 := blocks[1]
	if block2.Text != "Another valid text" {
		t.Errorf("expected second text 'Another valid text', got %v", block2.Text)
	}
}

func TestGetFunctionCallInputByToolCallId(t *testing.T) {
	toolData := &uctypes.UIMessageDataToolUse{ToolCallId: "call-1", ToolName: "read_file", Status: uctypes.ToolUseStatusPending}
	chat := uctypes.AIChat{
		NativeMessages: []uctypes.GenAIMessage{
			&anthropicChatMessage{
				MessageId: "m1",
				Role:      "assistant",
				Content: []anthropicMessageContentBlock{
					{Type: "tool_use", ID: "call-1", Name: "read_file", Input: map[string]interface{}{"path": "/tmp/a"}, ToolUseData: toolData},
				},
			},
		},
	}
	fnCall := GetFunctionCallInputByToolCallId(chat, "call-1")
	if fnCall == nil {
		t.Fatalf("expected function call input")
	}
	if fnCall.CallId != "call-1" || fnCall.Name != "read_file" {
		t.Fatalf("unexpected function call input: %#v", fnCall)
	}
	if fnCall.Arguments != "{\"path\":\"/tmp/a\"}" {
		t.Fatalf("unexpected arguments: %s", fnCall.Arguments)
	}
	if fnCall.ToolUseData == nil || fnCall.ToolUseData.ToolCallId != "call-1" {
		t.Fatalf("expected tool use data")
	}
}

func TestUpdateAndRemoveToolUseCall(t *testing.T) {
	chatID := "anthropic-test-tooluse"
	chatstore.DefaultChatStore.Delete(chatID)
	defer chatstore.DefaultChatStore.Delete(chatID)

	aiOpts := &uctypes.AIOptsType{
		APIType:    uctypes.APIType_AnthropicMessages,
		Model:      "claude-sonnet-4-5",
		APIVersion: AnthropicDefaultAPIVersion,
	}
	msg := &anthropicChatMessage{
		MessageId: "m1",
		Role:      "assistant",
		Content: []anthropicMessageContentBlock{
			{Type: "text", Text: "start"},
			{Type: "tool_use", ID: "call-1", Name: "read_file", Input: map[string]interface{}{"path": "/tmp/a"}},
		},
	}
	if err := chatstore.DefaultChatStore.PostMessage(chatID, aiOpts, msg); err != nil {
		t.Fatalf("failed to seed chat: %v", err)
	}

	newData := uctypes.UIMessageDataToolUse{ToolCallId: "call-1", ToolName: "read_file", Status: uctypes.ToolUseStatusCompleted}
	if err := UpdateToolUseData(chatID, "call-1", newData); err != nil {
		t.Fatalf("update failed: %v", err)
	}

	chat := chatstore.DefaultChatStore.Get(chatID)
	updated := chat.NativeMessages[0].(*anthropicChatMessage)
	if updated.Content[1].ToolUseData == nil || updated.Content[1].ToolUseData.Status != uctypes.ToolUseStatusCompleted {
		t.Fatalf("tool use data not updated")
	}

	if err := RemoveToolUseCall(chatID, "call-1"); err != nil {
		t.Fatalf("remove failed: %v", err)
	}
	chat = chatstore.DefaultChatStore.Get(chatID)
	updated = chat.NativeMessages[0].(*anthropicChatMessage)
	if len(updated.Content) != 1 || updated.Content[0].Type != "text" {
		t.Fatalf("expected tool_use block removed, got %#v", updated.Content)
	}
}

func TestConvertToUIMessageIncludesToolUseData(t *testing.T) {
	msg := &anthropicChatMessage{
		MessageId: "m1",
		Role:      "assistant",
		Content: []anthropicMessageContentBlock{
			{
				Type:        "tool_use",
				ID:          "call-1",
				Name:        "read_file",
				Input:       map[string]interface{}{"path": "/tmp/a"},
				ToolUseData: &uctypes.UIMessageDataToolUse{ToolCallId: "call-1", ToolName: "read_file", Status: uctypes.ToolUseStatusPending},
			},
		},
	}
	ui := msg.ConvertToUIMessage()
	if ui == nil || len(ui.Parts) != 2 {
		t.Fatalf("expected tool and data-tooluse parts, got %#v", ui)
	}
	if ui.Parts[0].Type != "tool-read_file" || ui.Parts[1].Type != "data-tooluse" {
		t.Fatalf("unexpected part types: %#v", ui.Parts)
	}
}
