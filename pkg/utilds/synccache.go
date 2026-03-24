// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilds

import "sync"

type SyncCache[T any] struct {
	lock      sync.Mutex
	computeFn func() (T, error)
	value     T
	err       error
	cached    bool
}

func MakeSyncCache[T any](computeFn func() (T, error)) *SyncCache[T] {
	return &SyncCache[T]{
		computeFn: computeFn,
	}
}

func (sc *SyncCache[T]) Get(force bool) (T, error) {
	sc.lock.Lock()
	defer sc.lock.Unlock()

	if sc.cached && !force {
		return sc.value, sc.err
	}

	sc.value, sc.err = sc.computeFn()
	sc.cached = true
	return sc.value, sc.err
}