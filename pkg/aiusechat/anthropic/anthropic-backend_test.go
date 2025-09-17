package anthropic

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestConvertPartsToAnthropicBlocks_TextOnly(t *testing.T) {
	parts := []uctypes.UseChatMessagePart{
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
	block1 := blocks[0].(map[string]interface{})
	if block1["type"] != "text" {
		t.Errorf("expected type 'text', got %v", block1["type"])
	}
	if block1["text"] != "Hello world" {
		t.Errorf("expected text 'Hello world', got %v", block1["text"])
	}

	// Check second block (empty type defaults to text)
	block2 := blocks[1].(map[string]interface{})
	if block2["type"] != "text" {
		t.Errorf("expected type 'text', got %v", block2["type"])
	}
	if block2["text"] != "Default text" {
		t.Errorf("expected text 'Default text', got %v", block2["text"])
	}
}

func TestConvertImagePart_URL(t *testing.T) {
	part := uctypes.UseChatMessagePart{
		Type: "image",
		Source: &uctypes.ImageSource{
			Type: "url",
			URL:  "https://example.com/image.jpg",
		},
	}

	block, err := convertImagePart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if block["type"] != "image" {
		t.Errorf("expected type 'image', got %v", block["type"])
	}

	source := block["source"].(map[string]interface{})
	if source["type"] != "url" {
		t.Errorf("expected source type 'url', got %v", source["type"])
	}
	if source["url"] != "https://example.com/image.jpg" {
		t.Errorf("expected url 'https://example.com/image.jpg', got %v", source["url"])
	}
}

func TestConvertImagePart_Base64(t *testing.T) {
	part := uctypes.UseChatMessagePart{
		Type: "image",
		Source: &uctypes.ImageSource{
			Type:      "base64",
			Data:      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
			MediaType: "image/png",
		},
	}

	block, err := convertImagePart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	source := block["source"].(map[string]interface{})
	if source["type"] != "base64" {
		t.Errorf("expected source type 'base64', got %v", source["type"])
	}
	if source["media_type"] != "image/png" {
		t.Errorf("expected media_type 'image/png', got %v", source["media_type"])
	}
	if source["data"] != "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==" {
		t.Errorf("unexpected data value")
	}
}

func TestConvertImagePart_File(t *testing.T) {
	part := uctypes.UseChatMessagePart{
		Type: "image",
		Source: &uctypes.ImageSource{
			Type:   "file",
			FileID: "file_12345",
		},
	}

	block, err := convertImagePart(part)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	source := block["source"].(map[string]interface{})
	if source["type"] != "file" {
		t.Errorf("expected source type 'file', got %v", source["type"])
	}
	if source["file_id"] != "file_12345" {
		t.Errorf("expected file_id 'file_12345', got %v", source["file_id"])
	}
}

func TestConvertImagePart_ValidationErrors(t *testing.T) {
	tests := []struct {
		name     string
		part     uctypes.UseChatMessagePart
		errorMsg string
	}{
		{
			name:     "missing source",
			part:     uctypes.UseChatMessagePart{Type: "image"},
			errorMsg: "image part missing source",
		},
		{
			name: "url missing url field",
			part: uctypes.UseChatMessagePart{
				Type:   "image",
				Source: &uctypes.ImageSource{Type: "url"},
			},
			errorMsg: "image source type 'url' requires url field",
		},
		{
			name: "base64 missing data",
			part: uctypes.UseChatMessagePart{
				Type:   "image",
				Source: &uctypes.ImageSource{Type: "base64", MediaType: "image/png"},
			},
			errorMsg: "image source type 'base64' requires data field",
		},
		{
			name: "base64 missing media_type",
			part: uctypes.UseChatMessagePart{
				Type:   "image",
				Source: &uctypes.ImageSource{Type: "base64", Data: "data"},
			},
			errorMsg: "image source type 'base64' requires media_type field",
		},
		{
			name: "file missing file_id",
			part: uctypes.UseChatMessagePart{
				Type:   "image",
				Source: &uctypes.ImageSource{Type: "file"},
			},
			errorMsg: "image source type 'file' requires file_id field",
		},
		{
			name: "unsupported source type",
			part: uctypes.UseChatMessagePart{
				Type:   "image",
				Source: &uctypes.ImageSource{Type: "invalid"},
			},
			errorMsg: "unsupported image source type: invalid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := convertImagePart(tt.part)
			if err == nil {
				t.Fatalf("expected error but got none")
			}
			if err.Error() != tt.errorMsg {
				t.Errorf("expected error '%s', got '%s'", tt.errorMsg, err.Error())
			}
		})
	}
}

