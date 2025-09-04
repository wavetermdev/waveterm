// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"
	"unicode"

	"github.com/wavetermdev/waveterm/tsunami/util"
)

// ReactNode types = nil | string | Elem

type Component[P any] func(props P) *VDomElem

func (e *VDomElem) Key() string {
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

func (e *VDomElem) WithKey(key string) *VDomElem {
	if e == nil {
		return nil
	}
	if e.Props == nil {
		e.Props = make(map[string]any)
	}
	e.Props[KeyPropKey] = key
	return e
}

func TextElem(text string) VDomElem {
	return VDomElem{Tag: TextTag, Text: text}
}

func Classes(classes ...any) string {
	var parts []string
	for _, class := range classes {
		switch c := class.(type) {
		case nil:
			continue
		case string:
			if c != "" {
				parts = append(parts, c)
			}
		}
		// Ignore any other types
	}
	return strings.Join(parts, " ")
}

func H(tag string, props map[string]any, children ...any) *VDomElem {
	rtn := &VDomElem{Tag: tag, Props: props}
	if len(children) > 0 {
		for _, part := range children {
			elems := PartToElems(part)
			rtn.Children = append(rtn.Children, elems...)
		}
	}
	return rtn
}

func If(cond bool, part any) any {
	if cond {
		return part
	}
	return nil
}

func IfElse(cond bool, part any, elsePart any) any {
	if cond {
		return part
	}
	return elsePart
}

func Ternary[T any](cond bool, trueRtn T, falseRtn T) T {
	if cond {
		return trueRtn
	} else {
		return falseRtn
	}
}

func ForEach[T any](items []T, fn func(T, int) any) []any {
	elems := make([]any, len(items))
	for idx, item := range items {
		fnResult := fn(item, idx)
		elems = append(elems, fnResult)
	}
	return elems
}

func Props(props any) map[string]any {
	m, err := util.StructToMap(props)
	if err != nil {
		return nil
	}
	return m
}

func UseState[T any](ctx context.Context, initialVal T) (T, func(T), func(func(T) T)) {
	vc := GetRenderContext(ctx)
	hookVal := vc.GetOrderedHook()
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
		vc.AddRenderWork(vc.GetCompWaveId())
	}

	setFuncVal := func(updateFunc func(T) T) {
		hookVal.Val = updateFunc(hookVal.Val.(T))
		vc.AddRenderWork(vc.GetCompWaveId())
	}

	return rtnVal, setVal, setFuncVal
}

func getTypedAtomValue[T any](rawVal any, atomName string) T {
	var result T
	if rawVal == nil {
		return *new(T)
	}

	var ok bool
	result, ok = rawVal.(T)
	if !ok {
		// Try converting from float64 if rawVal is float64
		if f64Val, isFloat64 := rawVal.(float64); isFloat64 {
			if converted, convOk := util.FromFloat64[T](f64Val); convOk {
				return converted
			}
		}
		panic(fmt.Sprintf("UseAtom %q value type mismatch (expected %T, got %T)", atomName, *new(T), rawVal))
	}
	return result
}

func useAtom[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	vc := GetRenderContext(ctx)
	hookVal := vc.GetOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		closedWaveId := vc.GetCompWaveId()
		hookVal.UnmountFn = func() {
			vc.AtomSetUsedBy(atomName, closedWaveId, false)
		}
	}
	vc.AtomSetUsedBy(atomName, vc.GetCompWaveId(), true)
	atomVal := getTypedAtomValue[T](vc.GetAtomVal(atomName), atomName)
	setVal := func(newVal T) {
		vc.SetAtomVal(atomName, newVal, true)
		vc.AtomAddRenderWork(atomName)
	}
	setFuncVal := func(updateFunc func(T) T) {
		currentVal := getTypedAtomValue[T](vc.GetAtomVal(atomName), atomName)
		vc.SetAtomVal(atomName, updateFunc(currentVal), true)
		vc.AtomAddRenderWork(atomName)
	}
	return atomVal, setVal, setFuncVal
}

