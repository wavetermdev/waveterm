// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"fmt"
	"log"
	"reflect"

	"github.com/google/uuid"
)

type vdomContextKeyType struct{}

var vdomContextKey = vdomContextKeyType{}

type VDomContextVal struct {
	Root    *RootElem
	Comp    *Component
	HookIdx int
}

type RootElem struct {
	OuterCtx        context.Context
	Root            *Component
	CFuncs          map[string]CFunc
	CompMap         map[string]*Component // component id -> component
	EffectWorkQueue []*EffectWorkElem
	NeedsRenderMap  map[string]bool
}

const (
	WorkType_Render = "render"
	WorkType_Effect = "effect"
)

type EffectWorkElem struct {
	Id          string
	EffectIndex int
}

func (r *RootElem) AddRenderWork(id string) {
	if r.NeedsRenderMap == nil {
		r.NeedsRenderMap = make(map[string]bool)
	}
	r.NeedsRenderMap[id] = true
}

func (r *RootElem) AddEffectWork(id string, effectIndex int) {
	r.EffectWorkQueue = append(r.EffectWorkQueue, &EffectWorkElem{Id: id, EffectIndex: effectIndex})
}

func MakeRoot() *RootElem {
	return &RootElem{
		Root:    nil,
		CFuncs:  make(map[string]CFunc),
		CompMap: make(map[string]*Component),
	}
}

func (r *RootElem) SetOuterCtx(ctx context.Context) {
	r.OuterCtx = ctx
}

func (r *RootElem) RegisterComponent(name string, cfunc CFunc) {
	r.CFuncs[name] = cfunc
}

func (r *RootElem) Render(elem *Elem) {
	log.Printf("Render %s\n", elem.Tag)
	r.render(elem, &r.Root)
}

func (r *RootElem) Event(id string, propName string) {
	comp := r.CompMap[id]
	if comp == nil || comp.Elem == nil {
		return
	}
	fnVal := comp.Elem.Props[propName]
	if fnVal == nil {
		return
	}
	fn, ok := fnVal.(func())
	if !ok {
		return
	}
	fn()
}

// this will be called by the frontend to say the DOM has been mounted
// it will eventually send any updated "refs" to the backend as well
func (r *RootElem) runWork() {
	workQueue := r.EffectWorkQueue
	r.EffectWorkQueue = nil
	// first, run effect cleanups
	for _, work := range workQueue {
		comp := r.CompMap[work.Id]
		if comp == nil {
			continue
		}
		hook := comp.Hooks[work.EffectIndex]
		if hook.UnmountFn != nil {
			hook.UnmountFn()
		}
	}
	// now run, new effects
	for _, work := range workQueue {
		comp := r.CompMap[work.Id]
		if comp == nil {
			continue
		}
		hook := comp.Hooks[work.EffectIndex]
		if hook.Fn != nil {
			hook.UnmountFn = hook.Fn()
		}
	}
	// now check if we need a render
	if len(r.NeedsRenderMap) > 0 {
		r.NeedsRenderMap = nil
		r.render(r.Root.Elem, &r.Root)
	}
}

func (r *RootElem) render(elem *Elem, comp **Component) {
	if elem == nil || elem.Tag == "" {
		r.unmount(comp)
		return
	}
	elemKey := elem.Key()
	if *comp == nil || !(*comp).compMatch(elem.Tag, elemKey) {
		r.unmount(comp)
		r.createComp(elem.Tag, elemKey, comp)
	}
	(*comp).Elem = elem
	if elem.Tag == TextTag {
		r.renderText(elem.Text, comp)
		return
	}
	if isBaseTag(elem.Tag) {
		// simple vdom, fragment, wave element
		r.renderSimple(elem, comp)
		return
	}
	cfunc := r.CFuncs[elem.Tag]
	if cfunc == nil {
		text := fmt.Sprintf("<%s>", elem.Tag)
		r.renderText(text, comp)
		return
	}
	r.renderComponent(cfunc, elem, comp)
}

func (r *RootElem) unmount(comp **Component) {
	if *comp == nil {
		return
	}
	// parent clean up happens first
	for _, hook := range (*comp).Hooks {
		if hook.UnmountFn != nil {
			hook.UnmountFn()
		}
	}
	// clean up any children
	if (*comp).Comp != nil {
		r.unmount(&(*comp).Comp)
	}
	if (*comp).Children != nil {
		for _, child := range (*comp).Children {
			r.unmount(&child)
		}
	}
	delete(r.CompMap, (*comp).Id)
	*comp = nil
}

