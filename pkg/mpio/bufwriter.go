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
	BufferLimit   int
	Fd            io.WriteCloser
	Eof           bool
	Closed        bool
	ShouldCloseFd bool
	Desc          string
}

func MakeFdWriter(m *Multiplexer, fd io.WriteCloser, fdNum int, shouldCloseFd bool, desc string) *FdWriter {
	fw := &FdWriter{
		CVar:          sync.NewCond(&sync.Mutex{}),
		Fd:            fd,
		M:             m,
		FdNum:         fdNum,
		ShouldCloseFd: shouldCloseFd,
		Desc:          desc,
		BufferLimit:   WriteBufSize,
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
		return fmt.Errorf("write to closed file %q (fd:%d) eof[%v]", w.Desc, w.FdNum, w.Eof)
	}
	if len(data) > 0 {
		if len(data)+len(w.Buffer) > w.BufferLimit {
			return fmt.Errorf("write exceeds buffer size %q (fd:%d) bufsize=%d (max=%d)", w.Desc, w.FdNum, len(data)+len(w.Buffer), w.BufferLimit)
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
