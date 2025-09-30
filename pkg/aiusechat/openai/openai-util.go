// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"encoding/json"
	"log"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

func debugPrintInput(idx int, input any) {
	switch v := input.(type) {
	case OpenAIMessage:
		log.Printf("  [%d] message role=%s blocks=%d", idx, v.Role, len(v.Content))
		for _, block := range v.Content {
			switch block.Type {
			case "input_text":
				log.Printf("    - text: %q", utilfn.TruncateString(block.Text, 40))
			case "input_image":
				size := len(block.ImageUrl)
				log.Printf("    - image: size=%d", size)
			case "input_file":
				size := len(block.FileData)
				log.Printf("    - file: name=%s size=%d", block.Filename, size)
			case "function_call":
				log.Printf("    - function_call: name=%s callid=%s", block.Name, block.CallId)
			default:
				log.Printf("    - %s", block.Type)
			}
		}
	case OpenAIFunctionCallInput:
		log.Printf("  [%d] function_call: name=%s callid=%s args_len=%d", idx, v.Name, v.CallId, len(v.Arguments))
	case OpenAIFunctionCallOutputInput:
		outputSize := 0
		if outputBytes, err := json.Marshal(v.Output); err == nil {
			outputSize = len(outputBytes)
		}
		log.Printf("  [%d] function_call_output: callid=%s output_size=%d", idx, v.CallId, outputSize)
	default:
		log.Printf("  [%d] unknown type: %T", idx, input)
	}
}