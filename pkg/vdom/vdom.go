// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"unicode"
)

// ReactNode types = nil | string | Elem

const TextTag = "#text"
const FragmentTag = "#fragment"

const ChildrenPropKey = "children"
const KeyPropKey = "key"

// doubles as VDOM structure
type Elem struct {
	Id       string         `json:"id,omitempty"` // used for vdom
	Tag      string         `json:"tag"`
	Props    map[string]any `json:"props,omitempty"`
	Children []Elem         `json:"children,omitempty"`
	Text     string         `json:"text,omitempty"`
}

type VDomRefType struct {
	RefId   string `json:"#ref"`
	Current any    `json:"current"`
}

// can be used to set preventDefault/stopPropagation
type VDomFuncType struct {
	Fn              any      `json:"-"` // the actual function to call (called via reflection)
	FuncType        string   `json:"#func"`
	StopPropagation bool     `json:"#stopPropagation,omitempty"`
	PreventDefault  bool     `json:"#preventDefault,omitempty"`
	Keys            []string `json:"#keys,omitempty"` // special for keyDown events a list of keys to "capture"
}

// generic hook structure
type Hook struct {
	Init      bool          // is initialized
	Idx       int           // index in the hook array
	Fn        func() func() // for useEffect
	UnmountFn func()        // for useEffect
	Val       any           // for useState, useMemo, useRef
	Deps      []any
}

type CFunc = func(ctx context.Context, props map[string]any) any

func (e *Elem) Key() string {
	keyVal, ok := e.Props[KeyPropKey]
	if !ok {
		return ""
	}
	keyStr, ok := keyVal.(string)
	if ok {
		return keyStr
	}
	return ""
}

func TextElem(text string) Elem {
	return Elem{Tag: TextTag, Text: text}
}

func mergeProps(props *map[string]any, newProps map[string]any) {
	if *props == nil {
		*props = make(map[string]any)
	}
	for k, v := range newProps {
		if v == nil {
			delete(*props, k)
			continue
		}
		(*props)[k] = v
	}
}

func E(tag string, parts ...any) *Elem {
	rtn := &Elem{Tag: tag}
	for _, part := range parts {
		if part == nil {
			continue
		}
		props, ok := part.(map[string]any)
		if ok {
			mergeProps(&rtn.Props, props)
			continue
		}
		elems := partToElems(part)
		rtn.Children = append(rtn.Children, elems...)
	}
	return rtn
}

func P(propName string, propVal any) map[string]any {
	return map[string]any{propName: propVal}
}

func getHookFromCtx(ctx context.Context) (*VDomContextVal, *Hook) {
	vc := getRenderContext(ctx)
	if vc == nil {
		panic("UseState must be called within a component (no context)")
	}
	if vc.Comp == nil {
		panic("UseState must be called within a component (vc.Comp is nil)")
	}
	for len(vc.Comp.Hooks) <= vc.HookIdx {
		vc.Comp.Hooks = append(vc.Comp.Hooks, &Hook{Idx: len(vc.Comp.Hooks)})
	}
	hookVal := vc.Comp.Hooks[vc.HookIdx]
	vc.HookIdx++
	return vc, hookVal
}

func UseState[T any](ctx context.Context, initialVal T) (T, func(T)) {
	vc, hookVal := getHookFromCtx(ctx)
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Val = initialVal
	}
	var rtnVal T
	rtnVal, ok := hookVal.Val.(T)
	if !ok {
		panic("UseState hook value is not a state (possible out of order or conditional hooks)")
	}
	setVal := func(newVal T) {
		hookVal.Val = newVal
		vc.Root.AddRenderWork(vc.Comp.Id)
	}
	return rtnVal, setVal
}

func UseRef(ctx context.Context, initialVal any) *VDomRefType {
	vc, hookVal := getHookFromCtx(ctx)
	if !hookVal.Init {
		hookVal.Init = true
		refId := vc.Comp.Id + ":" + strconv.Itoa(hookVal.Idx)
		hookVal.Val = &VDomRefType{RefId: refId, Current: initialVal}
	}
	refVal, ok := hookVal.Val.(*VDomRefType)
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func UseId(ctx context.Context) string {
	vc := getRenderContext(ctx)
	if vc == nil {
		panic("UseId must be called within a component (no context)")
	}
	return vc.Comp.Id
}

func depsEqual(deps1 []any, deps2 []any) bool {
	if len(deps1) != len(deps2) {
		return false
	}
	for i := range deps1 {
		if deps1[i] != deps2[i] {
			return false
		}
	}
	return true
}

func UseEffect(ctx context.Context, fn func() func(), deps []any) {
	// note UseEffect never actually runs anything, it just queues the effect to run later
	vc, hookVal := getHookFromCtx(ctx)
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.Root.AddEffectWork(vc.Comp.Id, hookVal.Idx)
		return
	}
	if depsEqual(hookVal.Deps, deps) {
		return
	}
	hookVal.Fn = fn
	hookVal.Deps = deps
	vc.Root.AddEffectWork(vc.Comp.Id, hookVal.Idx)
}

func numToString[T any](value T) (string, bool) {
	switch v := any(value).(type) {
	case int, int8, int16, int32, int64:
		return strconv.FormatInt(v.(int64), 10), true
	case uint, uint8, uint16, uint32, uint64:
		return strconv.FormatUint(v.(uint64), 10), true
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32), true
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), true
	default:
		return "", false
	}
}

func partToElems(part any) []Elem {
	if part == nil {
		return nil
	}
	switch part := part.(type) {
	case string:
		return []Elem{TextElem(part)}
	case *Elem:
		if part == nil {
			return nil
		}
		return []Elem{*part}
	case Elem:
		return []Elem{part}
	case []Elem:
		return part
	case []*Elem:
		var rtn []Elem
		for _, e := range part {
			if e == nil {
				continue
			}
			rtn = append(rtn, *e)
		}
		return rtn
	}
	sval, ok := numToString(part)
	if ok {
		return []Elem{TextElem(sval)}
	}
	partVal := reflect.ValueOf(part)
	if partVal.Kind() == reflect.Slice {
		var rtn []Elem
		for i := 0; i < partVal.Len(); i++ {
			subPart := partVal.Index(i).Interface()
			rtn = append(rtn, partToElems(subPart)...)
		}
		return rtn
	}
	stringer, ok := part.(fmt.Stringer)
	if ok {
		return []Elem{TextElem(stringer.String())}
	}
	jsonStr, jsonErr := json.Marshal(part)
	if jsonErr == nil {
		return []Elem{TextElem(string(jsonStr))}
	}
	typeText := "invalid:" + reflect.TypeOf(part).String()
	return []Elem{TextElem(typeText)}
}

func isWaveTag(tag string) bool {
	return strings.HasPrefix(tag, "wave:") || strings.HasPrefix(tag, "w:")
}

func isBaseTag(tag string) bool {
	if len(tag) == 0 {
		return false
	}
	return tag[0] == '#' || unicode.IsLower(rune(tag[0])) || isWaveTag(tag)
}
