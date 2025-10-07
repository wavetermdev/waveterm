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
