// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"sync"
)

type SyncMap[K comparable, V any] struct {
	lock *sync.Mutex
	m    map[K]V
}

func MakeSyncMap[K comparable, V any]() *SyncMap[K, V] {
	return &SyncMap[K, V]{
		lock: &sync.Mutex{},
		m:    make(map[K]V),
	}
}

func (sm *SyncMap[K, V]) Set(k K, v V) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.m[k] = v
}

func (sm *SyncMap[K, V]) Get(k K) V {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return sm.m[k]
}

func (sm *SyncMap[K, V]) GetEx(k K) (V, bool) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	v, ok := sm.m[k]
	return v, ok
}

func (sm *SyncMap[K, V]) Delete(k K) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	delete(sm.m, k)
}

func (sm *SyncMap[K, V]) Clear() {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.m = make(map[K]V)
}

func (sm *SyncMap[K, V]) Len() int {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return len(sm.m)
}

func (sm *SyncMap[K, V]) Keys() []K {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	keys := make([]K, len(sm.m))
	i := 0
	for k := range sm.m {
		keys[i] = k
		i++
	}
	return keys
}

func (sm *SyncMap[K, V]) Replace(newMap map[K]V) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.m = make(map[K]V, len(newMap))
	for k, v := range newMap {
		sm.m[k] = v
	}
}

func IncSyncMap[K comparable, V int | int64](sm *SyncMap[K, V], key K, incAmt V) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.m[key] += incAmt
}
