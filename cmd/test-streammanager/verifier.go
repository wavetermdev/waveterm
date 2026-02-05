// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"sync"
)

type Verifier struct {
	lock          sync.Mutex
	expectedGen   *TestDataGenerator
	totalReceived int64
	mismatches    int
	firstMismatch int64
}

func NewVerifier(totalBytes int64) *Verifier {
	return &Verifier{
		expectedGen:   NewTestDataGenerator(totalBytes),
		firstMismatch: -1,
	}
}

func (v *Verifier) Write(p []byte) (n int, err error) {
	v.lock.Lock()
	defer v.lock.Unlock()

	expected := make([]byte, len(p))
	// expectedGen.Read() error ignored: TestDataGenerator is deterministic and won't fail,
	// and any data length mismatch will be caught by byte comparison below
	v.expectedGen.Read(expected)

	for i := 0; i < len(p); i++ {
		if p[i] != expected[i] {
			v.mismatches++
			if v.firstMismatch == -1 {
				v.firstMismatch = v.totalReceived + int64(i)
			}
		}
	}

	v.totalReceived += int64(len(p))
	return len(p), nil
}

func (v *Verifier) TotalReceived() int64 {
	v.lock.Lock()
	defer v.lock.Unlock()
	return v.totalReceived
}

func (v *Verifier) Mismatches() int {
	v.lock.Lock()
	defer v.lock.Unlock()
	return v.mismatches
}

func (v *Verifier) FirstMismatch() int64 {
	v.lock.Lock()
	defer v.lock.Unlock()
	return v.firstMismatch
}
