// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package shexec

import (
	"io"
	"os"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/packet"
)

type FdReader struct {
	CVar      *sync.Cond
	SessionId string
	CmdId     string
	FdNum     int
	Fd        *os.File
	BufSize   int
	Closed    bool
}

func MakeFdReader(c *ShExecType, fd *os.File, fdNum int) *FdReader {
	return &FdReader{
		CVar:      sync.NewCond(&sync.Mutex{}),
		SessionId: c.RunPacket.SessionId,
		CmdId:     c.RunPacket.CmdId,
		FdNum:     fdNum,
		Fd:        fd,
		BufSize:   0,
	}
}

func (r *FdReader) Close() {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	if r.Closed {
		return
	}
	if r.Fd != nil {
		r.Fd.Close()
	}
	r.CVar.Broadcast()
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
func (r *FdReader) sendPacket_unlock(sender *packet.PacketSender, pk packet.PacketType) {
	r.CVar.L.Unlock()
	defer r.CVar.L.Lock()
	sender.SendPacket(pk)
}

// returns (success)
func (r *FdReader) WriteWait(sender *packet.PacketSender, data []byte, isEof bool) bool {
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
		pk := r.MakeDataPacket(data[0:writeLen], nil)
		pk.Eof = isEof && (writeLen == len(data))
		r.BufSize += writeLen
		data = data[writeLen:]
		r.sendPacket_unlock(sender, pk)
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

func (r *FdReader) MakeDataPacket(data []byte, err error) *packet.DataPacketType {
	pk := packet.MakeDataPacket()
	pk.SessionId = r.SessionId
	pk.CmdId = r.CmdId
	pk.FdNum = r.FdNum
	pk.Data = string(data)
	if err != nil {
		pk.Error = err.Error()
	}
	return pk
}

func (r *FdReader) isClosed() bool {
	r.CVar.L.Lock()
	defer r.CVar.L.Unlock()
	return r.Closed
}

func (r *FdReader) ReadLoop(wg *sync.WaitGroup, sender *packet.PacketSender) {
	defer r.Close()
	defer wg.Done()
	buf := make([]byte, 4096)
	for {
		nr, err := r.Fd.Read(buf)
		if r.isClosed() {
			return // should not send data or error if we already closed the fd
		}
		if nr > 0 || err == io.EOF {
			isOpen := r.WriteWait(sender, buf[0:nr], (err == io.EOF))
			if !isOpen {
				return
			}
		}
		if err != nil {
			errPk := r.MakeDataPacket(nil, err)
			sender.SendPacket(errPk)
			return
		}
	}
}
