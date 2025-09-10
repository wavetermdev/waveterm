// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"sync"

	"github.com/outrigdev/goid"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const (
	GlobalContextType_async  = "async"
	GlobalContextType_render = "render"
	GlobalContextType_effect = "effect"
	GlobalContextType_event  = "event"
)

// is set ONLY when we're in the render function of a component
// used for hooks, and automatic dependency tracking
var globalRenderContext *RenderContextImpl
var globalRenderGoId uint64

var globalEventContext *EventContextImpl
var globalEventGoId uint64

var globalEffectContext *EffectContextImpl
var globalEffectGoId uint64

var globalCtxMutex sync.Mutex

type EventContextImpl struct {
	Event vdom.VDomEvent
	Root  *RootElem
}

type EffectContextImpl struct {
	WorkElem EffectWorkElem
	WorkType string // "run" or "unmount"
	Root     *RootElem
}

func setGlobalRenderContext(vc *RenderContextImpl) {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalRenderContext = vc
	globalRenderGoId = goid.Get()
}

func clearGlobalRenderContext() {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalRenderContext = nil
	globalRenderGoId = 0
}

func withGlobalRenderCtx[T any](vc *RenderContextImpl, fn func() T) T {
	setGlobalRenderContext(vc)
	defer clearGlobalRenderContext()
	return fn()
}

func GetGlobalRenderContext() *RenderContextImpl {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	gid := goid.Get()
	if gid != globalRenderGoId {
		return nil
	}
	return globalRenderContext
}

func setGlobalEventContext(ec *EventContextImpl) {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalEventContext = ec
	globalEventGoId = goid.Get()
}

func clearGlobalEventContext() {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalEventContext = nil
	globalEventGoId = 0
}

func withGlobalEventCtx[T any](ec *EventContextImpl, fn func() T) T {
	setGlobalEventContext(ec)
	defer clearGlobalEventContext()
	return fn()
}

func GetGlobalEventContext() *EventContextImpl {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	gid := goid.Get()
	if gid != globalEventGoId {
		return nil
	}
	return globalEventContext
}

func setGlobalEffectContext(ec *EffectContextImpl) {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalEffectContext = ec
	globalEffectGoId = goid.Get()
}

func clearGlobalEffectContext() {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalEffectContext = nil
	globalEffectGoId = 0
}

func withGlobalEffectCtx[T any](ec *EffectContextImpl, fn func() T) T {
	setGlobalEffectContext(ec)
	defer clearGlobalEffectContext()
	return fn()
}

func GetGlobalEffectContext() *EffectContextImpl {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	gid := goid.Get()
	if gid != globalEffectGoId {
		return nil
	}
	return globalEffectContext
}

// inContextType returns the current global context type.
// Returns one of:
//   - GlobalContextType_render: when in a component render function
//   - GlobalContextType_event: when in an event handler
//   - GlobalContextType_effect: when in an effect function
//   - GlobalContextType_async: when not in any specific context (default/async)
func inContextType() string {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	
	gid := goid.Get()
	
	if globalRenderContext != nil && gid == globalRenderGoId {
		return GlobalContextType_render
	}
	
	if globalEventContext != nil && gid == globalEventGoId {
		return GlobalContextType_event
	}
	
	if globalEffectContext != nil && gid == globalEffectGoId {
		return GlobalContextType_effect
	}
	
	return GlobalContextType_async
}
