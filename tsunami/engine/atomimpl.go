// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import "sync"

type atomImpl struct {
	lock   *sync.Mutex
	val    any
	UsedBy map[string]bool // component waveid -> true
}

func makeAtom(initialVal any) *atomImpl {
	return &atomImpl{
		lock:   &sync.Mutex{},
		val:    initialVal,
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
