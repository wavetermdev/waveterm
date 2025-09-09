// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"reflect"
	"sync"
)

type atomImpl struct {
	lock   *sync.Mutex
	val    any
	typ    reflect.Type
	UsedBy map[string]bool // component waveid -> true
}

func makeAtom(initialVal any, typ reflect.Type) *atomImpl {
	return &atomImpl{
		lock:   &sync.Mutex{},
		val:    initialVal,
		typ:    typ,
		UsedBy: make(map[string]bool),
	}
}

func (a *atomImpl) GetVal() any {
	a.lock.Lock()
	defer a.lock.Unlock()
	return a.val
}

func (a *atomImpl) SetVal(val any) {
	a.lock.Lock()
	defer a.lock.Unlock()
	a.val = val
}

func (a *atomImpl) SetUsedBy(waveId string, used bool) {
	a.lock.Lock()
	defer a.lock.Unlock()
	if used {
		a.UsedBy[waveId] = true
	} else {
		delete(a.UsedBy, waveId)
	}
}

func (a *atomImpl) GetUsedBy() []string {
	a.lock.Lock()
	defer a.lock.Unlock()

	keys := make([]string, 0, len(a.UsedBy))
	for compId := range a.UsedBy {
		keys = append(keys, compId)
	}
	return keys
}
