// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ds

import (
	"sync"
	"time"

	"github.com/emirpasic/gods/trees/binaryheap"
)

// an ExpMap has "expiring" keys, which are automatically deleted after a certain time

type ExpMap[T any] struct {
	lock    *sync.Mutex
	expHeap *binaryheap.Heap // heap of expEntries (sorted by time)
	m       map[string]expMapEntry[T]
}

type expMapEntry[T any] struct {
	Val T
	Exp time.Time
}

type expEntry struct {
	Key string
	Exp time.Time
}

func heapComparator(aArg, bArg any) int {
	a := aArg.(expEntry)
	b := bArg.(expEntry)
	if a.Exp.Before(b.Exp) {
		return -1
	} else if a.Exp.After(b.Exp) {
		return 1
	}
	return 0
}

func MakeExpMap[T any]() *ExpMap[T] {
	return &ExpMap[T]{
		lock:    &sync.Mutex{},
		expHeap: binaryheap.NewWith(heapComparator),
		m:       make(map[string]expMapEntry[T]),
	}
}

func (em *ExpMap[T]) Set(key string, value T, exp time.Time) {
	em.lock.Lock()
	defer em.lock.Unlock()
	oldEntry, ok := em.m[key]
	em.m[key] = expMapEntry[T]{Val: value, Exp: exp}
	if !ok || oldEntry.Exp != exp {
		em.expHeap.Push(expEntry{Key: key, Exp: exp}) // this might create duplicates.  that's ok.
	}
}

func (em *ExpMap[T]) expireItems_nolock() {
	// should already hold the lock
	now := time.Now()
	for {
		if em.expHeap.Empty() {
			break
		}
		// we know it isn't empty, so we ignore "ok"
		topI, _ := em.expHeap.Peek()
		top := topI.(expEntry)
		if top.Exp.After(now) {
			break
		}
		em.expHeap.Pop()
		entry, ok := em.m[top.Key]
		if ok && (entry.Exp.Before(now) || entry.Exp.Equal(now)) {
			delete(em.m, top.Key)
		}
	}
}

func (em *ExpMap[T]) Get(key string) (T, bool) {
	em.lock.Lock()
	defer em.lock.Unlock()
	em.expireItems_nolock()
	v, ok := em.m[key]
	return v.Val, ok
}
