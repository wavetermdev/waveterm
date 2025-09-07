// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"fmt"
	"reflect"
	"strings"

	"github.com/wavetermdev/waveterm/tsunami/vdomctx"
)

// ReactNode types = nil | string | Elem

type Component[P any] func(props P) *VDomElem

// Key returns the key property of the VDomElem as a string.
// Returns an empty string if the key is not set, otherwise converts the key value to string using fmt.Sprint.
func (e *VDomElem) Key() string {
	keyVal, ok := e.Props[KeyPropKey]
	if !ok {
		return ""
	}
	return fmt.Sprint(keyVal)
}

// WithKey sets the key property of the VDomElem and returns the element.
// This is particularly useful for defined components since their prop types won't include keys.
// Returns nil if the element is nil, otherwise returns the same element for chaining.
func (e *VDomElem) WithKey(key any) *VDomElem {
	if e == nil {
		return nil
	}
	if e.Props == nil {
		e.Props = make(map[string]any)
	}
	e.Props[KeyPropKey] = fmt.Sprint(key)
	return e
}

func textElem(text string) VDomElem {
	return VDomElem{Tag: TextTag, Text: text}
}

func partToClasses(class any) []string {
	if class == nil {
		return nil
	}
	switch c := class.(type) {
	case string:
		if c != "" {
			return []string{c}
		}
	case []string:
		var parts []string
		for _, s := range c {
			if s != "" {
				parts = append(parts, s)
			}
		}
		return parts
	case map[string]bool:
		var parts []string
		for k, v := range c {
			if v && k != "" {
				parts = append(parts, k)
			}
		}
		return parts
	case []any:
		var parts []string
		for _, item := range c {
			parts = append(parts, partToClasses(item)...)
		}
		return parts
	}
	return nil
}

// Classes combines multiple class values into a single space-separated string.
// Similar to the JavaScript clsx library, it accepts:
//   - strings: added directly if non-empty
//   - nil: ignored (useful for vdom.If() statements)
//   - []string: all non-empty strings are added
//   - map[string]bool: keys with true values are added
//   - []any: recursively processed
//
// Returns a space-separated string of all valid class names.
func Classes(classes ...any) string {
	var parts []string
	for _, class := range classes {
		parts = append(parts, partToClasses(class)...)
	}
	return strings.Join(parts, " ")
}

// H creates a VDomElem with the specified tag, properties, and children.
// This is the primary function for creating virtual DOM elements.
// Children can be strings, VDomElems, *VDomElem, slices, booleans, numeric types,
// or other types which are converted to strings using fmt.Sprint.
// nil children are allowed and removed from the final list.
func H(tag string, props map[string]any, children ...any) *VDomElem {
	rtn := &VDomElem{Tag: tag, Props: props}
	if len(children) > 0 {
		for _, part := range children {
			elems := ToElems(part)
			rtn.Children = append(rtn.Children, elems...)
		}
	}
	return rtn
}

// If returns the provided part if the condition is true, otherwise returns nil.
// This is useful for conditional rendering in VDOM children lists, props, and style attributes.
func If(cond bool, part any) any {
	if cond {
		return part
	}
	return nil
}

// IfElse returns part if the condition is true, otherwise returns elsePart.
// This provides ternary-like conditional logic for VDOM children, props, and attributes.
// Accepts mixed types - part and elsePart don't need to be the same type, which is especially useful for children.
func IfElse(cond bool, part any, elsePart any) any {
	if cond {
		return part
	}
	return elsePart
}

// Ternary returns trueRtn if the condition is true, otherwise returns falseRtn.
// Unlike IfElse, this enforces type safety by requiring both return values to be the same type T.
func Ternary[T any](cond bool, trueRtn T, falseRtn T) T {
	if cond {
		return trueRtn
	} else {
		return falseRtn
	}
}

// ForEach applies a function to each item in a slice and returns a slice of results.
// The function receives the item and its index, and can return any type for flexible VDOM generation.
func ForEach[T any](items []T, fn func(T, int) any) []any {
	elems := make([]any, 0, len(items))
	for idx, item := range items {
		fnResult := fn(item, idx)
		elems = append(elems, fnResult)
	}
	return elems
}

