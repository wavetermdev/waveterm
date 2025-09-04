// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdomctx"
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
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseState must be called within a component (no context)")
	}
	val, setVal, setFn := rc.UseState(ctx, initialVal)

	// Adapt the "any" values to type "T"
	var rtnVal T
	rtnVal, ok := val.(T)
	if !ok {
		panic("UseState hook value is not a state (possible out of order or conditional hooks)")
	}
	typedSetVal := func(newVal T) {
		setVal(newVal)
	}
	typedSetFuncVal := func(updateFunc func(T) T) {
		setFn(func(oldVal any) any {
			return updateFunc(oldVal.(T))
		})
	}
	return rtnVal, typedSetVal, typedSetFuncVal
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

func useAtom[T any](ctx context.Context, hookName string, atomName string) (T, func(T), func(func(T) T)) {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic(hookName + " must be called within a component (no context)")
	}
	val, setVal, setFn := rc.UseAtom(ctx, atomName)

	// Adapt the "any" values to type "T"
	atomVal := getTypedAtomValue[T](val, atomName)

	typedSetVal := func(newVal T) {
		setVal(newVal)
	}

	typedSetFuncVal := func(updateFunc func(T) T) {
		setFn(func(oldVal any) any {
			typedOldVal := getTypedAtomValue[T](oldVal, atomName)
			return updateFunc(typedOldVal)
		})
	}

	return atomVal, typedSetVal, typedSetFuncVal
}

func UseSharedAtom[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	return useAtom[T](ctx, "UseSharedAtom", "$shared."+atomName)
}

func UseConfig[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	return useAtom[T](ctx, "UseConfig", "$config."+atomName)
}

func UseData[T any](ctx context.Context, atomName string) (T, func(T), func(func(T) T)) {
	return useAtom[T](ctx, "UseData", "$data."+atomName)
}

func UseVDomRef(ctx context.Context) *VDomRef {
	rc := vdomctx.GetRenderContext(ctx)
	val := rc.UseVDomRef(ctx)
	refVal, ok := val.(*VDomRef)
	if !ok {
		panic("UseVDomRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func UseRef[T any](ctx context.Context, val T) *VDomSimpleRef[T] {
	rc := vdomctx.GetRenderContext(ctx)
	refVal := rc.UseRef(ctx, &VDomSimpleRef[T]{Current: val})
	typedRef, ok := refVal.(*VDomSimpleRef[T])
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return typedRef
}

func UseId(ctx context.Context) string {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseId must be called within a component (no context)")
	}
	return rc.UseId(ctx)
}

func UseRenderTs(ctx context.Context) int64 {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseRenderTs must be called within a component (no context)")
	}
	return rc.UseRenderTs(ctx)
}

func UseResync(ctx context.Context) bool {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseResync must be called within a component (no context)")
	}
	return rc.UseResync(ctx)
}

func UseEffect(ctx context.Context, fn func() func(), deps []any) {
	// note UseEffect never actually runs anything, it just queues the effect to run later
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseEffect must be called within a component (no context)")
	}
	rc.UseEffect(ctx, fn, deps)
}

func UseSetAppTitle(ctx context.Context, title string) {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseSetAppTitle must be called within a component (no context)")
	}
	rc.UseSetAppTitle(ctx, title)
}

func QueueRefOp(ctx context.Context, ref *VDomRef, op VDomRefOperation) {
	if ref == nil || !ref.HasCurrent {
		return
	}
	vc := vdomctx.GetRenderContext(ctx)
	if vc == nil {
		panic("QueueRefOp must be called within a component (no context)")
	}
	if op.RefId == "" {
		op.RefId = ref.RefId
	}
	vc.QueueRefOp(ctx, op)
}

func PartToElems(part any) []VDomElem {
	if part == nil {
		return nil
	}
	switch partTyped := part.(type) {
	case string:
		return []VDomElem{TextElem(partTyped)}
	case bool:
		// matches react
		if partTyped {
			return []VDomElem{TextElem("true")}
		}
		return nil
	case VDomElem:
		return []VDomElem{partTyped}
	case *VDomElem:
		if partTyped == nil {
			return nil
		}
		return []VDomElem{*partTyped}
	default:
		partVal := reflect.ValueOf(part)
		if partVal.Kind() == reflect.Slice {
			var rtn []VDomElem
			for i := 0; i < partVal.Len(); i++ {
				rtn = append(rtn, PartToElems(partVal.Index(i).Interface())...)
			}
			return rtn
		}
		return []VDomElem{TextElem(fmt.Sprint(part))}
	}
}
