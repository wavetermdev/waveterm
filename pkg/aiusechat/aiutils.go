// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"strings"
)

func parseContentFromJSON(rawContent json.RawMessage) ([]UseChatContentBlock, error) {
	if len(rawContent) == 0 {
		return nil, nil
	}

	// Try to unmarshal as string first
	var contentStr string
	if err := json.Unmarshal(rawContent, &contentStr); err == nil {
		// It's a string - convert to single text block
		return []UseChatContentBlock{
			{
				Type: "text",
				Text: contentStr,
			},
		}, nil
	}

	// Not a string - unmarshal as array of blocks
	var contentBlocks []UseChatContentBlock
	if err := json.Unmarshal(rawContent, &contentBlocks); err != nil {
		return nil, err
	}
	return contentBlocks, nil
}

func mustMarshal(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return data
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}
