// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilds

import (
	"sync"

	"github.com/google/uuid"
)

type idListEntry[T any] struct {
	id  string
	val T
}

type IdList[T any] struct {
	lock    sync.Mutex
	entries []idListEntry[T]
}

func (il *IdList[T]) Register(val T) string {
	il.lock.Lock()
	defer il.lock.Unlock()

	id := uuid.New().String()
	il.entries = append(il.entries, idListEntry[T]{id: id, val: val})
	return id
}

func (il *IdList[T]) RegisterWithId(id string, val T) {
	il.lock.Lock()
	defer il.lock.Unlock()

	il.unregister_nolock(id)
	il.entries = append(il.entries, idListEntry[T]{id: id, val: val})
}

func (il *IdList[T]) Unregister(id string) {
	il.lock.Lock()
	defer il.lock.Unlock()

	il.unregister_nolock(id)
}

func (il *IdList[T]) unregister_nolock(id string) {
	for i, entry := range il.entries {
		if entry.id == id {
			il.entries = append(il.entries[:i], il.entries[i+1:]...)
			return
		}
	}
}

func (il *IdList[T]) GetList() []T {
	il.lock.Lock()
	defer il.lock.Unlock()

	result := make([]T, len(il.entries))
	for i, entry := range il.entries {
		result[i] = entry.val
	}
	return result
}