func UseSharedAtom[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	return useAtom[T](ctx, "$shared."+atomName)
}

func UseConfig[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	return useAtom[T](ctx, "$config."+atomName)
}

func UseData[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	return useAtom[T](ctx, "$data."+atomName)
}

func UseVDomRef(ctx context.Context) *VDomRef {
	vc := GetRenderContext(ctx)
	hookVal := vc.GetOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		refId := vc.GetCompWaveId() + ":" + strconv.Itoa(hookVal.Idx)
		hookVal.Val = &VDomRef{Type: ObjectType_Ref, RefId: refId}
	}
	refVal, ok := hookVal.Val.(*VDomRef)
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func UseRef[T any](ctx context.Context, val T) *VDomSimpleRef[T] {
	vc := GetRenderContext(ctx)
	hookVal := vc.GetOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Val = &VDomSimpleRef[T]{Current: val}
	}
	refVal, ok := hookVal.Val.(*VDomSimpleRef[T])
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func UseId(ctx context.Context) string {
	vc := GetRenderContext(ctx)
	if vc == nil {
		panic("UseId must be called within a component (no context)")
	}
	return vc.GetCompWaveId()
}

func UseRenderTs(ctx context.Context) int64 {
	vc := GetRenderContext(ctx)
	if vc == nil {
		panic("UseRenderTs must be called within a component (no context)")
	}
	return vc.GetRenderTs()
}

func UseResync(ctx context.Context) bool {
	vc := GetRenderContext(ctx)
	if vc == nil {
		panic("UseResync must be called within a component (no context)")
	}
	return vc.IsResync()
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
	vc := GetRenderContext(ctx)
	hookVal := vc.GetOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.AddEffectWork(vc.GetCompWaveId(), hookVal.Idx)
		return
	}
	if depsEqual(hookVal.Deps, deps) {
		return
	}
	hookVal.Fn = fn
	hookVal.Deps = deps
	vc.AddEffectWork(vc.GetCompWaveId(), hookVal.Idx)
}

func UseSetAppTitle(ctx context.Context, title string) {
	vc := GetRenderContext(ctx)
	if vc == nil {
		log.Printf("UseSetAppTitle must be called within a component (no context)")
		return
	}

	// Check if this is being called from the App component
	if vc.GetCompName() != "App" {
		log.Printf("UseSetAppTitle can only be called from the App component")
		return
	}

	// Set the title on the RootElem
	vc.SetAppTitle(title)
}

func PartToElems(part any) []VDomElem {
	if part == nil {
		return nil
	}
	switch partTyped := part.(type) {
	case string:
		return []VDomElem{TextElem(partTyped)}
	case VDomElem:
		return []VDomElem{partTyped}
	case *VDomElem:
		if partTyped == nil {
			return nil
		}
		return []VDomElem{*partTyped}
	case []VDomElem:
		return partTyped
	case []*VDomElem:
		var rtn []VDomElem
		for _, elem := range partTyped {
			if elem != nil {
				rtn = append(rtn, *elem)
			}
		}
		return rtn
	case []any:
		var rtn []VDomElem
		for _, subPart := range partTyped {
			rtn = append(rtn, PartToElems(subPart)...)
		}
		return rtn
	default:
		partVal := reflect.ValueOf(part)
		if partVal.Kind() == reflect.Slice {
			var rtn []VDomElem
			for i := 0; i < partVal.Len(); i++ {
				rtn = append(rtn, PartToElems(partVal.Index(i).Interface())...)
			}
			return rtn
		}
		strVal, ok := util.NumToString(part)
		if ok {
			return []VDomElem{TextElem(strVal)}
		}
		return nil
	}
}

func IsBaseTag(tag string) bool {
	if tag == "" {
		return false
	}
	if tag == TextTag || tag == WaveTextTag || tag == WaveNullTag || tag == FragmentTag {
		return true
	}
	if tag[0] == '#' {
		return true
	}
	firstChar := rune(tag[0])
	return unicode.IsLower(firstChar)
}
