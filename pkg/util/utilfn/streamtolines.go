// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"bytes"
	"context"
	"io"
	"time"
)

type LineOutput struct {
	Line  string
	Error error
}

type lineBuf struct {
	buf        []byte
	inLongLine bool
}

const maxLineLength = 128 * 1024

func ReadLineWithTimeout(ch chan LineOutput, timeout time.Duration) (string, error) {
	select {
	case output := <-ch:
		if output.Error != nil {
			return "", output.Error
		}
		return output.Line, nil
	case <-time.After(timeout):
		return "", context.DeadlineExceeded
	}
}

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

// starts a goroutine to drive the channel
// line output does not include the trailing newline
func StreamToLinesChan(input io.Reader) chan LineOutput {
	ch := make(chan LineOutput)
	go func() {
		defer close(ch)
		err := StreamToLines(input, func(line []byte) {
			ch <- LineOutput{Line: string(line)}
		})
		if err != nil && err != io.EOF {
			ch <- LineOutput{Error: err}
		}
	}()
	return ch
}
