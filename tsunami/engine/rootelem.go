// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const ChildrenPropKey = "children"

type EffectWorkElem struct {
	WaveId      string
	EffectIndex int
	CompTag     string
}

type genAtom interface {
	GetVal() any
	SetVal(any) error
	SetUsedBy(string, bool)
	GetUsedBy() []string
	GetMeta() *AtomMeta
}

type RootElem struct {
	Root            *ComponentImpl
	RenderTs        int64
	AppTitle        string
	CFuncs          map[string]any            // component name => render function
	CompMap         map[string]*ComponentImpl // component waveid -> component
	EffectWorkQueue []*EffectWorkElem
	needsRenderMap  map[string]bool // key: waveid
	needsRenderLock sync.Mutex
	Atoms           map[string]genAtom // key: atomName
	atomLock        sync.Mutex
	RefOperations   []vdom.VDomRefOperation
	Client          *ClientImpl
}

func (r *RootElem) addRenderWork(id string) {
	defer func() {
		if inContextType() == GlobalContextType_async {
			r.Client.notifyAsyncRenderWork()
		}
	}()

	r.needsRenderLock.Lock()
	defer r.needsRenderLock.Unlock()

	if r.needsRenderMap == nil {
		r.needsRenderMap = make(map[string]bool)
	}
	r.needsRenderMap[id] = true
}

func (r *RootElem) getAndClearRenderWork() []string {
	r.needsRenderLock.Lock()
	defer r.needsRenderLock.Unlock()

	if len(r.needsRenderMap) == 0 {
		return nil
	}

	ids := make([]string, 0, len(r.needsRenderMap))
	for id := range r.needsRenderMap {
		ids = append(ids, id)
	}
	r.needsRenderMap = nil
	return ids
}

func (r *RootElem) addEffectWork(id string, effectIndex int, compTag string) {
	r.EffectWorkQueue = append(r.EffectWorkQueue, &EffectWorkElem{WaveId: id, EffectIndex: effectIndex, CompTag: compTag})
}

// getAtomsByPrefix extracts all atoms that match the given prefix from RootElem
func (r *RootElem) getAtomsByPrefix(prefix string) map[string]genAtom {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()
	
	result := make(map[string]genAtom)
	for atomName, atom := range r.Atoms {
		if strings.HasPrefix(atomName, prefix) {
			strippedName := strings.TrimPrefix(atomName, prefix)
			result[strippedName] = atom
		}
	}
	return result
}

func (r *RootElem) GetDataMap() map[string]any {
	atoms := r.getAtomsByPrefix("$data.")
	result := make(map[string]any)
	for name, atom := range atoms {
		result[name] = atom.GetVal()
	}
	return result
}

func (r *RootElem) GetConfigMap() map[string]any {
	atoms := r.getAtomsByPrefix("$config.")
	result := make(map[string]any)
	for name, atom := range atoms {
		result[name] = atom.GetVal()
	}
	return result
}

func MakeRoot(client *ClientImpl) *RootElem {
	return &RootElem{
		Root:    nil,
		CFuncs:  make(map[string]any),
		CompMap: make(map[string]*ComponentImpl),
		Atoms:   make(map[string]genAtom),
		Client:  client,
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

// cleanupUsedByForUnmount uses the reverse mapping for efficient cleanup
func (r *RootElem) cleanupUsedByForUnmount(comp *ComponentImpl) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	// Use reverse mapping for efficient cleanup
	for atomName := range comp.UsedAtoms {
		if atom, ok := r.Atoms[atomName]; ok {
			atom.SetUsedBy(comp.WaveId, false)
		}
	}
	
	// Clear the component's atom tracking
	comp.UsedAtoms = nil
}

func (r *RootElem) updateComponentAtomUsage(comp *ComponentImpl, newUsedAtoms map[string]bool) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	oldUsedAtoms := comp.UsedAtoms

	// Remove component from atoms it no longer uses
	for atomName := range oldUsedAtoms {
		if !newUsedAtoms[atomName] {
			if atom, ok := r.Atoms[atomName]; ok {
				atom.SetUsedBy(comp.WaveId, false)
			}
		}
	}

	// Add component to atoms it now uses
	for atomName := range newUsedAtoms {
		if !oldUsedAtoms[atomName] {
			if atom, ok := r.Atoms[atomName]; ok {
				atom.SetUsedBy(comp.WaveId, true)
			}
		}
	}

	// Update component's atom usage map
	if len(newUsedAtoms) == 0 {
		comp.UsedAtoms = nil
	} else {
		comp.UsedAtoms = make(map[string]bool)
		for atomName := range newUsedAtoms {
			comp.UsedAtoms[atomName] = true
		}
	}
}

