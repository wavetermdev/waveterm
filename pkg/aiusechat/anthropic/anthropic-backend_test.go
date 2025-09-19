// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package anthropic

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestConvertPartsToAnthropicBlocks_TextOnly(t *testing.T) {
	parts := []uctypes.UIMessagePart{
		{Type: "text", Text: "Hello world"},
		{Type: "", Text: "Default text"},
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

func TestConvertToolResultPart_StringContent(t *testing.T) {
	part := uctypes.UIMessagePart{
		Type:      "tool_result",
		ToolUseID: "toolu_123",
		Content: []uctypes.UseChatContentBlock{
			{Type: "text", Text: "Tool executed successfully"},
		},
	}

	block, err := convertToolResultPart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if block["type"] != "tool_result" {
		t.Errorf("expected type 'tool_result', got %v", block["type"])
	}
	if block["tool_use_id"] != "toolu_123" {
		t.Errorf("expected tool_use_id 'toolu_123', got %v", block["tool_use_id"])
	}
	if block["content"] != "Tool executed successfully" {
		t.Errorf("expected content 'Tool executed successfully', got %v", block["content"])
	}
}

func TestConvertToolResultPart_MultipleContentBlocks(t *testing.T) {
	part := uctypes.UIMessagePart{
		Type:      "tool_result",
		ToolUseID: "toolu_456",
		Content: []uctypes.UseChatContentBlock{
			{Type: "text", Text: "First block"},
			{Type: "text", Text: "Second block"},
		},
	}

	block, err := convertToolResultPart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	contentBlocks := block["content"].([]interface{})
	if len(contentBlocks) != 2 {
		t.Fatalf("expected 2 content blocks, got %d", len(contentBlocks))
	}

	block1 := contentBlocks[0].(map[string]interface{})
	if block1["type"] != "text" || block1["text"] != "First block" {
		t.Errorf("unexpected first block: %v", block1)
	}

	block2 := contentBlocks[1].(map[string]interface{})
	if block2["type"] != "text" || block2["text"] != "Second block" {
		t.Errorf("unexpected second block: %v", block2)
	}
}

func TestConvertToolResultPart_WithError(t *testing.T) {
	isError := true
	part := uctypes.UIMessagePart{
		Type:      "tool_result",
		ToolUseID: "toolu_789",
		Content: []uctypes.UseChatContentBlock{
			{Type: "text", Text: "Error occurred"},
		},
		IsError: &isError,
	}

	block, err := convertToolResultPart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if block["is_error"] != true {
		t.Errorf("expected is_error true, got %v", block["is_error"])
	}
}

func TestConvertToolResultPart_EmptyContent(t *testing.T) {
	part := uctypes.UIMessagePart{
		Type:      "tool_result",
		ToolUseID: "toolu_empty",
		Content:   []uctypes.UseChatContentBlock{},
	}

	block, err := convertToolResultPart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if block["content"] != "" {
		t.Errorf("expected empty string content, got %v", block["content"])
	}
}

func TestConvertToolResultPart_DataContent(t *testing.T) {
	part := uctypes.UIMessagePart{
		Type:      "tool_result",
		ToolUseID: "toolu_data",
		Content: []uctypes.UseChatContentBlock{
			{Type: "data", Data: map[string]interface{}{"result": 42}},
		},
	}

	block, err := convertToolResultPart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	contentBlocks := block["content"].([]interface{})
	if len(contentBlocks) != 1 {
		t.Fatalf("expected 1 content block, got %d", len(contentBlocks))
	}

	block1 := contentBlocks[0].(map[string]interface{})
	if block1["type"] != "text" {
		t.Errorf("expected type 'text', got %v", block1["type"])
	}
	if block1["text"] != `{"result":42}` {
		t.Errorf("expected JSON string, got %v", block1["text"])
	}
}

func TestConvertToolResultPart_ValidationError(t *testing.T) {
	part := uctypes.UIMessagePart{
		Type: "tool_result",
		// Missing ToolUseID
		Content: []uctypes.UseChatContentBlock{
			{Type: "text", Text: "Some content"},
		},
	}

	_, err := convertToolResultPart(part)
	if err == nil {
		t.Fatalf("expected error but got none")
	}
	if err.Error() != "tool_result part missing tool_use_id" {
		t.Errorf("expected specific error message, got %v", err.Error())
	}
}

func TestConvertPartsToAnthropicBlocks_MultipleToolResults(t *testing.T) {
	parts := []uctypes.UIMessagePart{
		{
			Type:      "tool_result",
			ToolUseID: "toolu_first",
			Content: []uctypes.UseChatContentBlock{
				{Type: "text", Text: "First tool result"},
			},
		},
		{
			Type:      "tool_result",
			ToolUseID: "toolu_second",
			Content: []uctypes.UseChatContentBlock{
				{Type: "text", Text: "Second tool result"},
			},
		},
	}

	blocks, err := convertPartsToAnthropicBlocks(parts, "user")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}

	block1 := blocks[0]
	if block1.ToolUseID != "toolu_first" {
		t.Errorf("expected first tool_use_id 'toolu_first', got %v", block1.ToolUseID)
	}

	block2 := blocks[1]
	if block2.ToolUseID != "toolu_second" {
		t.Errorf("expected second tool_use_id 'toolu_second', got %v", block2.ToolUseID)
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