func TestConvertToolResultPart_StringContent(t *testing.T) {
	part := uctypes.UseChatMessagePart{
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
	part := uctypes.UseChatMessagePart{
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
	part := uctypes.UseChatMessagePart{
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
	part := uctypes.UseChatMessagePart{
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
	part := uctypes.UseChatMessagePart{
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
	part := uctypes.UseChatMessagePart{
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

func TestConvertPartsToAnthropicBlocks_MixedContent(t *testing.T) {
	parts := []uctypes.UseChatMessagePart{
		{Type: "text", Text: "Here's an image:"},
		{
			Type: "image",
			Source: &uctypes.ImageSource{
				Type: "url",
				URL:  "https://example.com/image.jpg",
			},
		},
		{
			Type:      "tool_result",
			ToolUseID: "toolu_123",
			Content: []uctypes.UseChatContentBlock{
				{Type: "text", Text: "Tool result"},
			},
		},
		{Type: "text", Text: "And that's the result."},
	}

	blocks, err := convertPartsToAnthropicBlocks(parts, "user")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(blocks) != 4 {
		t.Fatalf("expected 4 blocks, got %d", len(blocks))
	}

	// Check types are preserved in order
	block1 := blocks[0].(map[string]interface{})
	if block1["type"] != "text" {
		t.Errorf("expected first block to be text, got %v", block1["type"])
	}

	block2 := blocks[1].(map[string]interface{})
	if block2["type"] != "image" {
		t.Errorf("expected second block to be image, got %v", block2["type"])
	}

	block3 := blocks[2].(map[string]interface{})
	if block3["type"] != "tool_result" {
		t.Errorf("expected third block to be tool_result, got %v", block3["type"])
	}

	block4 := blocks[3].(map[string]interface{})
	if block4["type"] != "text" {
		t.Errorf("expected fourth block to be text, got %v", block4["type"])
	}
}

func TestConvertPartsToAnthropicBlocks_MultipleToolResults(t *testing.T) {
	parts := []uctypes.UseChatMessagePart{
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

	block1 := blocks[0].(map[string]interface{})
	if block1["tool_use_id"] != "toolu_first" {
		t.Errorf("expected first tool_use_id 'toolu_first', got %v", block1["tool_use_id"])
	}

	block2 := blocks[1].(map[string]interface{})
	if block2["tool_use_id"] != "toolu_second" {
		t.Errorf("expected second tool_use_id 'toolu_second', got %v", block2["tool_use_id"])
	}
}

func TestConvertPartsToAnthropicBlocks_SkipsUnknownTypes(t *testing.T) {
	parts := []uctypes.UseChatMessagePart{
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

	block1 := blocks[0].(map[string]interface{})
	if block1["text"] != "Valid text" {
		t.Errorf("expected first text 'Valid text', got %v", block1["text"])
	}

	block2 := blocks[1].(map[string]interface{})
	if block2["text"] != "Another valid text" {
		t.Errorf("expected second text 'Another valid text', got %v", block2["text"])
	}
}

func TestConvertPartsToAnthropicBlocks_PropagatesValidationErrors(t *testing.T) {
	parts := []uctypes.UseChatMessagePart{
		{Type: "text", Text: "Valid text"},
		{
			Type: "image",
			// Missing Source - should cause validation error
		},
	}

	_, err := convertPartsToAnthropicBlocks(parts, "user")
	if err == nil {
		t.Fatalf("expected validation error but got none")
	}
	if err.Error() != "image part missing source" {
		t.Errorf("expected specific validation error, got %v", err.Error())
	}
}
