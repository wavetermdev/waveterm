// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"log"
	"reflect"
	"runtime"

	"github.com/wavetermdev/waveterm/tsunami/engine"
	"github.com/wavetermdev/waveterm/tsunami/util"
)

// logInvalidAtomSet logs an error when an atom is being set during component render
func logInvalidAtomSet(atomName string) {
	_, file, line, ok := runtime.Caller(2)
	if ok {
		log.Printf("invalid Set of atom '%s' in component render function at %s:%d", atomName, file, line)
	} else {
		log.Printf("invalid Set of atom '%s' in component render function", atomName)
	}
}

// sameRef returns true if oldVal and newVal share the same underlying reference
// (pointer, map, or slice). Nil values return false.
func sameRef[T any](oldVal, newVal T) bool {
	vOld := reflect.ValueOf(oldVal)
	vNew := reflect.ValueOf(newVal)

	if !vOld.IsValid() || !vNew.IsValid() {
		return false
	}

	switch vNew.Kind() {
	case reflect.Ptr:
		// direct comparison works for *T
		return any(oldVal) == any(newVal)

	case reflect.Map, reflect.Slice:
		if vOld.Kind() != vNew.Kind() || vOld.IsZero() || vNew.IsZero() {
			return false
		}
		return vOld.Pointer() == vNew.Pointer()
	}

	// primitives, structs, etc. → not a reference type
	return false
}

// logMutationWarning logs a warning when mutation is detected
func logMutationWarning(atomName string) {
	_, file, line, ok := runtime.Caller(2)
	if ok {
		log.Printf("WARNING: atom '%s' appears to be mutated instead of copied at %s:%d - use app.DeepCopy to create a copy before mutating", atomName, file, line)
	} else {
		log.Printf("WARNING: atom '%s' appears to be mutated instead of copied - use app.DeepCopy to create a copy before mutating", atomName)
	}
}

// Atom[T] represents a typed atom implementation
type Atom[T any] struct {
	name   string
	client *engine.ClientImpl
}

// AtomName implements the vdom.Atom interface
func (a Atom[T]) AtomName() string {
	return a.name
}

// Get returns the current value of the atom. When called during component render,
// it automatically registers the component as a dependency for this atom, ensuring
// the component re-renders when the atom value changes.
func (a Atom[T]) Get() T {
	vc := engine.GetGlobalContext()
	if vc != nil {
		compWaveId := vc.GetCompWaveId()
		vc.Root.AtomSetUsedBy(a.name, compWaveId, true)
	}
	val := a.client.Root.GetAtomVal(a.name)
	typedVal := util.GetTypedAtomValue[T](val, a.name)
	return typedVal
}

// Set updates the atom's value to the provided new value and triggers re-rendering
// of any components that depend on this atom. This method cannot be called during
// render cycles - use effects or event handlers instead.
func (a Atom[T]) Set(newVal T) {
	vc := engine.GetGlobalContext()
	if vc != nil {
		logInvalidAtomSet(a.name)
		return
	}

	// Check for potential mutation bugs with reference types
	currentVal := a.client.Root.GetAtomVal(a.name)
	currentTyped := util.GetTypedAtomValue[T](currentVal, a.name)
	if sameRef(currentTyped, newVal) {
		logMutationWarning(a.name)
	}

	if err := a.client.Root.SetAtomVal(a.name, newVal); err != nil {
		log.Printf("Failed to set atom value for %s: %v", a.name, err)
		return
	}
	a.client.Root.AtomAddRenderWork(a.name)
}

// SetFn updates the atom's value by applying the provided function to the current value.
// The function receives a copy of the current atom value, which can be safely mutated
// without affecting the original data. The return value from the function becomes the
// new atom value. This method cannot be called during render cycles.
func (a Atom[T]) SetFn(fn func(T) T) {
	vc := engine.GetGlobalContext()
	if vc != nil {
		logInvalidAtomSet(a.name)
		return
	}
	err := a.client.Root.SetFnAtomVal(a.name, func(val any) any {
		typedVal := util.GetTypedAtomValue[T](val, a.name)
		return fn(typedVal)
	})
	if err != nil {
		log.Printf("Failed to set atom value for %s: %v", a.name, err)
		return
	}
	a.client.Root.AtomAddRenderWork(a.name)
}
