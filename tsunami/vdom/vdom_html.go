// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/wavetermdev/waveterm/tsunami/vdom/cssparser"

	"github.com/wavetermdev/htmltoken"
)

// can tokenize and bind HTML to Elems

const Html_BindPrefix = "#bind:"
const Html_ParamPrefix = "#param:"
const Html_GlobalEventPrefix = "#globalevent"
const Html_BindParamTagName = "bindparam"
const Html_BindTagName = "bind"

func appendChildToStack(stack []*VDomElem, child *VDomElem) {
	if child == nil {
		return
	}
	if len(stack) == 0 {
		return
	}
	parent := stack[len(stack)-1]
	parent.Children = append(parent.Children, *child)
}

func pushElemStack(stack []*VDomElem, elem *VDomElem) []*VDomElem {
	if elem == nil {
		return stack
	}
	return append(stack, elem)
}

func popElemStack(stack []*VDomElem) []*VDomElem {
	if len(stack) <= 1 {
		return stack
	}
	curElem := stack[len(stack)-1]
	appendChildToStack(stack[:len(stack)-1], curElem)
	return stack[:len(stack)-1]
}

func curElemTag(stack []*VDomElem) string {
	if len(stack) == 0 {
		return ""
	}
	return stack[len(stack)-1].Tag
}

func finalizeStack(stack []*VDomElem) *VDomElem {
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

// returns value, isjson
func getAttrString(token htmltoken.Token, key string) string {
	for _, attr := range token.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}
	return ""
}

func attrToProp(attrVal string, isJson bool, params map[string]any) any {
	if isJson {
		var val any
		err := json.Unmarshal([]byte(attrVal), &val)
		if err != nil {
			return nil
		}
		unmStrVal, ok := val.(string)
		if !ok {
			return val
		}
		attrVal = unmStrVal
		// fallthrough using the json str val
	}
	if strings.HasPrefix(attrVal, Html_ParamPrefix) {
		bindKey := attrVal[len(Html_ParamPrefix):]
		bindVal, ok := params[bindKey]
		if !ok {
			return nil
		}
		return bindVal
	}
	if strings.HasPrefix(attrVal, Html_BindPrefix) {
		bindKey := attrVal[len(Html_BindPrefix):]
		if bindKey == "" {
			return nil
		}
		return &VDomBinding{Type: ObjectType_Binding, Bind: bindKey}
	}
	if strings.HasPrefix(attrVal, Html_GlobalEventPrefix) {
		splitArr := strings.Split(attrVal, ":")
		if len(splitArr) < 2 {
			return nil
		}
		eventName := splitArr[1]
		if eventName == "" {
			return nil
		}
		return &VDomFunc{Type: ObjectType_Func, GlobalEvent: eventName}
	}
	return attrVal
}

