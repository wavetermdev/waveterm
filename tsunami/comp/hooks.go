// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package comp

import (
	"context"
	"log"
	"strconv"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
	"github.com/wavetermdev/waveterm/tsunami/vdomctx"
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

// Compile-time check to ensure VDomContextImpl implements vdomctx.VDomContext
var _ vdomctx.VDomContext = (*VDomContextImpl)(nil)

// Implement vdomctx.VDomContext interface methods on VDomContextImpl

func MakeContextVal(root *RootElem, comp *ComponentImpl, opts *RenderOpts) *VDomContextImpl {
	return &VDomContextImpl{Root: root, Comp: comp, HookIdx: 0, RenderOpts: opts}
}

func (vc *VDomContextImpl) getCompWaveId() string {
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

func (vc *VDomContextImpl) UseRenderTs(ctx context.Context) int64 {
	return vc.Root.RenderTs
}

func (vc *VDomContextImpl) UseId(ctx context.Context) string {
	return vc.getCompWaveId()
}

func (vc *VDomContextImpl) UseState(ctx context.Context, initialVal any) (any, func(any), func(func(any) any)) {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Val = initialVal
	}

	setVal := func(newVal any) {
		hookVal.Val = newVal
		vc.Root.AddRenderWork(vc.getCompWaveId())
	}

	setFuncVal := func(updateFunc func(any) any) {
		hookVal.Val = updateFunc(hookVal.Val)
		vc.Root.AddRenderWork(vc.getCompWaveId())
	}

	return hookVal.Val, setVal, setFuncVal
}

func (vc *VDomContextImpl) UseAtom(ctx context.Context, atomName string) (any, func(any), func(func(any) any)) {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		closedWaveId := vc.getCompWaveId()
		hookVal.UnmountFn = func() {
			vc.Root.AtomSetUsedBy(atomName, closedWaveId, false)
		}
	}
	vc.Root.AtomSetUsedBy(atomName, vc.getCompWaveId(), true)
	atomVal := vc.Root.GetAtomVal(atomName)

	setVal := func(newVal any) {
		vc.Root.SetAtomVal(atomName, newVal, true)
		vc.Root.AtomAddRenderWork(atomName)
	}

	setFuncVal := func(updateFunc func(any) any) {
		currentVal := vc.Root.GetAtomVal(atomName)
		vc.Root.SetAtomVal(atomName, updateFunc(currentVal), true)
		vc.Root.AtomAddRenderWork(atomName)
	}

	return atomVal, setVal, setFuncVal
}

func (vc *VDomContextImpl) UseVDomRef(ctx context.Context) any {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		refId := vc.getCompWaveId() + ":" + strconv.Itoa(hookVal.Idx)
		hookVal.Val = &vdom.VDomRef{Type: vdom.ObjectType_Ref, RefId: refId}
	}
	refVal, ok := hookVal.Val.(*vdom.VDomRef)
	if !ok {
		panic("UseVDomRef hook value is not a ref (possible out of order or conditional hooks)")
	}
	return refVal
}

func (vc *VDomContextImpl) UseRef(ctx context.Context, hookInitialVal any) any {
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

func (vc *VDomContextImpl) UseEffect(ctx context.Context, fn func() func(), deps []any) {
	hookVal := vc.getOrderedHook()
	if !hookVal.Init {
		hookVal.Init = true
		hookVal.Fn = fn
		hookVal.Deps = deps
		vc.Root.AddEffectWork(vc.getCompWaveId(), hookVal.Idx)
		return
	}
	if depsEqual(hookVal.Deps, deps) {
		return
	}
	hookVal.Fn = fn
	hookVal.Deps = deps
	vc.Root.AddEffectWork(vc.getCompWaveId(), hookVal.Idx)
}

func (vc *VDomContextImpl) UseResync(ctx context.Context) bool {
	if vc.RenderOpts == nil {
		return false
	}
	return vc.RenderOpts.Resync
}

func (vc *VDomContextImpl) UseSetAppTitle(ctx context.Context, title string) {
	if vc.getCompName() != "App" {
		log.Printf("UseSetAppTitle can only be called from the App component")
		return
	}
	vc.Root.AppTitle = title
}

func (vc *VDomContextImpl) QueueRefOp(ctx context.Context, op any) {
	typedOp := op.(vdom.VDomRefOperation)
	vc.Root.QueueRefOp(typedOp)
}
