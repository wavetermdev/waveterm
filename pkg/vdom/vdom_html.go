// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/wavetermdev/htmltoken"
)

// can tokenize and bind HTML to Elems

func appendChildToStack(stack []*Elem, child *Elem) {
	if child == nil {
		return
	}
	if len(stack) == 0 {
		return
	}
	parent := stack[len(stack)-1]
	parent.Children = append(parent.Children, *child)
}

func pushElemStack(stack []*Elem, elem *Elem) []*Elem {
	if elem == nil {
		return stack
	}
	return append(stack, elem)
}

func popElemStack(stack []*Elem) []*Elem {
	if len(stack) <= 1 {
		return stack
	}
	curElem := stack[len(stack)-1]
	appendChildToStack(stack[:len(stack)-1], curElem)
	return stack[:len(stack)-1]
}

func curElemTag(stack []*Elem) string {
	if len(stack) == 0 {
		return ""
	}
	return stack[len(stack)-1].Tag
}

func finalizeStack(stack []*Elem) *Elem {
	if len(stack) == 0 {
		return nil
	}
	for len(stack) > 1 {
		stack = popElemStack(stack)
	}
	rtnElem := stack[0]
	if len(rtnElem.Children) == 0 {
		return nil
	}
	if len(rtnElem.Children) == 1 {
		return &rtnElem.Children[0]
	}
	return rtnElem
}

func getAttr(token htmltoken.Token, key string) string {
	for _, attr := range token.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}
	return ""
}

func tokenToElem(token htmltoken.Token, data map[string]any) *Elem {
	elem := &Elem{Tag: token.Data}
	if len(token.Attr) > 0 {
		elem.Props = make(map[string]any)
	}
	for _, attr := range token.Attr {
		if attr.Key == "" || attr.Val == "" {
			continue
		}
		if strings.HasPrefix(attr.Val, "#bind:") {
			bindKey := attr.Val[6:]
			bindVal, ok := data[bindKey]
			if !ok {
				continue
			}
			elem.Props[attr.Key] = bindVal
			continue
		}
		elem.Props[attr.Key] = attr.Val
	}
	return elem
}

func isWsChar(char rune) bool {
	return char == ' ' || char == '\t' || char == '\n' || char == '\r'
}

func isWsByte(char byte) bool {
	return char == ' ' || char == '\t' || char == '\n' || char == '\r'
}

func isFirstCharLt(s string) bool {
	for _, char := range s {
		if isWsChar(char) {
			continue
		}
		return char == '<'
	}
	return false
}

func isLastCharGt(s string) bool {
	for i := len(s) - 1; i >= 0; i-- {
		char := s[i]
		if isWsByte(char) {
			continue
		}
		return char == '>'
	}
	return false
}

func isAllWhitespace(s string) bool {
	for _, char := range s {
		if !isWsChar(char) {
			return false
		}
	}
	return true
}

func trimWhitespaceConditionally(s string) string {
	// Trim leading whitespace if the first non-whitespace character is '<'
	if isAllWhitespace(s) {
		return ""
	}
	if isFirstCharLt(s) {
		s = strings.TrimLeftFunc(s, func(r rune) bool {
			return isWsChar(r)
		})
	}
	// Trim trailing whitespace if the last non-whitespace character is '>'
	if isLastCharGt(s) {
		s = strings.TrimRightFunc(s, func(r rune) bool {
			return isWsChar(r)
		})
	}
	return s
}

func processWhitespace(htmlStr string) string {
	lines := strings.Split(htmlStr, "\n")
	var newLines []string
	for _, line := range lines {
		trimmedLine := trimWhitespaceConditionally(line + "\n")
		if trimmedLine == "" {
			continue
		}
		newLines = append(newLines, trimmedLine)
	}
	return strings.Join(newLines, "")
}

func processTextStr(s string) string {
	if s == "" {
		return ""
	}
	if isAllWhitespace(s) {
		return " "
	}
	return strings.TrimSpace(s)
}

func Bind(htmlStr string, data map[string]any) *Elem {
	htmlStr = processWhitespace(htmlStr)
	r := strings.NewReader(htmlStr)
	iter := htmltoken.NewTokenizer(r)
	var elemStack []*Elem
	elemStack = append(elemStack, &Elem{Tag: FragmentTag})
	var tokenErr error
outer:
	for {
		tokenType := iter.Next()
		token := iter.Token()
		switch tokenType {
		case htmltoken.StartTagToken:
			if token.Data == "bind" {
				tokenErr = errors.New("bind tag must be self closing")
				break outer
			}
			elem := tokenToElem(token, data)
			elemStack = pushElemStack(elemStack, elem)
		case htmltoken.EndTagToken:
			if token.Data == "bind" {
				tokenErr = errors.New("bind tag must be self closing")
				break outer
			}
			if len(elemStack) <= 1 {
				tokenErr = fmt.Errorf("end tag %q without start tag", token.Data)
				break outer
			}
			if curElemTag(elemStack) != token.Data {
				tokenErr = fmt.Errorf("end tag %q does not match start tag %q", token.Data, curElemTag(elemStack))
				break outer
			}
			elemStack = popElemStack(elemStack)
		case htmltoken.SelfClosingTagToken:
			if token.Data == "bind" {
				keyAttr := getAttr(token, "key")
				dataVal := data[keyAttr]
				elemList := partToElems(dataVal)
				for _, elem := range elemList {
					appendChildToStack(elemStack, &elem)
				}
				continue
			}
			elem := tokenToElem(token, data)
			appendChildToStack(elemStack, elem)
		case htmltoken.TextToken:
			if token.Data == "" {
				continue
			}
			textStr := processTextStr(token.Data)
			if textStr == "" {
				continue
			}
			elem := TextElem(textStr)
			appendChildToStack(elemStack, &elem)
		case htmltoken.CommentToken:
			continue
		case htmltoken.DoctypeToken:
			tokenErr = errors.New("doctype not supported")
			break outer
		case htmltoken.ErrorToken:
			if iter.Err() == io.EOF {
				break outer
			}
			tokenErr = iter.Err()
			break outer
		}
	}
	if tokenErr != nil {
		errTextElem := TextElem(tokenErr.Error())
		appendChildToStack(elemStack, &errTextElem)
	}
	return finalizeStack(elemStack)
}
