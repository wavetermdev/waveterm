package utilds

import (
	"bufio"
	"io"
	"sync"
)

type ReaderLineBuffer struct {
	lock           sync.Mutex
	lines          []string
	maxLines       int
	totalLineCount int
	reader         io.Reader
	scanner        *bufio.Scanner
	done           bool
	lineCallback   func(string)
}

func MakeReaderLineBuffer(reader io.Reader, maxLines int) *ReaderLineBuffer {
	if maxLines <= 0 {
		maxLines = 1000 // default max lines
	}

	rlb := &ReaderLineBuffer{
		lines:          make([]string, 0, maxLines),
		maxLines:       maxLines,
		totalLineCount: 0,
		reader:         reader,
		scanner:        bufio.NewScanner(reader),
		done:           false,
	}

	return rlb
}

func (rlb *ReaderLineBuffer) SetLineCallback(callback func(string)) {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()
	rlb.lineCallback = callback
}

func (rlb *ReaderLineBuffer) IsDone() bool {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()
	return rlb.done
}

func (rlb *ReaderLineBuffer) setDone() {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()
	rlb.done = true
}

func (rlb *ReaderLineBuffer) ReadLine() (string, error) {
	if rlb.IsDone() {
		return "", io.EOF
	}

	if rlb.scanner.Scan() {
		line := rlb.scanner.Text()
		rlb.addLine(line)
		return line, nil
	}

	// Check for scanner error
	if err := rlb.scanner.Err(); err != nil {
		rlb.setDone()
		return "", err
	}

	rlb.setDone()
	return "", io.EOF
}

func (rlb *ReaderLineBuffer) addLine(line string) {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()

	rlb.totalLineCount++

	if len(rlb.lines) >= rlb.maxLines {
		rlb.lines = append(rlb.lines[1:], line)
	} else {
		rlb.lines = append(rlb.lines, line)
	}
}

func (rlb *ReaderLineBuffer) GetLines() []string {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()

	result := make([]string, len(rlb.lines))
	copy(result, rlb.lines)
	return result
}

func (rlb *ReaderLineBuffer) GetLineCount() int {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()

	return len(rlb.lines)
}

func (rlb *ReaderLineBuffer) GetTotalLineCount() int {
	rlb.lock.Lock()
	defer rlb.lock.Unlock()

	return rlb.totalLineCount
}

func (rlb *ReaderLineBuffer) ReadAll() {
	for {
		line, err := rlb.ReadLine()
		if err != nil {
			break
		}
		if rlb.lineCallback != nil {
			rlb.lineCallback(line)
		}
	}
}
