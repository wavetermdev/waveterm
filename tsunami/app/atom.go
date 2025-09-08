// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"log"
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

// Atom[T] represents a typed atom implementation
type Atom[T any] struct {
	name   string
	client *clientImpl
}

// AtomName implements the vdom.Atom interface
func (a Atom[T]) AtomName() string {
	return a.name
}

// Get returns the current value of the atom
func (a Atom[T]) Get() T {
	vc := engine.GetGlobalContext()
	if vc != nil {
		compWaveId := vc.GetCompWaveId()
		vc.Root.AtomSetUsedBy(a.name, compWaveId, true)
	}
	val := a.client.GetAtomVal(a.name)
	return util.GetTypedAtomValue[T](val, a.name)
}

// Set updates the atom's value
func (a Atom[T]) Set(newVal T) {
	vc := engine.GetGlobalContext()
	if vc != nil {
		logInvalidAtomSet(a.name)
		return
	}
	a.client.Root.AtomAddRenderWork(a.name)
	a.client.SetAtomVal(a.name, newVal)
}

func (a Atom[T]) SetFn(fn func(T) T) {
	vc := engine.GetGlobalContext()
	if vc != nil {
		logInvalidAtomSet(a.name)
		return
	}
	val := a.client.GetAtomVal(a.name)
	typedVal := util.GetTypedAtomValue[T](val, a.name)
	newVal := fn(typedVal)
	a.client.Root.AtomAddRenderWork(a.name)
	a.client.SetAtomVal(a.name, newVal)
}
