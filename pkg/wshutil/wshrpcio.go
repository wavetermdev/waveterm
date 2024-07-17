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

func streamToLines(input io.Reader, lineFn func([]byte)) {
	var lineBuf lineBuf
	readBuf := make([]byte, 16*1024)
	for {
		n, err := input.Read(readBuf)
		streamToLines_processBuf(&lineBuf, readBuf[:n], lineFn)
		if err != nil {
			break
		}
	}
}

func AdaptStreamToMsgCh(input io.Reader, output chan []byte) {
	streamToLines(input, func(line []byte) {
		output <- line
	})
}

func AdaptMsgChToStream(outputCh chan []byte, output io.Writer) error {
	for msg := range outputCh {
		if _, err := output.Write(msg); err != nil {
			return fmt.Errorf("error writing to output: %w", err)
		}
	}
	return nil
}

func AdaptMsgChToPty(outputCh chan []byte, oscEsc string, output io.Writer) error {
	if len(oscEsc) != 5 {
		panic("oscEsc must be 5 characters")
	}
	for msg := range outputCh {
		barr := EncodeWaveOSCBytes(oscEsc, msg)
		_, err := output.Write(barr)
		if err != nil {
			return fmt.Errorf("error writing to output: %w", err)
		}
	}
	return nil
}