func (r *RootElem) AtomAddRenderWork(atomName string) {
	r.atomLock.Lock()
	defer r.atomLock.Unlock()

	atom, ok := r.Atoms[atomName]
	if !ok {
		return
	}
	usedBy := atom.GetUsedBy()
	if len(usedBy) == 0 {
		return
	}
	for _, compId := range usedBy {
		r.addRenderWork(compId)
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

func validateCFunc(cfunc any) error {
	if cfunc == nil {
		return fmt.Errorf("Component function cannot b nil")
	}
	rval := reflect.ValueOf(cfunc)
	if rval.Kind() != reflect.Func {
		return fmt.Errorf("Component function must be a function")
	}
	rtype := rval.Type()
	if rtype.NumIn() != 1 {
		return fmt.Errorf("Component function must take exactly 1 argument")
	}
	if rtype.NumOut() != 1 {
		return fmt.Errorf("Component function must return exactly 1 value")
	}
	// first argument can be a map[string]any, or a struct, or ptr to struct (we'll reflect the value into it)
	arg1Type := rtype.In(0)
	if arg1Type.Kind() == reflect.Ptr {
		arg1Type = arg1Type.Elem()
	}
	if arg1Type.Kind() == reflect.Map {
		if arg1Type.Key().Kind() != reflect.String ||
			!(arg1Type.Elem().Kind() == reflect.Interface && arg1Type.Elem().NumMethod() == 0) {
			return fmt.Errorf("Map argument must be map[string]any")
		}
	} else if arg1Type.Kind() != reflect.Struct &&
		!(arg1Type.Kind() == reflect.Interface && arg1Type.NumMethod() == 0) {
		return fmt.Errorf("Component function argument must be map[string]any, struct, or any")
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

func (r *RootElem) Event(event vdom.VDomEvent, globalEventHandler func(vdom.VDomEvent)) {
	defer func() {
		if event.GlobalEventType != "" {
			util.PanicHandler(fmt.Sprintf("Global event handler - event:%s", event.GlobalEventType), recover())
		} else {
			comp := r.CompMap[event.WaveId]
			tag := ""
			if comp != nil && comp.Elem != nil {
				tag = comp.Elem.Tag
			}
			compName := ""
			if comp != nil {
				compName = comp.ContainingComp
			}
			util.PanicHandler(fmt.Sprintf("Event handler - comp: %s, tag: %s, prop: %s", compName, tag, event.EventType), recover())
		}
	}()

	eventCtx := &EventContextImpl{Event: event, Root: r}
	withGlobalEventCtx(eventCtx, func() any {
		if event.GlobalEventType != "" {
			if globalEventHandler == nil {
				log.Printf("global event %s but no handler", event.GlobalEventType)
				return nil
			}
			globalEventHandler(event)
			return nil
		}

		comp := r.CompMap[event.WaveId]
		if comp == nil || comp.Elem == nil {
			return nil
		}

		fnVal := comp.Elem.Props[event.EventType]
		callVDomFn(fnVal, event)
		return nil
	})
}

func (r *RootElem) runEffectUnmount(work *EffectWorkElem, hook *Hook) {
	defer func() {
		comp := r.CompMap[work.WaveId]
		compName := ""
		if comp != nil {
			compName = comp.ContainingComp
		}
		util.PanicHandler(fmt.Sprintf("UseEffect unmount - comp: %s", compName), recover())
	}()
	if hook.UnmountFn == nil {
		return
	}
	effectCtx := &EffectContextImpl{
		WorkElem: *work,
		WorkType: "unmount",
		Root:     r,
	}
	withGlobalEffectCtx(effectCtx, func() any {
		hook.UnmountFn()
		return nil
	})
}

func (r *RootElem) runEffect(work *EffectWorkElem, hook *Hook) {
	defer func() {
		comp := r.CompMap[work.WaveId]
		compName := ""
		if comp != nil {
			compName = comp.ContainingComp
		}
		util.PanicHandler(fmt.Sprintf("UseEffect run - comp: %s", compName), recover())
	}()
	if hook.Fn == nil {
		return
	}
	effectCtx := &EffectContextImpl{
		WorkElem: *work,
		WorkType: "run",
		Root:     r,
	}
	unmountFn := withGlobalEffectCtx(effectCtx, func() func() {
		return hook.Fn()
	})
	hook.UnmountFn = unmountFn
}

// this will be called by the frontend to say the DOM has been mounted
// it will eventually send any updated "refs" to the backend as well
func (r *RootElem) RunWork(opts *RenderOpts) {
	workQueue := r.EffectWorkQueue
	r.EffectWorkQueue = nil
	// first, run effect cleanups
	for _, work := range workQueue {
		comp := r.CompMap[work.WaveId]
		if comp == nil {
			continue
		}
		hook := comp.Hooks[work.EffectIndex]
		r.runEffectUnmount(work, hook)
	}
	// now run, new effects
	for _, work := range workQueue {
		comp := r.CompMap[work.WaveId]
		if comp == nil {
			continue
		}
		hook := comp.Hooks[work.EffectIndex]
		r.runEffect(work, hook)
	}
	// now check if we need a render
	renderIds := r.getAndClearRenderWork()
	if len(renderIds) > 0 {
		r.render(r.Root.Elem, &r.Root, "root", opts)
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
	r.addRenderWork(waveId)
}

func (r *RootElem) QueueRefOp(op vdom.VDomRefOperation) {
	r.RefOperations = append(r.RefOperations, op)
}

func (r *RootElem) GetRefOperations() []vdom.VDomRefOperation {
	ops := r.RefOperations
	r.RefOperations = nil
	return ops
}
