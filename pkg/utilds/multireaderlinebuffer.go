package utilds

import (
	"bufio"
	"io"
	"sync"
)

type MultiReaderLineBuffer struct {
	lock           sync.Mutex
	lines          []string
	maxLines       int
	totalLineCount int
	lineCallback   func(string)
}

func MakeMultiReaderLineBuffer(maxLines int) *MultiReaderLineBuffer {
	if maxLines <= 0 {
		maxLines = 1000
	}

	return &MultiReaderLineBuffer{
		lines:          make([]string, 0, maxLines),
		maxLines:       maxLines,
		totalLineCount: 0,
	}
}

// callback is synchronous.  will block the consuming of lines and
// guaranteed to run in order.  it is also guaranteed only one callback
// will be running at a time (protected by the internal line lock)
func (mrlb *MultiReaderLineBuffer) SetLineCallback(callback func(string)) {
	mrlb.lock.Lock()
	defer mrlb.lock.Unlock()
	mrlb.lineCallback = callback
}

func (mrlb *MultiReaderLineBuffer) ReadAll(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		mrlb.addLine(line)
		mrlb.callLineCallback(line)
	}
}

func (mrlb *MultiReaderLineBuffer) callLineCallback(line string) {
	mrlb.lock.Lock()
	defer mrlb.lock.Unlock()

	if mrlb.lineCallback != nil {
		mrlb.lineCallback(line)
	}
}

func (mrlb *MultiReaderLineBuffer) addLine(line string) {
	mrlb.lock.Lock()
	defer mrlb.lock.Unlock()

	mrlb.totalLineCount++

	if len(mrlb.lines) >= mrlb.maxLines {
		mrlb.lines = append(mrlb.lines[1:], line)
	} else {
		mrlb.lines = append(mrlb.lines, line)
	}
}

func (mrlb *MultiReaderLineBuffer) GetLines() []string {
	mrlb.lock.Lock()
	defer mrlb.lock.Unlock()

	result := make([]string, len(mrlb.lines))
	copy(result, mrlb.lines)
	return result
}

func (mrlb *MultiReaderLineBuffer) GetLineCount() int {
	mrlb.lock.Lock()
	defer mrlb.lock.Unlock()

	return len(mrlb.lines)
}

func (mrlb *MultiReaderLineBuffer) GetTotalLineCount() int {
	mrlb.lock.Lock()
	defer mrlb.lock.Unlock()

	return mrlb.totalLineCount
}
