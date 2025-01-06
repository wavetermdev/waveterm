// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package logview

import (
	"errors"
	"io"
	"os"
)

type MultiBufferByteGetter struct {
	File    *os.File
	Offset  int64
	EOF     bool
	Buffers [][]byte
	BufSize int64
}

var ErrBOF = errors.New("beginning of file")

func MakeMultiBufferByteGetter(file *os.File, bufSize int64) *MultiBufferByteGetter {
	return &MultiBufferByteGetter{
		File:    file,
		Offset:  0,
		EOF:     false,
		Buffers: [][]byte{},
		BufSize: bufSize,
	}
}

func (mb *MultiBufferByteGetter) readFromBuffer(offset int64) (byte, bool) {
	if offset < mb.Offset || offset >= mb.Offset+int64(mb.bufSize()) {
		return 0, false
	}
	bufIdx := int((offset - mb.Offset) / mb.BufSize)
	bufOffset := (offset - mb.Offset) % mb.BufSize
	return mb.Buffers[bufIdx][bufOffset], true
}

func (mb *MultiBufferByteGetter) bufSize() int {
	return len(mb.Buffers) * int(mb.BufSize)
}

func (mb *MultiBufferByteGetter) rebuffer(newOffset int64) error {
	partNum := int(newOffset / mb.BufSize)
	partOffset := int64(partNum) * mb.BufSize
	newBuf := make([]byte, mb.BufSize)
	n, err := mb.File.ReadAt(newBuf, partOffset)
	var isEOF bool
	if err == io.EOF {
		newBuf = newBuf[:n]
		isEOF = true
	}
	if err != nil {
		return err
	}
	var newBuffers [][]byte
	if len(mb.Buffers) > 0 {
		firstBufPartNum := int(mb.Offset / mb.BufSize)
		lastBufPartNum := int((mb.Offset + int64(mb.bufSize())) / mb.BufSize)
		if firstBufPartNum == partNum+1 {
			newBuffers = [][]byte{newBuf, mb.Buffers[0]}
		} else if lastBufPartNum == partNum-1 {
			newBuffers = [][]byte{mb.Buffers[0], newBuf}
		} else {
			newBuffers = [][]byte{newBuf}
		}
	} else {
		newBuffers = [][]byte{newBuf}
	}
	mb.Buffers = newBuffers
	mb.Offset = partOffset
	mb.EOF = isEOF
	return nil
}

func (mb *MultiBufferByteGetter) GetByte(offset int64) (byte, error) {
	b, ok := mb.readFromBuffer(offset)
	if ok {
		return b, nil
	}
	if mb.EOF && offset >= mb.Offset+int64(mb.bufSize()) {
		return 0, io.EOF
	}
	err := mb.rebuffer(offset)
	if err != nil {
		return 0, err
	}
	b, _ = mb.readFromBuffer(offset)
	return b, nil
}

func (mb *MultiBufferByteGetter) NextLine(offset int64) (int64, error) {
	for {
		b, err := mb.GetByte(offset)
		if err != nil {
			return 0, err
		}
		if b == '\n' {
			break
		}
		offset++
	}
	_, lastErr := mb.GetByte(offset + 1)
	if lastErr == io.EOF {
		return 0, io.EOF
	}
	return offset + 1, nil
}

func (mb *MultiBufferByteGetter) PrevLine(offset int64) (int64, error) {
	if offset == 0 {
		return 0, ErrBOF
	}
	offset = offset - 2
	for {
		if offset < 0 {
			break
		}
		b, err := mb.GetByte(offset)
		if err != nil {
			return 0, err
		}
		if b == '\n' {
			break
		}
		offset--
	}
	return offset + 1, nil
}
