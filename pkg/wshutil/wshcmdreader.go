// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bytes"
	"fmt"
	"io"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const (
	Mode_Normal  = "normal"
	Mode_Esc     = "esc"
	Mode_WaveEsc = "waveesc"
)

const MaxBufferedDataSize = 256 * 1024

type PtyBuffer struct {
	CVar        *sync.Cond
	DataBuf     *bytes.Buffer
	EscMode     string
	EscSeqBuf   []byte
	OSCPrefix   string
	InputReader io.Reader
	MessageCh   chan baseds.RpcInputChType
	AtEOF       bool
	Err         error
}

// closes messageCh when input is closed (or error)
func MakePtyBuffer(oscPrefix string, input io.Reader, messageCh chan baseds.RpcInputChType) *PtyBuffer {
	if len(oscPrefix) != WaveOSCPrefixLen {
		panic(fmt.Sprintf("invalid OSC prefix length: %d", len(oscPrefix)))
	}
	b := &PtyBuffer{
		CVar:        sync.NewCond(&sync.Mutex{}),
		DataBuf:     &bytes.Buffer{},
		OSCPrefix:   oscPrefix,
		EscMode:     Mode_Normal,
		InputReader: input,
		MessageCh:   messageCh,
	}
	go b.run()
	return b
}

func (b *PtyBuffer) setErr(err error) {
	b.CVar.L.Lock()
	defer b.CVar.L.Unlock()
	if b.Err == nil {
		b.Err = err
	}
	b.CVar.Broadcast()
}

func (b *PtyBuffer) setEOF() {
	b.CVar.L.Lock()
	defer b.CVar.L.Unlock()
	b.AtEOF = true
	b.CVar.Broadcast()
}

func (b *PtyBuffer) processWaveEscSeq(escSeq []byte) {
	b.MessageCh <- baseds.RpcInputChType{MsgBytes: escSeq}
}

func (b *PtyBuffer) run() {
	defer close(b.MessageCh)
	buf := make([]byte, 4096)
	for {
		n, err := b.InputReader.Read(buf)
		b.processData(buf[:n])
		if err == io.EOF {
			b.setEOF()
			return
		}
		if err != nil {
			b.setErr(fmt.Errorf("error reading input: %w", err))
			return
		}
	}
}

func (b *PtyBuffer) processData(data []byte) {
	outputBuf := make([]byte, 0, len(data))
	for _, ch := range data {
		if b.EscMode == Mode_WaveEsc {
			if ch == ESC {
				// terminates the escape sequence (and the rest was invalid)
				b.EscMode = Mode_Normal
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
				b.EscSeqBuf = nil
			} else if ch == BEL || ch == ST {
				// terminates the escpae sequence (is a valid Wave OSC command)
				b.EscMode = Mode_Normal
				waveEscSeq := b.EscSeqBuf[WaveOSCPrefixLen:]
				b.EscSeqBuf = nil
				b.processWaveEscSeq(waveEscSeq)
			} else {
				b.EscSeqBuf = append(b.EscSeqBuf, ch)
			}
			continue
		}
		if b.EscMode == Mode_Esc {
			if ch == ESC || ch == BEL || ch == ST {
				// these all terminate the escape sequence (invalid, not a Wave OSC)
				b.EscMode = Mode_Normal
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
				b.EscSeqBuf = nil
				continue
			}
			if ch != b.OSCPrefix[len(b.EscSeqBuf)] {
				// this is not a Wave OSC sequence, just an escape sequence
				b.EscMode = Mode_Normal
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
				b.EscSeqBuf = nil
				continue
			}
			// we're still building what could be a Wave OSC sequence
			b.EscSeqBuf = append(b.EscSeqBuf, ch)
			// check to see if we have a full Wave OSC prefix
			if len(b.EscSeqBuf) == len(b.OSCPrefix) {
				b.EscMode = Mode_WaveEsc
			}
			continue
		}
		// Mode_Normal
		if ch == ESC {
			b.EscMode = Mode_Esc
			b.EscSeqBuf = []byte{ch}
			continue
		}
		outputBuf = append(outputBuf, ch)
	}
	if len(outputBuf) > 0 {
		b.writeData(outputBuf)
	}
}

func (b *PtyBuffer) writeData(data []byte) {
	b.CVar.L.Lock()
	defer b.CVar.L.Unlock()
	// only wait if buffer is currently over max size, otherwise allow this append to go through
	for b.DataBuf.Len() > MaxBufferedDataSize {
		b.CVar.Wait()
	}
	b.DataBuf.Write(data)
	b.CVar.Broadcast()
}

func (b *PtyBuffer) Read(p []byte) (n int, err error) {
	b.CVar.L.Lock()
	defer b.CVar.L.Unlock()
	for b.DataBuf.Len() == 0 {
		if b.Err != nil {
			return 0, b.Err
		}
		if b.AtEOF {
			return 0, io.EOF
		}
		b.CVar.Wait()
	}
	b.CVar.Broadcast()
	return b.DataBuf.Read(p)
}
