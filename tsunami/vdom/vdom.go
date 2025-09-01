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

type styleAttrWrapper struct {
	StyleAttr string
	Val       any
}

type classAttrWrapper struct {
	ClassName string
	Cond      bool
}

type styleAttrMapWrapper struct {
	StyleAttrMap map[string]any
}

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

func mergeStyleAttr(props *map[string]any, styleAttr styleAttrWrapper) {
	if *props == nil {
		*props = make(map[string]any)
	}
	if (*props)["style"] == nil {
		(*props)["style"] = make(map[string]any)
	}
	styleMap, ok := (*props)["style"].(map[string]any)
	if !ok {
		return
	}
	styleMap[styleAttr.StyleAttr] = styleAttr.Val
}

func mergeClassAttr(props *map[string]any, classAttr classAttrWrapper) {
	if *props == nil {
		*props = make(map[string]any)
	}
	if classAttr.Cond {
		if (*props)["className"] == nil {
			(*props)["className"] = classAttr.ClassName
			return
		}
		classVal, ok := (*props)["className"].(string)
		if !ok {
			return
		}
		// check if class already exists (must split, contains won't work)
		splitArr := strings.Split(classVal, " ")
		for _, class := range splitArr {
			if class == classAttr.ClassName {
				return
			}
		}
		(*props)["className"] = classVal + " " + classAttr.ClassName
	} else {
		classVal, ok := (*props)["className"].(string)
		if !ok {
			return
		}
		splitArr := strings.Split(classVal, " ")
		for i, class := range splitArr {
			if class == classAttr.ClassName {
				splitArr = append(splitArr[:i], splitArr[i+1:]...)
				break
			}
		}
		if len(splitArr) == 0 {
			delete(*props, "className")
		} else {
			(*props)["className"] = strings.Join(splitArr, " ")
		}
	}
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

func E(tag string, parts ...any) *VDomElem {
	rtn := &VDomElem{Tag: tag}
	for _, part := range parts {
		if part == nil {
			continue
		}
		props, ok := part.(map[string]any)
		if ok {
			mergeProps(&rtn.Props, props)
			continue
		}
		if styleAttr, ok := part.(styleAttrWrapper); ok {
			mergeStyleAttr(&rtn.Props, styleAttr)
			continue
		}
		if styleAttrMap, ok := part.(styleAttrMapWrapper); ok {
			for k, v := range styleAttrMap.StyleAttrMap {
				mergeStyleAttr(&rtn.Props, styleAttrWrapper{StyleAttr: k, Val: v})
			}
			continue
		}
		if classAttr, ok := part.(classAttrWrapper); ok {
			mergeClassAttr(&rtn.Props, classAttr)
			continue
		}
		elems := PartToElems(part)
		rtn.Children = append(rtn.Children, elems...)
	}
	return rtn
}

func Class(name string) classAttrWrapper {
	return classAttrWrapper{ClassName: name, Cond: true}
}

func ClassIf(cond bool, name string) classAttrWrapper {
	return classAttrWrapper{ClassName: name, Cond: cond}
}

func ClassIfElse(cond bool, name string, elseName string) classAttrWrapper {
	if cond {
		return classAttrWrapper{ClassName: name, Cond: true}
	}
	return classAttrWrapper{ClassName: elseName, Cond: true}
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

func ForEach[T any](items []T, fn func(T) any) []any {
	var elems []any
	for _, item := range items {
		fnResult := fn(item)
		elems = append(elems, fnResult)
	}
	return elems
}

func ForEachIdx[T any](items []T, fn func(T, int) any) []any {
	var elems []any
	for idx, item := range items {
		fnResult := fn(item, idx)
		elems = append(elems, fnResult)
	}
	return elems
}

func Filter[T any](items []T, fn func(T) bool) []T {
	var elems []T
	for _, item := range items {
		if fn(item) {
			elems = append(elems, item)
		}
	}
	return elems
}

func FilterIdx[T any](items []T, fn func(T, int) bool) []T {
	var elems []T
	for idx, item := range items {
		if fn(item, idx) {
			elems = append(elems, item)
		}
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

func PStyle(styleAttr string, propVal any) any {
	return styleAttrWrapper{StyleAttr: styleAttr, Val: propVal}
}

func Fragment(parts ...any) any {
	return parts
}

func P(propName string, propVal any) any {
	if propVal == nil {
		return map[string]any{propName: nil}
	}
	if propName == "style" {
		strVal, ok := propVal.(string)
		if ok {
			styleMap, err := styleAttrStrToStyleMap(strVal, nil)
			if err == nil {
				return styleAttrMapWrapper{StyleAttrMap: styleMap}
			}
			log.Printf("Error parsing style attribute: %v\n", err)
			return nil
		}
	}
	return map[string]any{propName: propVal}
}

func UseState[T any](ctx context.Context, initialVal T) (T, func(T)) {
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
	return rtnVal, setVal
}

func UseStateWithFn[T any](ctx context.Context, initialVal T) (T, func(T), func(func(T) T)) {
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

func UseAtom[T any](ctx context.Context, atomName string) (T, func(T)) {
	vc := GetRenderContext(ctx)
	hookVal := vc.GetOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		closedWaveId := vc.GetCompWaveId()
		hookVal.UnmountFn = func() {
			atom := vc.GetAtom(atomName)
			delete(atom.UsedBy, closedWaveId)
		}
	}
	atom := vc.GetAtom(atomName)
	atom.UsedBy[vc.GetCompWaveId()] = true
	atomVal, ok := atom.Val.(T)
	if !ok {
		panic(fmt.Sprintf("UseAtom %q value type mismatch (expected %T, got %T)", atomName, atomVal, atom.Val))
	}
	setVal := func(newVal T) {
		atom.Val = newVal
		for waveId := range atom.UsedBy {
			vc.AddRenderWork(waveId)
		}
	}
	return atomVal, setVal
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
