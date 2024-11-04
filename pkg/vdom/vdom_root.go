// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"context"
	"fmt"
	"reflect"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

type vdomContextKeyType struct{}

var vdomContextKey = vdomContextKeyType{}

type VDomContextVal struct {
	Root    *RootElem
	Comp    *ComponentImpl
	HookIdx int
}

type Atom struct {
	Val    any
	Dirty  bool
	UsedBy map[string]bool // component waveid -> true
}

type RootElem struct {
	OuterCtx        context.Context
	Root            *ComponentImpl
	CFuncs          map[string]any
	CompMap         map[string]*ComponentImpl // component waveid -> component
	EffectWorkQueue []*EffectWorkElem
	NeedsRenderMap  map[string]bool
	Atoms           map[string]*Atom
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
		CFuncs:  make(map[string]any),
		CompMap: make(map[string]*ComponentImpl),
		Atoms:   make(map[string]*Atom),
	}
}

func (r *RootElem) GetAtom(name string) *Atom {
	atom, ok := r.Atoms[name]
	if !ok {
		atom = &Atom{UsedBy: make(map[string]bool)}
		r.Atoms[name] = atom
	}
	return atom
}

func (r *RootElem) GetAtomVal(name string) any {
	atom := r.GetAtom(name)
	return atom.Val
}

func (r *RootElem) GetStateSync(full bool) []VDomStateSync {
	stateSync := make([]VDomStateSync, 0)
	for atomName, atom := range r.Atoms {
		if atom.Dirty || full {
			stateSync = append(stateSync, VDomStateSync{Atom: atomName, Value: atom.Val})
			atom.Dirty = false
		}
	}
	return stateSync
}

func (r *RootElem) SetAtomVal(name string, val any, markDirty bool) {
	atom := r.GetAtom(name)
	if !markDirty {
		atom.Val = val
		return
	}
	// try to avoid setting the value and marking as dirty if it's the "same"
	if utilfn.JsonValEqual(val, atom.Val) {
		return
	}
	atom.Val = val
	atom.Dirty = true
}

func (r *RootElem) SetOuterCtx(ctx context.Context) {
	r.OuterCtx = ctx
}

func validateCFunc(cfunc any) error {
	if cfunc == nil {
		return fmt.Errorf("Component function cannot b nil")
	}
	rval := reflect.ValueOf(cfunc)
	if rval.Kind() != reflect.Func {
		return fmt.Errorf("Component function must be a function")
	}
	rtype := rval.Type()
	if rtype.NumIn() != 2 {
		return fmt.Errorf("Component function must take exactly 2 arguments")
	}
	if rtype.NumOut() != 1 {
		return fmt.Errorf("Component function must return exactly 1 value")
	}
	// first arg must be context.Context
	if rtype.In(0) != reflect.TypeOf((*context.Context)(nil)).Elem() {
		return fmt.Errorf("Component function first argument must be context.Context")
	}
	// second can a map, or a struct, or ptr to struct (we'll reflect the value into it)
	arg2Type := rtype.In(1)
	if arg2Type.Kind() == reflect.Ptr {
		arg2Type = arg2Type.Elem()
	}
	if arg2Type.Kind() != reflect.Map && arg2Type.Kind() != reflect.Struct {
		return fmt.Errorf("Component function second argument must be a map or a struct")
	}
	return nil
}

func (r *RootElem) RegisterComponent(name string, cfunc any) error {
	if err := validateCFunc(cfunc); err != nil {
		return err
	}
	r.CFuncs[name] = cfunc
	return nil
}

func (r *RootElem) Render(elem *VDomElem) {
	r.render(elem, &r.Root)
}

func (vdf *VDomFunc) CallFn(event VDomEvent) {
	if vdf.Fn == nil {
		return
	}
	rval := reflect.ValueOf(vdf.Fn)
	if rval.Kind() != reflect.Func {
		return
	}
	rtype := rval.Type()
	if rtype.NumIn() == 0 {
		rval.Call(nil)
	}
	if rtype.NumIn() == 1 {
		if rtype.In(0) == reflect.TypeOf((*VDomEvent)(nil)).Elem() {
			rval.Call([]reflect.Value{reflect.ValueOf(event)})
		}
	}
}

func callVDomFn(fnVal any, data VDomEvent) {
	if fnVal == nil {
		return
	}
	fn := fnVal
	if vdf, ok := fnVal.(*VDomFunc); ok {
		fn = vdf.Fn
	}
	if fn == nil {
		return
	}
	rval := reflect.ValueOf(fn)
	if rval.Kind() != reflect.Func {
		return
	}
	rtype := rval.Type()
	if rtype.NumIn() == 0 {
		rval.Call(nil)
		return
	}
	if rtype.NumIn() == 1 {
		rval.Call([]reflect.Value{reflect.ValueOf(data)})
		return
	}
}

func (r *RootElem) Event(id string, propName string, event VDomEvent) {
	comp := r.CompMap[id]
	if comp == nil || comp.Elem == nil {
		return
	}
	fnVal := comp.Elem.Props[propName]
	callVDomFn(fnVal, event)
}

