// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package shexec

import (
	"fmt"
	"os"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const MaxSingleWriteSize = 4 * 1024

type FdWriter struct {
	CVar      *sync.Cond
	SessionId string
	CmdId     string
	FdNum     int
	Buffer    []byte
	Fd        *os.File
	Eof       bool
	Closed    bool
}

func MakeFdWriter(c *ShExecType, fd *os.File, fdNum int) *FdWriter {
	return &FdWriter{
		CVar:      sync.NewCond(&sync.Mutex{}),
		Fd:        fd,
		SessionId: c.RunPacket.SessionId,
		CmdId:     c.RunPacket.CmdId,
		FdNum:     fdNum,
	}
}

func (w *FdWriter) Close() {
	w.CVar.L.Lock()
	defer w.CVar.L.Unlock()
	if w.Closed {
		return
	}
	w.Closed = true
	if w.Fd != nil {
		w.Fd.Close()
	}
	w.Buffer = nil
	w.CVar.Broadcast()
}

func (w *FdWriter) WaitForData() ([]byte, bool) {
	w.CVar.L.Lock()
	defer w.CVar.L.Unlock()
	for {
		if len(w.Buffer) > 0 || w.Eof || w.Closed {
			toWrite := w.Buffer
			w.Buffer = nil
			return toWrite, w.Eof
		}
		w.CVar.Wait()
	}
}

func (w *FdWriter) MakeDataAckPacket(ackLen int, err error) *packet.DataAckPacketType {
	ack := packet.MakeDataAckPacket()
	ack.SessionId = w.SessionId
	ack.CmdId = w.CmdId
	ack.FdNum = w.FdNum
	ack.AckLen = ackLen
	if err != nil {
		ack.Error = err.Error()
	}
	return ack
}

func (w *FdWriter) AddData(data []byte, eof bool) error {
	w.CVar.L.Lock()
	defer w.CVar.L.Unlock()
	if w.Closed {
		return fmt.Errorf("write to closed file")
	}
	if len(data) > 0 {
		if len(data)+len(w.Buffer) > WriteBufSize {
			return fmt.Errorf("write exceeds buffer size")
		}
		w.Buffer = append(w.Buffer, data...)
	}
	if eof {
		w.Eof = true
	}
	w.CVar.Broadcast()
	return nil
}

func (w *FdWriter) WriteLoop(sender *packet.PacketSender) {
	defer w.Close()
	for {
		data, isEof := w.WaitForData()
		// chunk the writes to make sure we send ample ack packets
		for len(data) > 0 {
			if w.Closed {
				return
			}
			chunkSize := min(len(data), MaxSingleWriteSize)
			chunk := data[0:chunkSize]
			nw, err := w.Fd.Write(chunk)
			ack := w.MakeDataAckPacket(nw, err)
			sender.SendPacket(ack)
			if err != nil {
				return
			}
			data = data[chunkSize:]
		}
		if isEof {
			return
		}
	}
}
