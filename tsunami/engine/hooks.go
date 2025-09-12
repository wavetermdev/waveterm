// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"log"
	"strconv"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// generic hook structure
type Hook struct {
	Init      bool          // is initialized
	Idx       int           // index in the hook array
	Fn        func() func() // for useEffect
	UnmountFn func()        // for useEffect
	Val       any           // for useState, useMemo, useRef
	Deps      []any
}

type RenderContextImpl struct {
	Root       *RootElem
	Comp       *ComponentImpl
	HookIdx    int
	RenderOpts *RenderOpts
	UsedAtoms  map[string]bool // Track atoms used during this render
}

func makeContextVal(root *RootElem, comp *ComponentImpl, opts *RenderOpts) *RenderContextImpl {
	return &RenderContextImpl{
		Root:       root,
		Comp:       comp,
		HookIdx:    0,
		RenderOpts: opts,
		UsedAtoms:  make(map[string]bool),
	}
}

func (vc *RenderContextImpl) GetCompWaveId() string {
	if vc.Comp == nil {
		return ""
	}
	return vc.Comp.WaveId
}

func (vc *RenderContextImpl) getOrderedHook() *Hook {
	if vc.Comp == nil {
		panic("tsunami hooks must be called within a component (vc.Comp is nil)")
	}
	for len(vc.Comp.Hooks) <= vc.HookIdx {
		vc.Comp.Hooks = append(vc.Comp.Hooks, &Hook{Idx: len(vc.Comp.Hooks)})
	}
	hookVal := vc.Comp.Hooks[vc.HookIdx]
	vc.HookIdx++
	return hookVal
}

func (vc *RenderContextImpl) getCompName() string {
	if vc.Comp == nil || vc.Comp.Elem == nil {
		return ""
	}
	return vc.Comp.Elem.Tag
}

func UseRenderTs(vc *RenderContextImpl) int64 {
	return vc.Root.RenderTs
}

func UseId(vc *RenderContextImpl) string {
	return vc.GetCompWaveId()
}

func UseLocal(vc *RenderContextImpl, initialVal any) string {
	hookVal := vc.getOrderedHook()
	atomName := "$local." + vc.GetCompWaveId() + "#" + strconv.Itoa(hookVal.Idx)
	if !hookVal.Init {
		hookVal.Init = true
		atom := MakeAtomImpl(initialVal, nil)
		vc.Root.RegisterAtom(atomName, atom)
		closedAtomName := atomName
		hookVal.UnmountFn = func() {
			vc.Root.RemoveAtom(closedAtomName)
		}
	}
	return atomName
}

func UseVDomRef(vc *RenderContextImpl) any {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		refId := vc.GetCompWaveId() + ":" + strconv.Itoa(hookVal.Idx)
		hookVal.Val = &vdom.VDomRef{Type: vdom.ObjectType_Ref, RefId: refId}
	}
	refVal, ok := hookVal.Val.(*vdom.VDomRef)
	if !ok {
		panic("UseVDomRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func UseRef(vc *RenderContextImpl, hookInitialVal any) any {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Val = hookInitialVal
	}
	return hookVal.Val
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

func UseEffect(vc *RenderContextImpl, fn func() func(), deps []any) {
	hookVal := vc.getOrderedHook()
	compTag := ""
	if vc.Comp != nil {
		compTag = vc.Comp.Tag
	}
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.Root.addEffectWork(vc.GetCompWaveId(), hookVal.Idx, compTag)
		return
	}
	// If deps is nil, always run (like React with no dependency array)
	if deps == nil {
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.Root.addEffectWork(vc.GetCompWaveId(), hookVal.Idx, compTag)
		return
	}

	if depsEqual(hookVal.Deps, deps) {
		return
	}
	hookVal.Fn = fn
	hookVal.Deps = deps
	vc.Root.addEffectWork(vc.GetCompWaveId(), hookVal.Idx, compTag)
}

func UseResync(vc *RenderContextImpl) bool {
	if vc.RenderOpts == nil {
		return false
	}
	return vc.RenderOpts.Resync
}

func UseSetAppTitle(vc *RenderContextImpl, title string) {
	if vc.getCompName() != "App" {
		log.Printf("UseSetAppTitle can only be called from the App component")
		return
	}
	vc.Root.AppTitle = title
}