// UseState is the tsunami analog to React's useState hook.
// It provides persistent state management within a VDOM component, returning the current
// state value, a setter function, and an updater function.
// Setting a new value causes a re-render of the component.
// This hook must be called within a component context.
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

// UseVDomRef provides a reference to a DOM element in the VDOM tree.
// It returns a VDomRef that can be attached to elements for direct DOM access.
// The ref will not be current on the first render - refs are set and become
// current after client-side mounting.
// This hook must be called within a component context.
func UseVDomRef(ctx context.Context) *VDomRef {
	rc := vdomctx.GetRenderContext(ctx)
	val := rc.UseVDomRef(ctx)
	refVal, ok := val.(*VDomRef)
	if !ok {
		panic("UseVDomRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

// UseRef is the tsunami analog to React's useRef hook.
// It provides a mutable ref object that persists across re-renders.
// Unlike UseVDomRef, this is not tied to DOM elements but holds arbitrary values.
// This hook must be called within a component context.
func UseRef[T any](ctx context.Context, val T) *VDomSimpleRef[T] {
	rc := vdomctx.GetRenderContext(ctx)
	refVal := rc.UseRef(ctx, &VDomSimpleRef[T]{Current: val})
	typedRef, ok := refVal.(*VDomSimpleRef[T])
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return typedRef
}

// UseId returns the underlying component's unique identifier (UUID).
// The ID persists across re-renders but is recreated when the component
// is recreated, following React component lifecycle.
// This hook must be called within a component context.
func UseId(ctx context.Context) string {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseId must be called within a component (no context)")
	}
	return rc.UseId(ctx)
}

// UseRenderTs returns the timestamp of the current render.
// This hook must be called within a component context.
func UseRenderTs(ctx context.Context) int64 {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseRenderTs must be called within a component (no context)")
	}
	return rc.UseRenderTs(ctx)
}

// UseResync returns whether the current render is a resync operation.
// Resyncs happen on initial app loads or full refreshes, as opposed to
// incremental renders which happen otherwise.
// This hook must be called within a component context.
func UseResync(ctx context.Context) bool {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseResync must be called within a component (no context)")
	}
	return rc.UseResync(ctx)
}

// UseEffect is the tsunami analog to React's useEffect hook.
// It queues effects to run after the render cycle completes.
// The function can return a cleanup function that runs before the next effect
// or when the component unmounts. Dependencies use shallow comparison, just like React.
// This hook must be called within a component context.
func UseEffect(ctx context.Context, fn func() func(), deps []any) {
	// note UseEffect never actually runs anything, it just queues the effect to run later
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseEffect must be called within a component (no context)")
	}
	rc.UseEffect(ctx, fn, deps)
}

// UseSetAppTitle sets the application title for the current component.
// This hook must be called within a component context.
func UseSetAppTitle(ctx context.Context, title string) {
	rc := vdomctx.GetRenderContext(ctx)
	if rc == nil {
		panic("UseSetAppTitle must be called within a component (no context)")
	}
	rc.UseSetAppTitle(ctx, title)
}

// QueueRefOp queues a reference operation to be executed on the DOM element.
// Operations include actions like "focus", "scrollIntoView", etc.
// If the ref is nil or not current, the operation is ignored.
// This function must be called within a component context.
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

// ToElems converts various types into VDomElem slices for use in VDOM children.
// It handles strings, booleans, VDomElems, *VDomElem, slices, and other types
// by converting them to appropriate VDomElem representations.
// nil values are ignored and removed from the final slice.
// This is primarily an internal function and not typically called directly by application code.
func ToElems(part any) []VDomElem {
	if part == nil {
		return nil
	}
	switch partTyped := part.(type) {
	case string:
		return []VDomElem{textElem(partTyped)}
	case bool:
		// matches react
		if partTyped {
			return []VDomElem{textElem("true")}
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
				rtn = append(rtn, ToElems(partVal.Index(i).Interface())...)
			}
			return rtn
		}
		return []VDomElem{textElem(fmt.Sprint(part))}
	}
}
