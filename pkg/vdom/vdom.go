// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// ReactNode types = nil | string | Elem

// generic hook structure
type Hook struct {
	Init      bool          // is initialized
	Idx       int           // index in the hook array
	Fn        func() func() // for useEffect
	UnmountFn func()        // for useEffect
	Val       any           // for useState, useMemo, useRef
	Deps      []any
}

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
		elems := partToElems(part)
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

func Props(props any) map[string]any {
	m, err := utilfn.StructToMap(props)
	if err != nil {
		return nil
	}
	return m
}

func PStyle(styleAttr string, propVal any) any {
	return styleAttrWrapper{StyleAttr: styleAttr, Val: propVal}
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
		vc.Root.AddRenderWork(vc.Comp.WaveId)
	}
	return rtnVal, setVal
}

func UseStateWithFn[T any](ctx context.Context, initialVal T) (T, func(T), func(func(T) T)) {
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
		vc.Root.AddRenderWork(vc.Comp.WaveId)
	}

	setFuncVal := func(updateFunc func(T) T) {
		hookVal.Val = updateFunc(hookVal.Val.(T))
		vc.Root.AddRenderWork(vc.Comp.WaveId)
	}

	return rtnVal, setVal, setFuncVal
}

func UseAtom[T any](ctx context.Context, atomName string) (T, func(T)) {
	vc, hookVal := getHookFromCtx(ctx)
	if !hookVal.Init {
		hookVal.Init = true
		closedWaveId := vc.Comp.WaveId
		hookVal.UnmountFn = func() {
			atom := vc.Root.GetAtom(atomName)
			delete(atom.UsedBy, closedWaveId)
		}
	}
	atom := vc.Root.GetAtom(atomName)
	atom.UsedBy[vc.Comp.WaveId] = true
	atomVal, ok := atom.Val.(T)
	if !ok {
		panic(fmt.Sprintf("UseAtom %q value type mismatch (expected %T, got %T)", atomName, atomVal, atom.Val))
	}
	setVal := func(newVal T) {
		atom.Val = newVal
		for waveId := range atom.UsedBy {
			vc.Root.AddRenderWork(waveId)
		}
	}
	return atomVal, setVal
}

func UseVDomRef(ctx context.Context) *VDomRef {
	vc, hookVal := getHookFromCtx(ctx)
	if !hookVal.Init {
		hookVal.Init = true
		refId := vc.Comp.WaveId + ":" + strconv.Itoa(hookVal.Idx)
		hookVal.Val = &VDomRef{Type: ObjectType_Ref, RefId: refId}
	}
	refVal, ok := hookVal.Val.(*VDomRef)
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func UseRef[T any](ctx context.Context, val T) *VDomSimpleRef[T] {
	_, hookVal := getHookFromCtx(ctx)
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
	vc := getRenderContext(ctx)
	if vc == nil {
		panic("UseId must be called within a component (no context)")
	}
	return vc.Comp.WaveId
}

func UseRenderTs(ctx context.Context) int64 {
	vc := getRenderContext(ctx)
	if vc == nil {
		panic("UseRenderTs must be called within a component (no context)")
	}
	return vc.Root.RenderTs
}

func QueueRefOp(ctx context.Context, ref *VDomRef, op VDomRefOperation) {
	if ref == nil || !ref.HasCurrent {
		return
	}
	vc := getRenderContext(ctx)
	if vc == nil {
		panic("QueueRefOp must be called within a component (no context)")
	}
	if op.RefId == "" {
		op.RefId = ref.RefId
	}
	vc.Root.QueueRefOp(op)
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
		vc.Root.AddEffectWork(vc.Comp.WaveId, hookVal.Idx)
		return
	}
	if depsEqual(hookVal.Deps, deps) {
		return
	}
	hookVal.Fn = fn
	hookVal.Deps = deps
	vc.Root.AddEffectWork(vc.Comp.WaveId, hookVal.Idx)
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

func partToElems(part any) []VDomElem {
	if part == nil {
		return nil
	}
	switch part := part.(type) {
	case string:
		return []VDomElem{TextElem(part)}
	case *VDomElem:
		if part == nil {
			return nil
		}
		return []VDomElem{*part}
	case VDomElem:
		return []VDomElem{part}
	case []VDomElem:
		return part
	case []*VDomElem:
		var rtn []VDomElem
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
		return []VDomElem{TextElem(sval)}
	}
	partVal := reflect.ValueOf(part)
	if partVal.Kind() == reflect.Slice {
		var rtn []VDomElem
		for i := 0; i < partVal.Len(); i++ {
			subPart := partVal.Index(i).Interface()
			rtn = append(rtn, partToElems(subPart)...)
		}
		return rtn
	}
	stringer, ok := part.(fmt.Stringer)
	if ok {
		return []VDomElem{TextElem(stringer.String())}
	}
	jsonStr, jsonErr := json.Marshal(part)
	if jsonErr == nil {
		return []VDomElem{TextElem(string(jsonStr))}
	}
	typeText := "invalid:" + reflect.TypeOf(part).String()
	return []VDomElem{TextElem(typeText)}
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
