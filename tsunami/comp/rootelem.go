// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package comp

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

type RenderOpts struct {
	Resync bool
}

type RootElem struct {
	OuterCtx        context.Context
	Root            *ComponentImpl
	RenderTs        int64
	CFuncs          map[string]any
	CompMap         map[string]*ComponentImpl // component waveid -> component
	EffectWorkQueue []*vdom.EffectWorkElem
	NeedsRenderMap  map[string]bool
	Atoms           map[string]*vdom.Atom
	atomLock        sync.Mutex
	RefOperations   []rpctypes.VDomRefOperation
}

func (r *RootElem) AddRenderWork(id string) {
	if r.NeedsRenderMap == nil {
		r.NeedsRenderMap = make(map[string]bool)
	}
	r.NeedsRenderMap[id] = true
}

func (r *RootElem) AddEffectWork(id string, effectIndex int) {
	r.EffectWorkQueue = append(r.EffectWorkQueue, &vdom.EffectWorkElem{Id: id, EffectIndex: effectIndex})
}

func (r *RootElem) GetDataMap() map[string]any {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	result := make(map[string]any)
	for atomName, atom := range r.Atoms {
		if strings.HasPrefix(atomName, "$data.") {
			strippedName := strings.TrimPrefix(atomName, "$data.")
			result[strippedName] = atom.Val
		}
	}
	return result
}

func MakeRoot() *RootElem {
	return &RootElem{
		Root:    nil,
		CFuncs:  make(map[string]any),
		CompMap: make(map[string]*ComponentImpl),
		Atoms:   make(map[string]*vdom.Atom),
	}
}

func (r *RootElem) ensureAtomNoLock(name string) *vdom.Atom {
	atom, ok := r.Atoms[name]
	if !ok {
		atom = &vdom.Atom{UsedBy: make(map[string]bool)}
		r.Atoms[name] = atom
	}
	return atom
}


func (r *RootElem) AtomSetUsedBy(atomName string, waveId string, used bool) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()
	
	atom := r.ensureAtomNoLock(atomName)
	if used {
		atom.UsedBy[waveId] = true
	} else {
		delete(atom.UsedBy, waveId)
	}
}

func (r *RootElem) AtomAddRenderWork(atomName string) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()
	
	atom, ok := r.Atoms[atomName]
	if !ok {
		return
	}
	for compId := range atom.UsedBy {
		r.AddRenderWork(compId)
	}
}

func (r *RootElem) GetAtomVal(name string) any {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	atom, ok := r.Atoms[name]
	if !ok {
		return nil
	}
	return atom.Val
}

func (r *RootElem) GetStateSync(full bool) []rpctypes.VDomStateSync {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	stateSync := make([]rpctypes.VDomStateSync, 0)
	for atomName, atom := range r.Atoms {
		if atom.Dirty || full {
			stateSync = append(stateSync, rpctypes.VDomStateSync{Atom: atomName, Value: atom.Val})
			atom.Dirty = false
		}
	}
	return stateSync
}

