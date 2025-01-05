// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ds

import "sync"

type SyncMap[T any] struct {
	lock *sync.Mutex
	m    map[string]T
}

func NewSyncMap[T any]() *SyncMap[T] {
	return &SyncMap[T]{
		lock: &sync.Mutex{},
		m:    make(map[string]T),
	}
}

func (sm *SyncMap[T]) Set(key string, value T) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.m[key] = value
}

func (sm *SyncMap[T]) Get(key string) T {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return sm.m[key]
}

func (sm *SyncMap[T]) GetEx(key string) (T, bool) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	v, ok := sm.m[key]
	return v, ok
}

func (sm *SyncMap[T]) Delete(key string) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	delete(sm.m, key)
}
