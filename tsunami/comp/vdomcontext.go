// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package comp

import "github.com/wavetermdev/waveterm/tsunami/vdom"

type VDomContextVal struct {
	Root    *RootElem
	Comp    *ComponentImpl
	HookIdx int
}

func MakeContextVal(root *RootElem, comp *ComponentImpl) *VDomContextVal {
	return &VDomContextVal{Root: root, Comp: comp, HookIdx: 0}
}

// Compile-time check to ensure VDomContextVal implements vdom.VDomContext
var _ vdom.VDomContext = (*VDomContextVal)(nil)

func (vc *VDomContextVal) AddRenderWork(id string) {
	vc.Root.AddRenderWork(id)
}

func (vc *VDomContextVal) AddEffectWork(id string, effectIndex int) {
	vc.Root.AddEffectWork(id, effectIndex)
}

func (vc *VDomContextVal) GetAtom(atomName string) *vdom.Atom {
	return vc.Root.GetAtom(atomName)
}

func (vc *VDomContextVal) GetRenderTs() int64 {
	return vc.Root.RenderTs
}

func (vc *VDomContextVal) GetCompWaveId() string {
	if vc.Comp == nil {
		return ""
	}
	return vc.Comp.WaveId
}

func (vc *VDomContextVal) GetOrderedHook() *vdom.Hook {
	if vc.Comp == nil {
		panic("tsunami hooks must be called within a component (vc.Comp is nil)")
	}
	for len(vc.Comp.Hooks) <= vc.HookIdx {
		vc.Comp.Hooks = append(vc.Comp.Hooks, &vdom.Hook{Idx: len(vc.Comp.Hooks)})
	}
	hookVal := vc.Comp.Hooks[vc.HookIdx]
	vc.HookIdx++
	return hookVal
}