// this will be called by the frontend to say the DOM has been mounted
// it will eventually send any updated "refs" to the backend as well
func (r *RootElem) RunWork() {
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

func (r *RootElem) render(elem *VDomElem, comp **ComponentImpl) {
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

func (r *RootElem) unmount(comp **ComponentImpl) {
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
	delete(r.CompMap, (*comp).WaveId)
	*comp = nil
}

func (r *RootElem) createComp(tag string, key string, comp **ComponentImpl) {
	*comp = &ComponentImpl{WaveId: uuid.New().String(), Tag: tag, Key: key}
	r.CompMap[(*comp).WaveId] = *comp
}

func (r *RootElem) renderText(text string, comp **ComponentImpl) {
	if (*comp).Text != text {
		(*comp).Text = text
	}
}

func (r *RootElem) renderChildren(elems []VDomElem, curChildren []*ComponentImpl) []*ComponentImpl {
	newChildren := make([]*ComponentImpl, len(elems))
	curCM := make(map[ChildKey]*ComponentImpl)
	usedMap := make(map[*ComponentImpl]bool)
	for idx, child := range curChildren {
		if child.Key != "" {
			curCM[ChildKey{Tag: child.Tag, Idx: 0, Key: child.Key}] = child
		} else {
			curCM[ChildKey{Tag: child.Tag, Idx: idx, Key: ""}] = child
		}
	}
	for idx, elem := range elems {
		elemKey := elem.Key()
		var curChild *ComponentImpl
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

func (r *RootElem) renderSimple(elem *VDomElem, comp **ComponentImpl) {
	if (*comp).Comp != nil {
		r.unmount(&(*comp).Comp)
	}
	(*comp).Children = r.renderChildren(elem.Children, (*comp).Children)
}

func (r *RootElem) makeRenderContext(comp *ComponentImpl) context.Context {
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

func callCFunc(cfunc any, ctx context.Context, props map[string]any) any {
	rval := reflect.ValueOf(cfunc)
	arg2Type := rval.Type().In(1)
	arg2Val := reflect.New(arg2Type)
	// if arg2 is a map, just pass props
	if arg2Type.Kind() == reflect.Map {
		arg2Val.Elem().Set(reflect.ValueOf(props))
	} else {
		err := utilfn.MapToStruct(props, arg2Val.Interface())
		if err != nil {
			fmt.Printf("error unmarshalling props: %v\n", err)
		}
	}
	rtnVal := rval.Call([]reflect.Value{reflect.ValueOf(ctx), arg2Val.Elem()})
	if len(rtnVal) == 0 {
		return nil
	}
	return rtnVal[0].Interface()
}

func (r *RootElem) renderComponent(cfunc any, elem *VDomElem, comp **ComponentImpl) {
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
	renderedElem := callCFunc(cfunc, ctx, props)
	rtnElemArr := partToElems(renderedElem)
	if len(rtnElemArr) == 0 {
		r.unmount(&(*comp).Comp)
		return
	}
	var rtnElem *VDomElem
	if len(rtnElemArr) == 1 {
		rtnElem = &rtnElemArr[0]
	} else {
		rtnElem = &VDomElem{Tag: FragmentTag, Children: rtnElemArr}
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
			vdomProps[k] = VDomFunc{Type: ObjectType_Func}
			continue
		}
		vdomProps[k] = v
	}
	return vdomProps
}

func convertBaseToVDom(c *ComponentImpl) *VDomElem {
	elem := &VDomElem{WaveId: c.WaveId, Tag: c.Tag}
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

func convertToVDom(c *ComponentImpl) *VDomElem {
	if c == nil {
		return nil
	}
	if c.Tag == TextTag {
		return &VDomElem{Tag: TextTag, Text: c.Text}
	}
	if isBaseTag(c.Tag) {
		return convertBaseToVDom(c)
	} else {
		return convertToVDom(c.Comp)
	}
}

func (r *RootElem) makeVDom(comp *ComponentImpl) *VDomElem {
	vdomElem := convertToVDom(comp)
	return vdomElem
}

func (r *RootElem) MakeVDom() *VDomElem {
	return r.makeVDom(r.Root)
}

func ConvertElemsToTransferElems(elems []VDomElem) []VDomTransferElem {
	var transferElems []VDomTransferElem
	textCounter := 0 // Counter for generating unique IDs for #text nodes

	// Helper function to recursively process each VDomElem in preorder
	var processElem func(elem VDomElem, isRoot bool) string
	processElem = func(elem VDomElem, isRoot bool) string {
		// Handle #text nodes by generating a unique placeholder ID
		if elem.Tag == "#text" {
			textId := fmt.Sprintf("text-%d", textCounter)
			textCounter++
			transferElems = append(transferElems, VDomTransferElem{
				Root:     isRoot,
				WaveId:   textId,
				Tag:      elem.Tag,
				Text:     elem.Text,
				Props:    nil,
				Children: nil,
			})
			return textId
		}

		// Convert children to WaveId references, handling potential #text nodes
		childrenIds := make([]string, len(elem.Children))
		for i, child := range elem.Children {
			childrenIds[i] = processElem(child, false) // Children are not roots
		}

		// Create the VDomTransferElem for the current element
		transferElem := VDomTransferElem{
			Root:     isRoot,
			WaveId:   elem.WaveId,
			Tag:      elem.Tag,
			Props:    elem.Props,
			Children: childrenIds,
			Text:     elem.Text,
		}
		transferElems = append(transferElems, transferElem)

		return elem.WaveId
	}

	// Start processing each top-level element, marking them as roots
	for _, elem := range elems {
		processElem(elem, true)
	}

	return transferElems
}
