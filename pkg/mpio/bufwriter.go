// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package mpio

import (
	"fmt"
	"io"
	"sync"
)

type FdWriter struct {
	CVar          *sync.Cond
	M             *Multiplexer
	FdNum         int
	Buffer        []byte
	Fd            io.WriteCloser
	Eof           bool
	Closed        bool
	ShouldCloseFd bool
}

func MakeFdWriter(m *Multiplexer, fd io.WriteCloser, fdNum int, shouldCloseFd bool) *FdWriter {
	fw := &FdWriter{
		CVar:          sync.NewCond(&sync.Mutex{}),
		Fd:            fd,
		M:             m,
		FdNum:         fdNum,
		ShouldCloseFd: shouldCloseFd,
	}
	return fw
}

func (w *FdWriter) Close() {
	w.CVar.L.Lock()
	defer w.CVar.L.Unlock()
	if w.Closed {
		return
	}
	w.Closed = true
	if w.Fd != nil && w.ShouldCloseFd {
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

func (w *FdWriter) AddData(data []byte, eof bool) error {
	w.CVar.L.Lock()
	defer w.CVar.L.Unlock()
	if w.Closed || w.Eof {
		if len(data) == 0 {
			return nil
		}
		return fmt.Errorf("write to closed file eof[%v]", w.Eof)
	}
	if len(data) > 0 {
		if len(data)+len(w.Buffer) > WriteBufSize {
			return fmt.Errorf("write exceeds buffer size bufsize=%d (max=%d)", len(data)+len(w.Buffer), WriteBufSize)
		}
		w.Buffer = append(w.Buffer, data...)
	}
	if eof {
		w.Eof = true
	}
	w.CVar.Broadcast()
	return nil
}

func (w *FdWriter) WriteLoop(wg *sync.WaitGroup) {
	defer w.Close()
	if wg != nil {
		defer wg.Done()
	}
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
			if nw > 0 || err != nil {
				ack := w.M.makeDataAckPacket(w.FdNum, nw, err)
				w.M.sendPacket(ack)
			}
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
