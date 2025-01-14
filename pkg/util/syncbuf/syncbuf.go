// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncbuf

import (
	"bytes"
	"io"
	"sync"
)

type SyncBuffer struct {
	lock sync.Mutex
	buf  *bytes.Buffer
}

func MakeSyncBuffer() *SyncBuffer {
	return &SyncBuffer{
		lock: sync.Mutex{},
		buf:  new(bytes.Buffer),
	}
}

// spawns a goroutine to copy the reader to the buffer
func MakeSyncBufferFromReader(r io.Reader) *SyncBuffer {
	rtn := MakeSyncBuffer()
	go io.Copy(rtn, r)
	return rtn
}

func (s *SyncBuffer) Write(p []byte) (n int, err error) {
	s.lock.Lock()
	defer s.lock.Unlock()
	return s.buf.Write(p)
}

func (s *SyncBuffer) String() string {
	s.lock.Lock()
	defer s.lock.Unlock()
	return s.buf.String()
}
