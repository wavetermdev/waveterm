// Copyright 2026, Command Line Inc.
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
	ModeNormal     = "normal"
	ModeEscStart   = "escstart"
	ModeOSCNum     = "oscnum"
	ModeOSCPayload = "oscpayload"
)

const MaxBufferedDataSize = 256 * 1024
const MaxOSCNumLen = 5

type PtyBuffer struct {
	CVar           *sync.Cond
	DataBuf        *bytes.Buffer
	EscMode        string
	EscSeqBuf      []byte         // raw bytes buffered for passthrough if no handler matches
	PayloadBuf     []byte         // OSC payload accumulation (ModeOSCPayload)
	Handlers       map[string]func([]byte)
	CurrentHandler func([]byte)
	InputReader    io.Reader
	AtEOF          bool
	Err            error
}

func MakePtyBuffer(input io.Reader, handlers map[string]func([]byte)) *PtyBuffer {
	b := &PtyBuffer{
		CVar:        sync.NewCond(&sync.Mutex{}),
		DataBuf:     &bytes.Buffer{},
		EscMode:     ModeNormal,
		Handlers:    handlers,
		InputReader: input,
	}
	go b.run()
	return b
}

// MakeWaveOSCHandler returns a handler func for OSC WaveOSC that sends payloads to messageCh.
func MakeWaveOSCHandler(messageCh chan baseds.RpcInputChType) func([]byte) {
	return func(payload []byte) {
		messageCh <- baseds.RpcInputChType{MsgBytes: payload}
	}
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

func (b *PtyBuffer) run() {
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
		switch b.EscMode {
		case ModeOSCPayload:
			if ch == ESC {
				// invalid terminator — discard in-progress sequence, start new escape
				b.CurrentHandler = nil
				b.PayloadBuf = nil
				b.EscMode = ModeEscStart
				b.EscSeqBuf = []byte{ESC}
			} else if ch == BEL || ch == ST {
				b.CurrentHandler(b.PayloadBuf)
				b.CurrentHandler = nil
				b.PayloadBuf = nil
				b.EscMode = ModeNormal
			} else {
				b.PayloadBuf = append(b.PayloadBuf, ch)
			}

		case ModeOSCNum:
			// EscSeqBuf holds \x1b] + any digits accumulated so far
			numLen := len(b.EscSeqBuf) - 2 // subtract \x1b and ]
			if ch == ';' && numLen > 0 {
				oscNum := string(b.EscSeqBuf[2:])
				if handler, ok := b.Handlers[oscNum]; ok {
					b.CurrentHandler = handler
					b.EscSeqBuf = nil
					b.PayloadBuf = nil
					b.EscMode = ModeOSCPayload
				} else {
					outputBuf = append(outputBuf, b.EscSeqBuf...)
					outputBuf = append(outputBuf, ch)
					b.EscSeqBuf = nil
					b.EscMode = ModeNormal
				}
			} else if ch >= '0' && ch <= '9' && numLen < MaxOSCNumLen {
				b.EscSeqBuf = append(b.EscSeqBuf, ch)
			} else if ch == ESC {
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				b.EscSeqBuf = []byte{ESC}
				b.EscMode = ModeEscStart
			} else {
				// non-digit, no `;` yet, or too many digits — passthrough
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
				b.EscSeqBuf = nil
				b.EscMode = ModeNormal
			}

		case ModeEscStart:
			if ch == ']' {
				b.EscSeqBuf = append(b.EscSeqBuf, ch)
				b.EscMode = ModeOSCNum
			} else if ch == ESC {
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				b.EscSeqBuf = []byte{ESC}
				// stay in ModeEscStart
			} else {
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
				b.EscSeqBuf = nil
				b.EscMode = ModeNormal
			}

		default: // ModeNormal
			if ch == ESC {
				b.EscMode = ModeEscStart
				b.EscSeqBuf = []byte{ESC}
			} else {
				outputBuf = append(outputBuf, ch)
			}
		}
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
