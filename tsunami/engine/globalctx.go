// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"sync"

	"github.com/outrigdev/goid"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// is set ONLY when we're in the render function of a component
// used for hooks, and automatic dependency tracking
var globalRenderContext *RenderContextImpl
var globalRenderGoId uint64

var globalEventContext *EventContextImpl
var globalEventGoId uint64

var globalCtxMutex sync.Mutex

type EventContextImpl struct {
	Event vdom.VDomEvent
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
