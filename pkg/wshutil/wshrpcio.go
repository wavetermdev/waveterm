// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"fmt"
	"io"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// special I/O wrappers for wshrpc
// * terminal (wrap with OSC codes)
// * stream (json lines)
// * websocket (json packets)

func AdaptStreamToMsgCh(input io.Reader, output chan baseds.RpcInputChType, readCallback func()) error {
	return utilfn.StreamToLines(input, func(line []byte) {
		output <- baseds.RpcInputChType{MsgBytes: line}
	}, readCallback)
}

func AdaptOutputChToStream(outputCh chan []byte, output io.Writer) error {
	drain := false
	defer func() {
		if drain {
			utilfn.DrainChannelSafe(outputCh, "AdaptOutputChToStream")
		}
	}()
	for msg := range outputCh {
		if _, err := output.Write(msg); err != nil {
			drain = true
			return fmt.Errorf("error writing to output (AdaptOutputChToStream): %w", err)
		}
		// write trailing newline
		if _, err := output.Write([]byte{'\n'}); err != nil {
			drain = true
			return fmt.Errorf("error writing trailing newline to output (AdaptOutputChToStream): %w", err)
		}
	}
	return nil
}

func AdaptMsgChToPty(outputCh chan []byte, oscEsc string, output io.Writer) error {
	if len(oscEsc) != 5 {
		panic("oscEsc must be 5 characters")
	}
	for msg := range outputCh {
		barr, err := EncodeWaveOSCBytes(oscEsc, msg)
		if err != nil {
			return fmt.Errorf("error encoding osc message (AdaptMsgChToPty): %w", err)
		}
		if _, err := output.Write(barr); err != nil {
			return fmt.Errorf("error writing osc message (AdaptMsgChToPty): %w", err)
		}
	}
	return nil
}
