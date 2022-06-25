// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package mpio

import (
	"io"
	"os"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/packet"
)

type FdReader struct {
	CVar          *sync.Cond
	M             *Multiplexer
	FdNum         int
	Fd            *os.File
	BufSize       int
	Closed        bool
	ShouldCloseFd bool
}

func MakeFdReader(m *Multiplexer, fd *os.File, fdNum int, shouldCloseFd bool) *FdReader {
	fr := &FdReader{
		CVar:          sync.NewCond(&sync.Mutex{}),
		M:             m,
		FdNum:         fdNum,
		Fd:            fd,
		BufSize:       0,
		ShouldCloseFd: shouldCloseFd,
	}
	return fr
}

func (r *FdReader) Close() {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	if r.Closed {
		return
	}
	if r.Fd != nil && r.ShouldCloseFd {
		r.Fd.Close()
	}
	r.CVar.Broadcast()
}

func (r *FdReader) GetBufSize() int {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	return r.BufSize
}

func (r *FdReader) NotifyAck(ackLen int) {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	if r.Closed {
		return
	}
	r.BufSize -= ackLen
	if r.BufSize < 0 {
		r.BufSize = 0
	}
	r.CVar.Broadcast()
}

// !! inverse locking.  must already hold the lock when you call this method.
// will *unlock*, send the packet, and then *relock* once it is done.
// this can prevent an unlikely deadlock where we are holding r.CVar.L and stuck on sender.SendCh
func (r *FdReader) sendPacket_unlock(pk packet.PacketType) {
	r.CVar.L.Unlock()
	defer r.CVar.L.Lock()
	r.M.sendPacket(pk)
}

// returns (success)
func (r *FdReader) WriteWait(data []byte, isEof bool) bool {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	for {
		bufAvail := ReadBufSize - r.BufSize
		if r.Closed {
			return false
		}
		if bufAvail == 0 {
			r.CVar.Wait()
			continue
		}
		writeLen := min(bufAvail, len(data))
		pk := r.M.makeDataPacket(r.FdNum, data[0:writeLen], nil)
		pk.Eof = isEof && (writeLen == len(data))
		r.BufSize += writeLen
		data = data[writeLen:]
		r.sendPacket_unlock(pk)
		if len(data) == 0 {
			return true
		}
		// do *not* do a CVar.Wait() here -- because we *unlocked* to send the packet, we should
		// recheck the condition before waiting to avoid deadlock.
	}
}

func min(v1 int, v2 int) int {
	if v1 <= v2 {
		return v1
	}
	return v2
}

func (r *FdReader) isClosed() bool {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	return r.Closed
}

func (r *FdReader) ReadLoop(wg *sync.WaitGroup) {
	defer r.Close()
	if wg != nil {
		defer wg.Done()
	}
	buf := make([]byte, 4096)
	for {
		nr, err := r.Fd.Read(buf)
		if r.isClosed() {
			return // should not send data or error if we already closed the fd
		}
		if nr > 0 || err == io.EOF {
			isOpen := r.WriteWait(buf[0:nr], (err == io.EOF))
			if !isOpen {
				return
			}
			if err == io.EOF {
				return
			}
		}
		if err != nil {
			errPk := r.M.makeDataPacket(r.FdNum, nil, err)
			r.M.sendPacket(errPk)
			return
		}
	}
}
