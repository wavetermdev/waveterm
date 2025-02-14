// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package logview

import (
	"fmt"
	"io"
	"os"
	"regexp"
)

const BufSize = 256 * 1024
const MaxLineSize = 1024

type LinePtr struct {
	Offset      int64
	RealLineNum int64
	LineNum     int64
}

type LogView struct {
	File     *os.File
	MultiBuf *MultiBufferByteGetter
	MatchRe  *regexp.Regexp
}

func MakeLogView(file *os.File) *LogView {
	return &LogView{
		File:     file,
		MultiBuf: MakeMultiBufferByteGetter(file, BufSize),
	}
}

func (lv *LogView) Close() {
	lv.File.Close()
}

func (lv *LogView) ReadLineData(linePtr *LinePtr) ([]byte, error) {
	return lv.readLineAt(linePtr.Offset)
}

func (lv *LogView) readLineAt(offset int64) ([]byte, error) {
	var rtn []byte
	for {
		if len(rtn) > MaxLineSize {
			break
		}
		b, err := lv.MultiBuf.GetByte(offset)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if b == '\n' {
			break
		}
		rtn = append(rtn, b)
		offset++
	}
	return rtn, nil
}

func (lv *LogView) FirstLinePtr() (*LinePtr, error) {
	linePtr := &LinePtr{Offset: 0, RealLineNum: 1, LineNum: 1}
	if lv.isLineMatch(0) {
		return linePtr, nil
	}
	return lv.NextLinePtr(linePtr)
}

func (lv *LogView) isLineMatch(offset int64) bool {
	if lv.MatchRe == nil {
		return true
	}
	lineData, err := lv.readLineAt(offset)
	if err != nil {
		return false
	}
	return lv.MatchRe.Match(lineData)
}

func (lv *LogView) NextLinePtr(linePtr *LinePtr) (*LinePtr, error) {
	if linePtr == nil {
		return nil, fmt.Errorf("linePtr is nil")
	}
	numLines := int64(0)
	offset := linePtr.Offset
	for {
		var err error
		nextOffset, err := lv.MultiBuf.NextLine(offset)
		if err == io.EOF {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		numLines++
		if lv.isLineMatch(nextOffset) {
			return &LinePtr{Offset: nextOffset, RealLineNum: linePtr.RealLineNum + numLines, LineNum: linePtr.LineNum + 1}, nil
		}
		offset = nextOffset
	}
}

func (lv *LogView) PrevLinePtr(linePtr *LinePtr) (*LinePtr, error) {
	if linePtr == nil {
		return nil, fmt.Errorf("linePtr is nil")
	}
	numLines := int64(0)
	offset := linePtr.Offset
	for {
		var err error
		prevOffset, err := lv.MultiBuf.PrevLine(offset)
		if err == ErrBOF {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		numLines++
		if lv.isLineMatch(prevOffset) {
			return &LinePtr{Offset: prevOffset, RealLineNum: linePtr.RealLineNum - numLines, LineNum: linePtr.LineNum - 1}, nil
		}
		offset = prevOffset
	}
}

func (lv *LogView) Move(linePtr *LinePtr, offset int) (int, *LinePtr, error) {
	var n int
	if offset > 0 {
		for {
			nextLinePtr, err := lv.NextLinePtr(linePtr)
			if err == io.EOF {
				break
			}
			if err != nil {
				return 0, nil, err
			}
			linePtr = nextLinePtr
			n++
			if n == offset {
				break
			}
		}
		return n, linePtr, nil
	}
	if offset < 0 {
		for {
			prevLinePtr, err := lv.PrevLinePtr(linePtr)
			if err == ErrBOF {
				break
			}
			if err != nil {
				return 0, nil, err
			}
			linePtr = prevLinePtr
			n--
			if n == offset {
				break
			}
		}
		return n, linePtr, nil
	}
	return 0, linePtr, nil
}

func (lv *LogView) LastLinePtr(linePtr *LinePtr) (*LinePtr, error) {
	if linePtr == nil {
		var err error
		linePtr, err = lv.FirstLinePtr()
		if err != nil {
			return nil, err
		}
	}
	if linePtr == nil {
		return nil, nil
	}
	for {
		nextLinePtr, err := lv.NextLinePtr(linePtr)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if nextLinePtr == nil {
			break
		}
		linePtr = nextLinePtr
	}
	return linePtr, nil
}

func (lv *LogView) ReadWindow(linePtr *LinePtr, winSize int) ([][]byte, error) {
	if linePtr == nil {
		return nil, nil
	}
	var rtn [][]byte
	for len(rtn) < winSize {
		lineData, err := lv.readLineAt(linePtr.Offset)
		if err != nil {
			return nil, err
		}
		rtn = append(rtn, lineData)
		nextLinePtr, err := lv.NextLinePtr(linePtr)
		if err != nil {
			return nil, err
		}
		if nextLinePtr == nil {
			break
		}
		linePtr = nextLinePtr
	}
	return rtn, nil
}
