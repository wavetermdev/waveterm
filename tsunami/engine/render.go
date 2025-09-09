// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"context"
	"fmt"
	"reflect"
	"unicode"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// see render.md for a complete guide to how tsunami rendering, lifecycle, and reconciliation works

type RenderOpts struct {
	Resync bool
}

func (r *RootElem) Render(elem *vdom.VDomElem, opts *RenderOpts) {
	r.render(elem, &r.Root, opts)
}

func getElemKey(elem *vdom.VDomElem) string {
	if elem == nil {
		return ""
	}
	keyVal, ok := elem.Props[vdom.KeyPropKey]
	if !ok {
		return ""
	}
	return fmt.Sprint(keyVal)
}

func (r *RootElem) render(elem *vdom.VDomElem, comp **ComponentImpl, opts *RenderOpts) {
	if elem == nil || elem.Tag == "" {
		r.unmount(comp)
		return
	}
	elemKey := getElemKey(elem)
	if *comp == nil || !(*comp).compMatch(elem.Tag, elemKey) {
		r.unmount(comp)
		r.createComp(elem.Tag, elemKey, comp)
	}
	(*comp).Elem = elem
	if elem.Tag == vdom.TextTag {
		// Pattern 1: Text Nodes
		r.renderText(elem.Text, comp)
		return
	}
	if isBaseTag(elem.Tag) {
		// Pattern 2: Base elements
		r.renderSimple(elem, comp, opts)
		return
	}
	cfunc := r.CFuncs[elem.Tag]
	if cfunc == nil {
		text := fmt.Sprintf("<%s>", elem.Tag)
		r.renderText(text, comp)
		return
	}
	// Pattern 3: components
	r.renderComponent(cfunc, elem, comp, opts)
}

// Pattern 1
func (r *RootElem) renderText(text string, comp **ComponentImpl) {
	// No need to clear Children/Comp - text components cannot have them
	if (*comp).Text != text {
		(*comp).Text = text
	}
}

// Pattern 2
func (r *RootElem) renderSimple(elem *vdom.VDomElem, comp **ComponentImpl, opts *RenderOpts) {
	if (*comp).RenderedComp != nil {
		// Clear Comp since base elements don't use it
		r.unmount(&(*comp).RenderedComp)
	}
	(*comp).Children = r.renderChildren(elem.Children, (*comp).Children, opts)
}

// Pattern 3
func (r *RootElem) renderComponent(cfunc any, elem *vdom.VDomElem, comp **ComponentImpl, opts *RenderOpts) {
	if (*comp).Children != nil {
		// Clear Children since custom components don't use them
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
	vc := makeContextVal(r, *comp, opts)
	rtnElemArr := withGlobalCtx(vc, func() []vdom.VDomElem {
		ctx := r.OuterCtx
		if ctx == nil {
			ctx = context.Background()
		}
		renderedElem := callCFunc(cfunc, ctx, props)
		return vdom.ToElems(renderedElem)
	})
	var rtnElem *vdom.VDomElem
	if len(rtnElemArr) == 0 {
		rtnElem = nil
	} else if len(rtnElemArr) == 1 {
		rtnElem = &rtnElemArr[0]
	} else {
		rtnElem = &vdom.VDomElem{Tag: vdom.FragmentTag, Children: rtnElemArr}
	}
	r.render(rtnElem, &(*comp).RenderedComp, opts)
}

func (r *RootElem) unmount(comp **ComponentImpl) {
	if *comp == nil {
		return
	}
	waveId := (*comp).WaveId
	for _, hook := range (*comp).Hooks {
		if hook.UnmountFn != nil {
			hook.UnmountFn()
		}
	}
	if (*comp).RenderedComp != nil {
		r.unmount(&(*comp).RenderedComp)
	}
	if (*comp).Children != nil {
		for _, child := range (*comp).Children {
			r.unmount(&child)
		}
	}
	delete(r.CompMap, waveId)
	r.cleanupUsedByForUnmount(waveId)
	*comp = nil
}

func (r *RootElem) createComp(tag string, key string, comp **ComponentImpl) {
	*comp = &ComponentImpl{WaveId: uuid.New().String(), Tag: tag, Key: key}
	r.CompMap[(*comp).WaveId] = *comp
}

// handles reconcilation
// maps children via key or index (exclusively)
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
		elemKey := getElemKey(&elem)
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

// uses reflection to call the component function
func callCFunc(cfunc any, ctx context.Context, props map[string]any) any {
	rval := reflect.ValueOf(cfunc)
	arg2Type := rval.Type().In(1)

	var arg2Val reflect.Value
	if arg2Type.Kind() == reflect.Interface && arg2Type.NumMethod() == 0 {
		arg2Val = reflect.New(arg2Type)
	} else {
		arg2Val = reflect.New(arg2Type)
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

func convertPropsToVDom(props map[string]any) map[string]any {
	if len(props) == 0 {
		return nil
	}
	vdomProps := make(map[string]any)
	for k, v := range props {
		if v == nil {
			continue
		}
		if vdomFunc, ok := v.(vdom.VDomFunc); ok {
			// ensure Type is set on all VDomFuncs
			vdomFunc.Type = vdom.ObjectType_Func
			vdomProps[k] = vdomFunc
			continue
		}
		if vdomRef, ok := v.(vdom.VDomRef); ok {
			// ensure Type is set on all VDomRefs
			vdomRef.Type = vdom.ObjectType_Ref
			vdomProps[k] = vdomRef
			continue
		}
		val := reflect.ValueOf(v)
		if val.Kind() == reflect.Func {
			// convert go functions passed to event handlers to VDomFuncs
			vdomProps[k] = vdom.VDomFunc{Type: vdom.ObjectType_Func}
			continue
		}
		vdomProps[k] = v
	}
	return vdomProps
}

func (r *RootElem) MakeRendered() *rpctypes.RenderedElem {
	if r.Root == nil {
		return nil
	}
	return r.convertCompToRendered(r.Root)
}

func (r *RootElem) convertCompToRendered(c *ComponentImpl) *rpctypes.RenderedElem {
	if c == nil {
		return nil
	}
	if c.RenderedComp != nil {
		return r.convertCompToRendered(c.RenderedComp)
	}
	if len(c.Children) == 0 && r.CFuncs[c.Tag] != nil {
		return nil
	}
	return r.convertBaseToRendered(c)
}

func (r *RootElem) convertBaseToRendered(c *ComponentImpl) *rpctypes.RenderedElem {
	elem := &rpctypes.RenderedElem{WaveId: c.WaveId, Tag: c.Tag}
	if c.Elem != nil {
		elem.Props = convertPropsToVDom(c.Elem.Props)
	}
	for _, child := range c.Children {
		childElem := r.convertCompToRendered(child)
		if childElem != nil {
			elem.Children = append(elem.Children, *childElem)
		}
	}
	if c.Tag == vdom.TextTag {
		elem.Text = c.Text
	}
	return elem
}

func isBaseTag(tag string) bool {
	if tag == "" {
		return false
	}
	if tag == vdom.TextTag || tag == vdom.WaveTextTag || tag == vdom.WaveNullTag || tag == vdom.FragmentTag {
		return true
	}
	if tag[0] == '#' {
		return true
	}
	firstChar := rune(tag[0])
	return unicode.IsLower(firstChar)
}
