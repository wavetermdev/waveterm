// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/json"
	"fmt"

	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

const (
	Mode_Normal  = "normal"
	Mode_Esc     = "esc"
	Mode_WaveEsc = "waveesc"
)

type PtyBuffer struct {
	Mode            string
	EscSeqBuf       []byte
	DataOutputFn    func(string, []byte) error
	CommandOutputFn func(wshutil.BlockCommand) error
	Err             error
}

func MakePtyBuffer(dataOutputFn func(string, []byte) error, commandOutputFn func(wshutil.BlockCommand) error) *PtyBuffer {
	return &PtyBuffer{
		Mode:            Mode_Normal,
		DataOutputFn:    dataOutputFn,
		CommandOutputFn: commandOutputFn,
	}
}

func (b *PtyBuffer) setErr(err error) {
	if b.Err == nil {
		b.Err = err
	}
}

func (b *PtyBuffer) processWaveEscSeq(escSeq []byte) {
	jmsg := make(map[string]any)
	err := json.Unmarshal(escSeq, &jmsg)
	if err != nil {
		b.setErr(fmt.Errorf("error unmarshalling Wave OSC sequence data: %w", err))
		return
	}
	cmd, err := wshutil.ParseCmdMap(jmsg)
	if err != nil {
		b.setErr(fmt.Errorf("error parsing Wave OSC command: %w", err))
		return
	}
	err = b.CommandOutputFn(cmd)
	if err != nil {
		b.setErr(fmt.Errorf("error processing Wave OSC command: %w", err))
		return
	}
}

func (b *PtyBuffer) AppendData(data []byte) {
	outputBuf := make([]byte, 0, len(data))
	for _, ch := range data {
		if b.Mode == Mode_WaveEsc {
			if ch == wshutil.ESC {
				// terminates the escape sequence (and the rest was invalid)
				b.Mode = Mode_Normal
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
				b.EscSeqBuf = nil
			} else if ch == wshutil.BEL || ch == wshutil.ST {
				// terminates the escpae sequence (is a valid Wave OSC command)
				b.Mode = Mode_Normal
				waveEscSeq := b.EscSeqBuf[len(wshutil.WaveOSCPrefix):]
				b.EscSeqBuf = nil
				b.processWaveEscSeq(waveEscSeq)
			} else {
				b.EscSeqBuf = append(b.EscSeqBuf, ch)
			}
			continue
		}
		if b.Mode == Mode_Esc {
			if ch == wshutil.ESC || ch == wshutil.BEL || ch == wshutil.ST {
				// these all terminate the escape sequence (invalid, not a Wave OSC)
				b.Mode = Mode_Normal
				outputBuf = append(outputBuf, b.EscSeqBuf...)
				outputBuf = append(outputBuf, ch)
			} else {
				if ch == wshutil.WaveOSCPrefixBytes[len(b.EscSeqBuf)] {
					// we're still building what could be a Wave OSC sequence
					b.EscSeqBuf = append(b.EscSeqBuf, ch)
				} else {
					// this is not a Wave OSC sequence, just an escape sequence
					b.Mode = Mode_Normal
					outputBuf = append(outputBuf, b.EscSeqBuf...)
					outputBuf = append(outputBuf, ch)
					continue
				}
				// check to see if we have a full Wave OSC prefix
				if len(b.EscSeqBuf) == len(wshutil.WaveOSCPrefixBytes) {
					b.Mode = Mode_WaveEsc
				}
			}
			continue
		}
		// Mode_Normal
		if ch == wshutil.ESC {
			b.Mode = Mode_Esc
			b.EscSeqBuf = []byte{ch}
			continue
		}
		outputBuf = append(outputBuf, ch)
	}
	if len(outputBuf) > 0 {
		err := b.DataOutputFn(BlockFile_Main, outputBuf)
		if err != nil {
			b.setErr(fmt.Errorf("error processing data output: %w", err))
		}
	}
}
