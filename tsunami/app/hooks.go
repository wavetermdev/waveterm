// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/engine"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// UseVDomRef provides a reference to a DOM element in the VDOM tree.
// It returns a VDomRef that can be attached to elements for direct DOM access.
// The ref will not be current on the first render - refs are set and become
// current after client-side mounting.
// This hook must be called within a component context.
func UseVDomRef() *vdom.VDomRef {
	rc := engine.GetGlobalRenderContext()
	val := engine.UseVDomRef(rc)
	refVal, ok := val.(*vdom.VDomRef)
	if !ok {
		panic("UseVDomRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

// UseRef is the tsunami analog to React's useRef hook.
// It provides a mutable ref object that persists across re-renders.
// Unlike UseVDomRef, this is not tied to DOM elements but holds arbitrary values.
// This hook must be called within a component context.
func UseRef[T any](val T) *vdom.VDomSimpleRef[T] {
	rc := engine.GetGlobalRenderContext()
	refVal := engine.UseRef(rc, &vdom.VDomSimpleRef[T]{Current: val})
	typedRef, ok := refVal.(*vdom.VDomSimpleRef[T])
	if !ok {
		panic("UseRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return typedRef
}

// UseId returns the underlying component's unique identifier (UUID).
// The ID persists across re-renders but is recreated when the component
// is recreated, following React component lifecycle.
// This hook must be called within a component context.
func UseId() string {
	rc := engine.GetGlobalRenderContext()
	if rc == nil {
		panic("UseId must be called within a component (no context)")
	}
	return engine.UseId(rc)
}

// UseRenderTs returns the timestamp of the current render.
// This hook must be called within a component context.
func UseRenderTs() int64 {
	rc := engine.GetGlobalRenderContext()
	if rc == nil {
		panic("UseRenderTs must be called within a component (no context)")
	}
	return engine.UseRenderTs(rc)
}

// UseResync returns whether the current render is a resync operation.
// Resyncs happen on initial app loads or full refreshes, as opposed to
// incremental renders which happen otherwise.
// This hook must be called within a component context.
func UseResync() bool {
	rc := engine.GetGlobalRenderContext()
	if rc == nil {
		panic("UseResync must be called within a component (no context)")
	}
	return engine.UseResync(rc)
}

// UseEffect is the tsunami analog to React's useEffect hook.
// It queues effects to run after the render cycle completes.
// The function can return a cleanup function that runs before the next effect
// or when the component unmounts. Dependencies use shallow comparison, just like React.
// This hook must be called within a component context.
func UseEffect(fn func() func(), deps []any) {
	// note UseEffect never actually runs anything, it just queues the effect to run later
	rc := engine.GetGlobalRenderContext()
	if rc == nil {
		panic("UseEffect must be called within a component (no context)")
	}
	engine.UseEffect(rc, fn, deps)
}

// UseLocal creates a component-local atom that is automatically cleaned up when the component unmounts.
// The atom is created with a unique name based on the component's wave ID and hook index.
// This hook must be called within a component context.
func UseLocal[T any](initialVal T) Atom[T] {
	rc := engine.GetGlobalRenderContext()
	if rc == nil {
		panic("UseLocal must be called within a component (no context)")
	}
	atomName := engine.UseLocal(rc, initialVal)
	return Atom[T]{
		name:   atomName,
		client: engine.GetDefaultClient(),
	}
}

// UseGoRoutine manages a goroutine lifecycle within a component.
// It spawns a new goroutine with the provided function when dependencies change,
// and automatically cancels the context on dependency changes or component unmount.
// This hook must be called within a component context.
func UseGoRoutine(fn func(ctx context.Context), deps []any) {
	rc := engine.GetGlobalRenderContext()
	if rc == nil {
		panic("UseGoRoutine must be called within a component (no context)")
	}

	// Use UseRef to store the cancel function
	cancelRef := UseRef[context.CancelFunc](nil)

	UseEffect(func() func() {
		// Cancel any existing goroutine
		if cancelRef.Current != nil {
			cancelRef.Current()
		}

		// Create new context and start goroutine
		ctx, cancel := context.WithCancel(context.Background())
		cancelRef.Current = cancel

		componentName := "unknown"
		if rc.Comp != nil && rc.Comp.Elem != nil {
			componentName = rc.Comp.Elem.Tag
		}

		go func() {
			defer func() {
				util.PanicHandler(fmt.Sprintf("UseGoRoutine in component '%s'", componentName), recover())
			}()
			fn(ctx)
		}()

		// Return cleanup function that cancels the context
		return func() {
			if cancel != nil {
				cancel()
			}
		}
	}, deps)
}

// UseTicker manages a ticker lifecycle within a component.
// It creates a ticker that calls the provided function at regular intervals.
// The ticker is automatically stopped on dependency changes or component unmount.
// This hook must be called within a component context.
func UseTicker(interval time.Duration, tickFn func(), deps []any) {
	UseGoRoutine(func(ctx context.Context) {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickFn()
			}
		}
	}, deps)
}

// UseAfter manages a timeout lifecycle within a component.
// It creates a timer that calls the provided function after the specified duration.
// The timer is automatically canceled on dependency changes or component unmount.
// This hook must be called within a component context.
func UseAfter(duration time.Duration, timeoutFn func(), deps []any) {
	UseGoRoutine(func(ctx context.Context) {
		timer := time.NewTimer(duration)
		defer timer.Stop()

		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			timeoutFn()
		}
	}, deps)
}
