// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const ChildrenPropKey = "children"


type EffectWorkElem struct {
	Id          string
	EffectIndex int
}

type genAtom interface {
	GetVal() any
	SetVal(any) error
	SetUsedBy(string, bool)
	GetUsedBy() []string
}

type RootElem struct {
	OuterCtx        context.Context
	Root            *ComponentImpl
	RenderTs        int64
	AppTitle        string
	CFuncs          map[string]any
	CompMap         map[string]*ComponentImpl // component waveid -> component
	EffectWorkQueue []*EffectWorkElem
	NeedsRenderMap  map[string]bool
	Atoms           map[string]genAtom
	atomLock        sync.Mutex
	RefOperations   []vdom.VDomRefOperation
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

func (r *RootElem) GetDataMap() map[string]any {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	result := make(map[string]any)
	for atomName, atom := range r.Atoms {
		if strings.HasPrefix(atomName, "$data.") {
			strippedName := strings.TrimPrefix(atomName, "$data.")
			result[strippedName] = atom.GetVal()
		}
	}
	return result
}

func (r *RootElem) GetConfigMap() map[string]any {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	result := make(map[string]any)
	for atomName, atom := range r.Atoms {
		if strings.HasPrefix(atomName, "$config.") {
			strippedName := strings.TrimPrefix(atomName, "$config.")
			result[strippedName] = atom.GetVal()
		}
	}
	return result
}

func MakeRoot() *RootElem {
	return &RootElem{
		Root:    nil,
		CFuncs:  make(map[string]any),
		CompMap: make(map[string]*ComponentImpl),
		Atoms:   make(map[string]genAtom),
	}
}

func (r *RootElem) RegisterAtom(name string, atom genAtom) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	if _, ok := r.Atoms[name]; ok {
		panic(fmt.Sprintf("atom %s already exists", name))
	}
	r.Atoms[name] = atom
}

// we can do better here with an inverted map, but
// this will work fine for now to clean up dependencies from atom.Get()
func (r *RootElem) cleanupUsedByForUnmount(waveId string) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	for _, atom := range r.Atoms {
		atom.SetUsedBy(waveId, false)
	}
}

func (r *RootElem) AtomSetUsedBy(atomName string, waveId string, used bool) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	atom, ok := r.Atoms[atomName]
	if !ok {
		return
	}
	atom.SetUsedBy(waveId, used)
}

func (r *RootElem) AtomAddRenderWork(atomName string) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	atom, ok := r.Atoms[atomName]
	if !ok {
		return
	}
	for _, compId := range atom.GetUsedBy() {
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
	return atom.GetVal()
}

func (r *RootElem) SetAtomVal(name string, val any) error {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	atom, ok := r.Atoms[name]
	if !ok {
		return fmt.Errorf("atom %q not found", name)
	}
	return atom.SetVal(val)
}

func (r *RootElem) RemoveAtom(name string) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	delete(r.Atoms, name)
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

func (r *RootElem) QueueRefOp(op vdom.VDomRefOperation) {
	r.RefOperations = append(r.RefOperations, op)
}

func (r *RootElem) GetRefOperations() []vdom.VDomRefOperation {
	ops := r.RefOperations
	r.RefOperations = nil
	return ops
}
