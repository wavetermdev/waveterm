// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bytes"
	"fmt"
	"io"
)

// special I/O wrappers for wshrpc
// * terminal (wrap with OSC codes)
// * stream (json lines)
// * websocket (json packets)

type lineBuf struct {
	buf        []byte
	inLongLine bool
}

const maxLineLength = 128 * 1024

func streamToLines_processBuf(lineBuf *lineBuf, readBuf []byte, lineFn func([]byte)) {
	for len(readBuf) > 0 {
		nlIdx := bytes.IndexByte(readBuf, '\n')
		if nlIdx == -1 {
			if lineBuf.inLongLine || len(lineBuf.buf)+len(readBuf) > maxLineLength {
				lineBuf.buf = nil
				lineBuf.inLongLine = true
				return
			}
			lineBuf.buf = append(lineBuf.buf, readBuf...)
			return
		}
		if !lineBuf.inLongLine && len(lineBuf.buf)+nlIdx <= maxLineLength {
			line := append(lineBuf.buf, readBuf[:nlIdx]...)
			lineFn(line)
		}
		lineBuf.buf = nil
		lineBuf.inLongLine = false
		readBuf = readBuf[nlIdx+1:]
	}
}

func StreamToLines(input io.Reader, lineFn func([]byte)) error {
	var lineBuf lineBuf
	readBuf := make([]byte, 16*1024)
	for {
		n, err := input.Read(readBuf)
		streamToLines_processBuf(&lineBuf, readBuf[:n], lineFn)
		if err != nil {
			return err
		}
	}
}

func AdaptStreamToMsgCh(input io.Reader, output chan []byte) error {
	return StreamToLines(input, func(line []byte) {
		output <- line
	})
}

func AdaptOutputChToStream(outputCh chan []byte, output io.Writer) error {
	for msg := range outputCh {
		if _, err := output.Write(msg); err != nil {
			return fmt.Errorf("error writing to output (AdaptOutputChToStream): %w", err)
		}
		// write trailing newline
		if _, err := output.Write([]byte{'\n'}); err != nil {
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
