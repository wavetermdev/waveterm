// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"encoding/json"
)

type stackItem int

const (
	stackInvalid stackItem = iota
	stackLBrace
	stackLBrack
	stackBeforeKey
	stackKey
	stackKeyColon
	stackQuote
)

type jsonStack []stackItem

func (s *jsonStack) push(item stackItem) {
	*s = append(*s, item)
}

func (s *jsonStack) pop() stackItem {
	if len(*s) == 0 {
		return stackInvalid
	}
	item := (*s)[len(*s)-1]
	*s = (*s)[:len(*s)-1]
	return item
}

func (s jsonStack) peek() stackItem {
	if len(s) == 0 {
		return stackInvalid
	}
	return s[len(s)-1]
}
func (s jsonStack) isTop(items ...stackItem) bool {
	top := s.peek()
	for _, item := range items {
		if top == item {
			return true
		}
	}
	return false
}

func (s *jsonStack) replaceTop(item stackItem) {
	if len(*s) > 0 {
		(*s)[len(*s)-1] = item
	}
}

func repairJson(data []byte) []byte {
	if len(data) == 0 {
		return data
	}

	var stack jsonStack
	inString := false
	escaped := false
	lastComma := false

	for i := 0; i < len(data); i++ {
		b := data[i]

		if escaped {
			escaped = false
			continue
		}

		if inString {
			if b == '\\' {
				escaped = true
				continue
			}
			if b == '"' {
				inString = false
			}
			continue
		}

		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		valueStart := b == '{' || b == '[' || b == 'n' || b == 't' || b == 'f' || b == '"' || (b >= '0' && b <= '9') || b == '-'
		if valueStart && lastComma {
			lastComma = false
		}
		if valueStart && stack.isTop(stackKeyColon) {
			stack.pop()
		}
		if valueStart && stack.isTop(stackBeforeKey) {
			stack.replaceTop(stackKey)
		}
		switch b {
		case '{':
			stack.push(stackLBrace)
			stack.push(stackBeforeKey)
		case '[':
			stack.push(stackLBrack)
		case '}':
			if stack.isTop(stackBeforeKey) {
				stack.pop()
			}
			if stack.isTop(stackLBrace) {
				stack.pop()
			}
		case ']':
			if stack.isTop(stackLBrack) {
				stack.pop()
			}
		case '"':
			inString = true
		case ':':
			if stack.isTop(stackKey) {
				stack.replaceTop(stackKeyColon)
			}
		case ',':
			lastComma = true
			if stack.isTop(stackLBrace) {
				stack.push(stackBeforeKey)
			}
		default:
		}
	}

	if len(stack) == 0 && !inString {
		return data
	}

	result := append([]byte{}, data...)
	if escaped && len(result) > 0 {
		result = result[:len(result)-1]
	}
	if inString {
		result = append(result, '"')
	}
	if lastComma {
		for i := len(result) - 1; i >= 0; i-- {
			if result[i] == ',' {
				result = result[:i]
				break
			}
		}
	}
	for i := len(stack) - 1; i >= 0; i-- {
		switch stack[i] {
		case stackKeyColon:
			result = append(result, []byte("null")...)
		case stackKey:
			result = append(result, []byte(": null")...)
		case stackLBrace:
			result = append(result, '}')
		case stackLBrack:
			result = append(result, ']')
		}
	}
	return result
}

func ParseParialJson(data []byte) (any, error) {
	fixedData := repairJson(data)
	var output any
	err := json.Unmarshal(fixedData, &output)
	if err != nil {
		return nil, err
	}
	return output, nil
}