func tokenToElem(token htmltoken.Token, params map[string]any) *VDomElem {
	elem := &VDomElem{Tag: token.Data}
	if len(token.Attr) > 0 {
		elem.Props = make(map[string]any)
	}
	for _, attr := range token.Attr {
		if attr.Key == "" || attr.Val == "" {
			continue
		}
		propVal := attrToProp(attr.Val, attr.IsJson, params)
		elem.Props[attr.Key] = propVal
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

func makePathStr(elemPath []string) string {
	return strings.Join(elemPath, " ")
}

func capitalizeAscii(s string) string {
	if s == "" || s[0] < 'a' || s[0] > 'z' {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func toReactName(input string) string {
	// Check for CSS custom properties (variables) which start with '--'
	if strings.HasPrefix(input, "--") {
		return input
	}
	parts := strings.Split(input, "-")
	result := ""
	index := 0
	if parts[0] == "" && len(parts) > 1 {
		// handle vendor prefixes
		prefix := parts[1]
		if prefix == "ms" {
			result += "ms"
		} else {
			result += capitalizeAscii(prefix)
		}
		index = 2 // Skip the empty string and prefix
	} else {
		result += parts[0]
		index = 1
	}
	// Convert remaining parts to CamelCase
	for ; index < len(parts); index++ {
		if parts[index] != "" {
			result += capitalizeAscii(parts[index])
		}
	}
	return result
}

func convertStyleToReactStyles(styleMap map[string]string, params map[string]any) map[string]any {
	if len(styleMap) == 0 {
		return nil
	}
	rtn := make(map[string]any)
	for key, val := range styleMap {
		rtn[toReactName(key)] = attrToProp(val, false, params)
	}
	return rtn
}

func styleAttrStrToStyleMap(styleText string, params map[string]any) (map[string]any, error) {
	parser := cssparser.MakeParser(styleText)
	m, err := parser.Parse()
	if err != nil {
		return nil, err
	}
	return convertStyleToReactStyles(m, params), nil
}

func fixStyleAttribute(elem *VDomElem, params map[string]any, elemPath []string) error {
	styleText, ok := elem.Props["style"].(string)
	if !ok {
		return nil
	}
	styleMap, err := styleAttrStrToStyleMap(styleText, params)
	if err != nil {
		return fmt.Errorf("%v (at %s)", err, makePathStr(elemPath))
	}
	elem.Props["style"] = styleMap
	return nil
}

func fixupStyleAttributes(elem *VDomElem, params map[string]any, elemPath []string) {
	if elem == nil {
		return
	}
	// call fixStyleAttribute, and walk children
	elemCountMap := make(map[string]int)
	if len(elemPath) == 0 {
		elemPath = append(elemPath, elem.Tag)
	}
	fixStyleAttribute(elem, params, elemPath)
	for i := range elem.Children {
		child := &elem.Children[i]
		elemCountMap[child.Tag]++
		subPath := child.Tag
		if elemCountMap[child.Tag] > 1 {
			subPath = fmt.Sprintf("%s[%d]", child.Tag, elemCountMap[child.Tag])
		}
		elemPath = append(elemPath, subPath)
		fixupStyleAttributes(&elem.Children[i], params, elemPath)
		elemPath = elemPath[:len(elemPath)-1]
	}
}

func Bind(htmlStr string, params map[string]any) *VDomElem {
	htmlStr = processWhitespace(htmlStr)
	r := strings.NewReader(htmlStr)
	iter := htmltoken.NewTokenizer(r)
	var elemStack []*VDomElem
	elemStack = append(elemStack, &VDomElem{Tag: FragmentTag})
	var tokenErr error
outer:
	for {
		tokenType := iter.Next()
		token := iter.Token()
		switch tokenType {
		case htmltoken.StartTagToken:
			if token.Data == Html_BindTagName || token.Data == Html_BindParamTagName {
				tokenErr = errors.New("bind tags must be self closing")
				break outer
			}
			elem := tokenToElem(token, params)
			elemStack = pushElemStack(elemStack, elem)
		case htmltoken.EndTagToken:
			if token.Data == Html_BindTagName || token.Data == Html_BindParamTagName {
				tokenErr = errors.New("bind tags must be self closing")
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
			if token.Data == Html_BindParamTagName {
				keyAttr := getAttrString(token, "key")
				dataVal := params[keyAttr]
				elemList := partToElems(dataVal)
				for _, elem := range elemList {
					appendChildToStack(elemStack, &elem)
				}
				continue
			}
			if token.Data == Html_BindTagName {
				keyAttr := getAttrString(token, "key")
				binding := &VDomBinding{Type: ObjectType_Binding, Bind: keyAttr}
				appendChildToStack(elemStack, &VDomElem{Tag: WaveTextTag, Props: map[string]any{"text": binding}})
				continue
			}
			elem := tokenToElem(token, params)
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
	rtn := finalizeStack(elemStack)
	fixupStyleAttributes(rtn, params, nil)
	return rtn
}
