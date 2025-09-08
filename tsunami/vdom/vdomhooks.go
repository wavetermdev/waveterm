// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"

	"github.com/wavetermdev/waveterm/tsunami/vdomctx"
)

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