func (r *RootElem) createComp(tag string, key string, comp **Component) {
	*comp = &Component{Id: uuid.New().String(), Tag: tag, Key: key}
	r.CompMap[(*comp).Id] = *comp
}

func (r *RootElem) renderText(text string, comp **Component) {
	if (*comp).Text != text {
		(*comp).Text = text
	}
}

func (r *RootElem) renderChildren(elems []Elem, curChildren []*Component) []*Component {
	newChildren := make([]*Component, len(elems))
	curCM := make(map[ChildKey]*Component)
	usedMap := make(map[*Component]bool)
	for idx, child := range curChildren {
		if child.Key != "" {
			curCM[ChildKey{Tag: child.Tag, Idx: 0, Key: child.Key}] = child
		} else {
			curCM[ChildKey{Tag: child.Tag, Idx: idx, Key: ""}] = child
		}
	}
	for idx, elem := range elems {
		elemKey := elem.Key()
		var curChild *Component
		if elemKey != "" {
			curChild = curCM[ChildKey{Tag: elem.Tag, Idx: 0, Key: elemKey}]
		} else {
			curChild = curCM[ChildKey{Tag: elem.Tag, Idx: idx, Key: ""}]
		}
		usedMap[curChild] = true
		newChildren[idx] = curChild
		r.render(&elem, &newChildren[idx])
	}
	for _, child := range curChildren {
		if !usedMap[child] {
			r.unmount(&child)
		}
	}
	return newChildren
}

func (r *RootElem) renderSimple(elem *Elem, comp **Component) {
	if (*comp).Comp != nil {
		r.unmount(&(*comp).Comp)
	}
	(*comp).Children = r.renderChildren(elem.Children, (*comp).Children)
}

func (r *RootElem) makeRenderContext(comp *Component) context.Context {
	var ctx context.Context
	if r.OuterCtx != nil {
		ctx = r.OuterCtx
	} else {
		ctx = context.Background()
	}
	ctx = context.WithValue(ctx, vdomContextKey, &VDomContextVal{Root: r, Comp: comp, HookIdx: 0})
	return ctx
}

func getRenderContext(ctx context.Context) *VDomContextVal {
	v := ctx.Value(vdomContextKey)
	if v == nil {
		return nil
	}
	return v.(*VDomContextVal)
}

func (r *RootElem) renderComponent(cfunc CFunc, elem *Elem, comp **Component) {
	if (*comp).Children != nil {
		for _, child := range (*comp).Children {
			r.unmount(&child)
		}
		(*comp).Children = nil
	}
	props := make(map[string]any)
	for k, v := range elem.Props {
		props[k] = v
	}
	props[ChildrenPropKey] = elem.Children
	ctx := r.makeRenderContext(*comp)
	renderedElem := cfunc(ctx, props)
	rtnElemArr := partToElems(renderedElem)
	if len(rtnElemArr) == 0 {
		r.unmount(&(*comp).Comp)
		return
	}
	var rtnElem *Elem
	if len(rtnElemArr) == 1 {
		rtnElem = &rtnElemArr[0]
	} else {
		rtnElem = &Elem{Tag: FragmentTag, Children: rtnElemArr}
	}
	r.render(rtnElem, &(*comp).Comp)
}

func convertPropsToVDom(props map[string]any) map[string]any {
	if len(props) == 0 {
		return nil
	}
	vdomProps := make(map[string]any)
	for k, v := range props {
		if v == nil {
			continue
		}
		val := reflect.ValueOf(v)
		if val.Kind() == reflect.Func {
			vdomProps[k] = VDomFuncType{FuncType: "server"}
			continue
		}
		vdomProps[k] = v
	}
	return vdomProps
}

func convertBaseToVDom(c *Component) *Elem {
	elem := &Elem{Id: c.Id, Tag: c.Tag}
	if c.Elem != nil {
		elem.Props = convertPropsToVDom(c.Elem.Props)
	}
	for _, child := range c.Children {
		childVDom := convertToVDom(child)
		if childVDom != nil {
			elem.Children = append(elem.Children, *childVDom)
		}
	}
	return elem
}

func convertToVDom(c *Component) *Elem {
	if c == nil {
		return nil
	}
	if c.Tag == TextTag {
		return &Elem{Tag: TextTag, Text: c.Text}
	}
	if isBaseTag(c.Tag) {
		return convertBaseToVDom(c)
	} else {
		return convertToVDom(c.Comp)
	}
}

func (r *RootElem) makeVDom(comp *Component) *Elem {
	vdomElem := convertToVDom(comp)
	return vdomElem
}

func (r *RootElem) MakeVDom() *Elem {
	return r.makeVDom(r.Root)
}
