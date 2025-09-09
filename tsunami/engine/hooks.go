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

type VDomContextImpl struct {
	Root       *RootElem
	Comp       *ComponentImpl
	HookIdx    int
	RenderOpts *RenderOpts
}

func makeContextVal(root *RootElem, comp *ComponentImpl, opts *RenderOpts) *VDomContextImpl {
	return &VDomContextImpl{Root: root, Comp: comp, HookIdx: 0, RenderOpts: opts}
}

func (vc *VDomContextImpl) GetCompWaveId() string {
	if vc.Comp == nil {
		return ""
	}
	return vc.Comp.WaveId
}

func (vc *VDomContextImpl) getOrderedHook() *Hook {
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

func (vc *VDomContextImpl) getCompName() string {
	if vc.Comp == nil || vc.Comp.Elem == nil {
		return ""
	}
	return vc.Comp.Elem.Tag
}

func UseRenderTs(vc *VDomContextImpl) int64 {
	return vc.Root.RenderTs
}

func UseId(vc *VDomContextImpl) string {
	return vc.GetCompWaveId()
}

func UseState(vc *VDomContextImpl, initialVal any) (any, func(any), func(func(any) any)) {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Val = initialVal
	}

	setVal := func(newVal any) {
		hookVal.Val = newVal
		vc.Root.AddRenderWork(vc.GetCompWaveId())
	}

	setFuncVal := func(updateFunc func(any) any) {
		hookVal.Val = updateFunc(hookVal.Val)
		vc.Root.AddRenderWork(vc.GetCompWaveId())
	}

	return hookVal.Val, setVal, setFuncVal
}

func UseAtom(vc *VDomContextImpl, atomName string) (any, func(any), func(func(any) any)) {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		closedWaveId := vc.GetCompWaveId()
		hookVal.UnmountFn = func() {
			vc.Root.AtomSetUsedBy(atomName, closedWaveId, false)
		}
	}
	vc.Root.AtomSetUsedBy(atomName, vc.GetCompWaveId(), true)
	atomVal := vc.Root.GetAtomVal(atomName)

	setVal := func(newVal any) {
		if err := vc.Root.SetAtomVal(atomName, newVal); err != nil {
			log.Printf("Failed to set atom value for %s: %v", atomName, err)
			return
		}
		vc.Root.AtomAddRenderWork(atomName)
	}

	setFuncVal := func(updateFunc func(any) any) {
		currentVal := vc.Root.GetAtomVal(atomName)
		if err := vc.Root.SetAtomVal(atomName, updateFunc(currentVal)); err != nil {
			log.Printf("Failed to set atom value for %s: %v", atomName, err)
			return
		}
		vc.Root.AtomAddRenderWork(atomName)
	}

	return atomVal, setVal, setFuncVal
}

func UseLocal(vc *VDomContextImpl, initialVal any) string {
	hookVal := vc.getOrderedHook()
	atomName := "$local." + vc.GetCompWaveId() + "#" + strconv.Itoa(hookVal.Idx)
	if !hookVal.Init {
		hookVal.Init = true
		atom := MakeAtomImpl(initialVal)
		vc.Root.RegisterAtom(atomName, atom)
		closedAtomName := atomName
		hookVal.UnmountFn = func() {
			vc.Root.RemoveAtom(closedAtomName)
		}
	}
	return atomName
}

func UseVDomRef(vc *VDomContextImpl) any {
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

func UseRef(vc *VDomContextImpl, hookInitialVal any) any {
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

func UseEffect(vc *VDomContextImpl, fn func() func(), deps []any) {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.Root.AddEffectWork(vc.GetCompWaveId(), hookVal.Idx)
		return
	}
	// If deps is nil, always run (like React with no dependency array)
	if deps == nil {
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.Root.AddEffectWork(vc.GetCompWaveId(), hookVal.Idx)
		return
	}

	if depsEqual(hookVal.Deps, deps) {
		return
	}
	hookVal.Fn = fn
	hookVal.Deps = deps
	vc.Root.AddEffectWork(vc.GetCompWaveId(), hookVal.Idx)
}

func UseResync(vc *VDomContextImpl) bool {
	if vc.RenderOpts == nil {
		return false
	}
	return vc.RenderOpts.Resync
}

func UseSetAppTitle(vc *VDomContextImpl, title string) {
	if vc.getCompName() != "App" {
		log.Printf("UseSetAppTitle can only be called from the App component")
		return
	}
	vc.Root.AppTitle = title
}
