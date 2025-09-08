// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"sync"

	"github.com/outrigdev/goid"
)

// is set ONLY when we're in the render function of a component
// used for hooks, and automatic dependency tracking
var globalVC *VDomContextImpl
var globalRenderGoId uint64
var globalCtxMutex sync.Mutex

func setGlobalContext(vc *VDomContextImpl) {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalVC = vc
	globalRenderGoId = goid.Get()
}

func clearGlobalContext() {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	globalVC = nil
	globalRenderGoId = 0
}

func withGlobalCtx[T any](vc *VDomContextImpl, fn func() T) T {
	setGlobalContext(vc)
	defer clearGlobalContext()
	return fn()
}

func GetGlobalContext() *VDomContextImpl {
	globalCtxMutex.Lock()
	defer globalCtxMutex.Unlock()
	gid := goid.Get()
	if gid != globalRenderGoId {
		return nil
	}
	return globalVC
}
