// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package readutil

import (
	"bufio"
	"fmt"
	"io"
	"os"
)

const (
	StopReasonBOF       = "bof"
	StopReasonEOF       = "eof"
	StopReasonReadLimit = "read_limit"
)

// ReadLines reads lines from the reader, optionally skipping the first skipLines lines.
// If lineCount is 0, no line limit is applied. If readLimit is 0, no byte limit is applied.
// Stops when either limit is reached or EOF.
// Returns lines (with trailing newlines), stop reason, and error.
// Stop reason is StopReasonEOF when EOF is reached, StopReasonReadLimit when byte limit is reached,
// or empty string for natural returns (line count limit or no limits applied).
func ReadLines(reader io.Reader, lineCount int, skipLines int, readLimit int) ([]string, string, error) {
	bufReader := bufio.NewReader(reader)
	lines := make([]string, 0)
	bytesRead := 0
	skippedLines := 0

	for {
		line, err := bufReader.ReadString('\n')
		if len(line) > 0 {
			bytesRead += len(line)
			
			if skippedLines < skipLines {
				skippedLines++
			} else {
				lines = append(lines, line)
				if lineCount > 0 && len(lines) >= lineCount {
					return lines, "", nil
				}
			}
			
			if readLimit > 0 && bytesRead >= readLimit {
				return lines, StopReasonReadLimit, nil
			}
		}

		if err != nil {
			if err == io.EOF {
				return lines, StopReasonEOF, nil
			}
			return nil, "", err
		}
	}
}

// readLastNLineOffsets reads all line offsets from the reader, keeping only the last maxLines in a sliding window.
// keepFirst indicates whether offset 0 should be included (true if starting from file beginning).
// Returns the offsets and the total number of lines found.
func ReadLastNLineOffsets(rs io.ReadSeeker, maxLines int, keepFirst bool) ([]int64, int, error) {
	if _, err := rs.Seek(0, io.SeekStart); err != nil {
		return nil, 0, err
	}

	var offsets []int64
	reader := bufio.NewReader(rs)
	var currentPos int64 = 0
	totalLines := 0

	if keepFirst {
		offsets = append(offsets, 0)
		totalLines = 1
	}

	for {
		line, err := reader.ReadBytes('\n')

		if len(line) > 0 {
			currentPos += int64(len(line))
			offsets = append(offsets, currentPos)
			totalLines++
			// Keep maxLines+1 for sliding window (extra slot for EOF position)
			if len(offsets) > maxLines+1 {
				offsets = offsets[1:]
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, 0, err
		}
	}

	// Trim the final EOF offset if we have one
	if len(offsets) > 0 {
		offsets = offsets[:len(offsets)-1]
		totalLines--
	}

	return offsets, totalLines, nil
}

// readTailLinesInternal reads the last lineCount lines from the reader, excluding the last lineOffset lines.
// For example, lineCount=10 and lineOffset=5 would return lines -15 through -6 (the 10 lines before the last 5).
// keepFirst indicates whether the first line should be kept (true if starting at file position 0, false otherwise).
// Returns the lines (with trailing newlines), a hasMore flag, and any error.
// hasMore is true if there are lines before our window (didn't hit BOF), false if we read from the very beginning.
func readTailLinesInternal(rs io.ReadSeeker, lineCount int, lineOffset int, keepFirst bool) ([]string, bool, error) {
	maxOffsets := lineCount + lineOffset
	offsets, totalLines, err := ReadLastNLineOffsets(rs, maxOffsets, keepFirst)
	if err != nil {
		return nil, false, err
	}

	if totalLines <= lineOffset {
		return []string{}, false, nil
	}

	linesToRead := lineCount
	if totalLines-lineOffset < lineCount {
		linesToRead = totalLines - lineOffset
	}
	startIdx := len(offsets) - lineOffset - linesToRead
	hasMore := totalLines > lineCount+lineOffset

	if _, err := rs.Seek(offsets[startIdx], io.SeekStart); err != nil {
		return nil, false, err
	}

	lines, _, err := ReadLines(rs, linesToRead, 0, 0)
	if err != nil {
		return nil, false, err
	}

	return lines, hasMore, nil
}

// ReadTailLines reads the last lineCount lines from a file, excluding the last lineOffset lines.
// It progressively reads larger windows from the end of the file (starting at 1MB, doubling up to readLimit)
// until it finds enough lines or reaches the limit. Returns the lines, stop reason, and any error.
// Stop reason is StopReasonBOF when beginning of file is reached, StopReasonReadLimit when byte limit is reached,
// or empty string for natural completion (found requested line count).
func ReadTailLines(file *os.File, lineCount int, lineOffset int, readLimit int64) ([]string, string, error) {
	if readLimit <= 0 {
		return nil, "", fmt.Errorf("ReadTailLines readLimit must be positive, got %d", readLimit)
	}

	fileInfo, err := file.Stat()
	if err != nil {
		return nil, "", err
	}
	fileSize := fileInfo.Size()

	readBytes := int64(1024 * 1024)
	if readLimit < readBytes {
		readBytes = readLimit
	}

	for {
		startPos := fileSize - readBytes
		if startPos < 0 {
			startPos = 0
			readBytes = fileSize
		}

		sectionReader := io.NewSectionReader(file, startPos, readBytes)
		keepFirst := startPos == 0

		lines, hasMoreInWindow, err := readTailLinesInternal(sectionReader, lineCount, lineOffset, keepFirst)
		if err != nil {
			return nil, "", err
		}

		if len(lines) == lineCount {
			hasMore := startPos > 0 || hasMoreInWindow
			if !hasMore {
				return lines, StopReasonBOF, nil
			}
			return lines, "", nil
		}

		if readBytes >= readLimit || readBytes >= fileSize {
			if startPos > 0 {
				return lines, StopReasonReadLimit, nil
			}
			return lines, StopReasonBOF, nil
		}

		readBytes *= 2
		if readBytes > readLimit {
			readBytes = readLimit
		}
	}
}
