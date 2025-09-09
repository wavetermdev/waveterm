// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"encoding/json"
	"fmt"
	"sync"
)

type AtomImpl[T any] struct {
	lock   *sync.Mutex
	val    T
	usedBy map[string]bool // component waveid -> true
}

func MakeAtomImpl[T any](initialVal T) *AtomImpl[T] {
	return &AtomImpl[T]{
		lock:   &sync.Mutex{},
		val:    initialVal,
		usedBy: make(map[string]bool),
	}
}

func (a *AtomImpl[T]) GetVal() any {
	a.lock.Lock()
	defer a.lock.Unlock()
	return a.val
}

func (a *AtomImpl[T]) SetVal(val any) error {
	a.lock.Lock()
	defer a.lock.Unlock()

	if val == nil {
		var zero T
		a.val = zero
		return nil
	}

	// Try direct assignment if it's already type T
	if typed, ok := val.(T); ok {
		a.val = typed
		return nil
	}

	// Try JSON marshaling/unmarshaling
	jsonBytes, err := json.Marshal(val)
	if err != nil {
		var result T
		return fmt.Errorf("failed to adapt type from %T => %T, input type failed to marshal: %w", val, result, err)
	}

	var result T
	if err := json.Unmarshal(jsonBytes, &result); err != nil {
		return fmt.Errorf("failed to adapt type from %T => %T: %w", val, result, err)
	}

	a.val = result
	return nil
}

func (a *AtomImpl[T]) SetUsedBy(waveId string, used bool) {
	a.lock.Lock()
	defer a.lock.Unlock()
	if used {
		a.usedBy[waveId] = true
	} else {
		delete(a.usedBy, waveId)
	}
}

func (a *AtomImpl[T]) GetUsedBy() []string {
	a.lock.Lock()
	defer a.lock.Unlock()

	keys := make([]string, 0, len(a.usedBy))
	for compId := range a.usedBy {
		keys = append(keys, compId)
	}
	return keys
}