func (r *RootElem) SetAtomVal(name string, val any, markDirty bool) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	atom := r.ensureAtomNoLock(name)
	if !markDirty {
		atom.Val = val
		return
	}
	// try to avoid setting the value and marking as dirty if it's the "same"
	if util.JsonValEqual(val, atom.Val) {
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
	// second can a map[string]any, or a struct, or ptr to struct (we'll reflect the value into it)
	arg2Type := rtype.In(1)
	if arg2Type.Kind() == reflect.Ptr {
		arg2Type = arg2Type.Elem()
	}
	if arg2Type.Kind() == reflect.Map {
		if arg2Type.Key().Kind() != reflect.String ||
			!(arg2Type.Elem().Kind() == reflect.Interface && arg2Type.Elem().NumMethod() == 0) {
			return fmt.Errorf("Map argument must be map[string]any")
		}
	} else if arg2Type.Kind() != reflect.Struct &&
		!(arg2Type.Kind() == reflect.Interface && arg2Type.NumMethod() == 0) {
		return fmt.Errorf("Component function second argument must be map[string]any, struct, or any")
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

func (r *RootElem) Render(elem *vdom.VDomElem, opts *RenderOpts) {
	r.render(elem, &r.Root, opts)
}

func callVDomFn(fnVal any, data vdom.VDomEvent) {
	if fnVal == nil {
		return
	}
	fn := fnVal
	if vdf, ok := fnVal.(*vdom.VDomFunc); ok {
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

func (r *RootElem) Event(id string, propName string, event vdom.VDomEvent) {
	comp := r.CompMap[id]
	if comp == nil || comp.Elem == nil {
		return
	}
	fnVal := comp.Elem.Props[propName]
	callVDomFn(fnVal, event)
}

// this will be called by the frontend to say the DOM has been mounted
// it will eventually send any updated "refs" to the backend as well
func (r *RootElem) RunWork(opts *RenderOpts) {
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
		r.render(r.Root.Elem, &r.Root, opts)
	}
}

func (r *RootElem) render(elem *vdom.VDomElem, comp **ComponentImpl, opts *RenderOpts) {
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
	if elem.Tag == vdom.TextTag {
		r.renderText(elem.Text, comp)
		return
	}
	if vdom.IsBaseTag(elem.Tag) {
		// simple vdom, fragment, wave element
		r.renderSimple(elem, comp, opts)
		return
	}
	cfunc := r.CFuncs[elem.Tag]
	if cfunc == nil {
		text := fmt.Sprintf("<%s>", elem.Tag)
		r.renderText(text, comp)
		return
	}
	r.renderComponent(cfunc, elem, comp, opts)
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

func (r *RootElem) renderChildren(elems []vdom.VDomElem, curChildren []*ComponentImpl, opts *RenderOpts) []*ComponentImpl {
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
		r.render(&elem, &newChildren[idx], opts)
	}
	for _, child := range curChildren {
		if !usedMap[child] {
			r.unmount(&child)
		}
	}
	return newChildren
}

func (r *RootElem) renderSimple(elem *vdom.VDomElem, comp **ComponentImpl, opts *RenderOpts) {
	if (*comp).Comp != nil {
		r.unmount(&(*comp).Comp)
	}
	(*comp).Children = r.renderChildren(elem.Children, (*comp).Children, opts)
}

func callCFunc(cfunc any, ctx context.Context, props map[string]any) any {
	rval := reflect.ValueOf(cfunc)
	arg2Type := rval.Type().In(1)

	var arg2Val reflect.Value
	if arg2Type.Kind() == reflect.Interface && arg2Type.NumMethod() == 0 {
		// For any/interface{}, pass nil properly
		arg2Val = reflect.New(arg2Type)
	} else {
		arg2Val = reflect.New(arg2Type)
		// if arg2 is a map, just pass props
		if arg2Type.Kind() == reflect.Map {
			arg2Val.Elem().Set(reflect.ValueOf(props))
		} else {
			err := util.MapToStruct(props, arg2Val.Interface())
			if err != nil {
				fmt.Printf("error unmarshalling props: %v\n", err)
			}
		}
	}
	rtnVal := rval.Call([]reflect.Value{reflect.ValueOf(ctx), arg2Val.Elem()})
	if len(rtnVal) == 0 {
		return nil
	}
	return rtnVal[0].Interface()
}

func (r *RootElem) renderComponent(cfunc any, elem *vdom.VDomElem, comp **ComponentImpl, opts *RenderOpts) {
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
	props[vdom.ChildrenPropKey] = elem.Children
	vc := MakeContextVal(r, *comp, opts)
	ctx := vdom.WithRenderContext(r.OuterCtx, vc)
	renderedElem := callCFunc(cfunc, ctx, props)
	rtnElemArr := vdom.PartToElems(renderedElem)
	if len(rtnElemArr) == 0 {
		r.unmount(&(*comp).Comp)
		return
	}
	var rtnElem *vdom.VDomElem
	if len(rtnElemArr) == 1 {
		rtnElem = &rtnElemArr[0]
	} else {
		rtnElem = &vdom.VDomElem{Tag: vdom.FragmentTag, Children: rtnElemArr}
	}
	r.render(rtnElem, &(*comp).Comp, opts)
}

func (r *RootElem) UpdateRef(updateRef rpctypes.VDomRefUpdate) {
	refId := updateRef.RefId
	split := strings.SplitN(refId, ":", 2)
	if len(split) != 2 {
		log.Printf("invalid ref id: %s\n", refId)
		return
	}
	waveId := split[0]
	hookIdx, err := strconv.Atoi(split[1])
	if err != nil {
		log.Printf("invalid ref id (bad hook idx): %s\n", refId)
		return
	}
	comp := r.CompMap[waveId]
	if comp == nil {
		return
	}
	if hookIdx < 0 || hookIdx >= len(comp.Hooks) {
		return
	}
	hook := comp.Hooks[hookIdx]
	if hook == nil {
		return
	}
	ref, ok := hook.Val.(*vdom.VDomRef)
	if !ok {
		return
	}
	ref.HasCurrent = updateRef.HasCurrent
	ref.Position = updateRef.Position
	r.AddRenderWork(waveId)
}

func (r *RootElem) QueueRefOp(op rpctypes.VDomRefOperation) {
	r.RefOperations = append(r.RefOperations, op)
}

func (r *RootElem) GetRefOperations() []rpctypes.VDomRefOperation {
	ops := r.RefOperations
	r.RefOperations = nil
	return ops
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
			vdomProps[k] = vdom.VDomFunc{Type: vdom.ObjectType_Func}
			continue
		}
		vdomProps[k] = v
	}
	return vdomProps
}

func convertBaseToVDom(c *ComponentImpl) *vdom.VDomElem {
	elem := &vdom.VDomElem{WaveId: c.WaveId, Tag: c.Tag}
	if c.Elem != nil {
		elem.Props = convertPropsToVDom(c.Elem.Props)
	}
	for _, child := range c.Children {
		childElem := convertCompToVDom(child)
		if childElem != nil {
			elem.Children = append(elem.Children, *childElem)
		}
	}
	if c.Tag == vdom.TextTag {
		elem.Text = c.Text
	}
	return elem
}

func convertCompToVDom(c *ComponentImpl) *vdom.VDomElem {
	if c == nil {
		return nil
	}
	if c.Comp != nil {
		return convertCompToVDom(c.Comp)
	}
	return convertBaseToVDom(c)
}

func (r *RootElem) MakeVDom() *vdom.VDomElem {
	if r.Root == nil {
		return nil
	}
	return convertCompToVDom(r.Root)
}

func ConvertElemsToTransferElems(elems []vdom.VDomElem) []rpctypes.VDomTransferElem {
	transferElems := make([]rpctypes.VDomTransferElem, 0)
	for _, elem := range elems {
		transferElem := rpctypes.VDomTransferElem{
			WaveId: elem.WaveId,
			Tag:    elem.Tag,
			Props:  elem.Props,
			Text:   elem.Text,
		}
		for _, child := range elem.Children {
			transferElem.Children = append(transferElem.Children, child.WaveId)
		}
		transferElems = append(transferElems, transferElem)
		childTransferElems := ConvertElemsToTransferElems(elem.Children)
		transferElems = append(transferElems, childTransferElems...)
	}
	return transferElems
}

func VDomFuncCallFn(vdf *vdom.VDomFunc, event vdom.VDomEvent) {
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
		if rtype.In(0) == reflect.TypeOf((*vdom.VDomEvent)(nil)).Elem() {
			rval.Call([]reflect.Value{reflect.ValueOf(event)})
		}
	}
}

func QueueRefOp(ctx context.Context, ref *vdom.VDomRef, op rpctypes.VDomRefOperation) {
	if ref == nil || !ref.HasCurrent {
		return
	}
	vcIf := vdom.GetRenderContext(ctx)
	if vcIf == nil {
		panic("QueueRefOp must be called within a component (no context)")
	}
	vc := vcIf.(*VDomContextVal)
	if op.RefId == "" {
		op.RefId = ref.RefId
	}
	vc.Root.QueueRefOp(op)
}
