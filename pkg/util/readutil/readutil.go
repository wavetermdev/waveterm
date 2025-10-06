// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package readutil

import (
	"bufio"
	"fmt"
	"io"
	"os"
)

// ReadLineOffsets seeks to filePos in the file and reads up to readAmt lines.
// It returns a slice of byte offsets where offsets[0] is filePos, offsets[1] is
// the start of the next line, etc. The slice will have at most readAmt+1 elements.
// The hasMore return value indicates whether there is more data after the lines read.
func ReadLineOffsets(file *os.File, filePos int64, readAmt int) ([]int64, bool, error) {
	if _, err := file.Seek(filePos, io.SeekStart); err != nil {
		return nil, false, err
	}

	offsets := make([]int64, 0, readAmt+1)
	offsets = append(offsets, filePos)

	reader := bufio.NewReader(file)
	currentPos := filePos

	for i := 0; i < readAmt; i++ {
		line, err := reader.ReadBytes('\n')

		if len(line) > 0 {
			currentPos += int64(len(line))
			offsets = append(offsets, currentPos)
		}

		if err != nil {
			if err == io.EOF {
				return offsets, false, nil
			}
			return nil, false, err
		}
	}

	// We successfully read readAmt lines, check if there's more
	_, err := reader.ReadByte()
	hasMore := (err == nil)

	return offsets, hasMore, nil
}

// ReadLines seeks to filePos in the file and reads up to readAmt lines.
// It returns the lines as strings (without trailing newlines).
func ReadLines(file *os.File, filePos int64, readAmt int) ([]string, error) {
	if _, err := file.Seek(filePos, io.SeekStart); err != nil {
		return nil, err
	}

	lines := make([]string, 0, readAmt)
	reader := bufio.NewReader(file)

	for i := 0; i < readAmt; i++ {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			// Remove trailing newline if present
			if line[len(line)-1] == '\n' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
		}

		if err != nil {
			if err == io.EOF {
				return lines, nil
			}
			return nil, err
		}
	}

	return lines, nil
}

// ReadLinesFromEnd reads lines from the end of a file with a range offset.
// lineStart and lineEnd are 0-based indices from the end of the file:
//   - Read(0, 99) returns the last 100 lines
//   - Read(100, 199) returns lines 100-199 from the end (with 100 lines after them)
// maxRead limits how many bytes to read backwards from the end of the file.
// Lines are returned in reading order (earliest line first).
func ReadLinesFromEnd(file *os.File, lineStart int, lineEnd int, maxRead int64) ([]string, error) {
	const chunkSize = 1024 * 1024 // 1MB

	fileInfo, err := file.Stat()
	if err != nil {
		return nil, err
	}
	fileSize := fileInfo.Size()

	if fileSize == 0 {
		return []string{}, nil
	}

	// Walk backwards collecting line offsets until we have enough
	neededLines := lineEnd + 1
	maxOffsets := neededLines + 100
	allOffsets := make([]int64, maxOffsets)
	writePos := maxOffsets
	currentEndPos := fileSize
	totalBytesRead := int64(0)

	for writePos > 0 && currentEndPos > 0 {
		chunkStart := currentEndPos - chunkSize
		if chunkStart < 0 {
			chunkStart = 0
		}

		chunkReadSize := currentEndPos - chunkStart
		totalBytesRead += chunkReadSize
		if totalBytesRead > maxRead {
			return nil, fmt.Errorf("exceeded max read size (%d bytes)", maxRead)
		}

		offsets, _, err := ReadLineOffsets(file, chunkStart, chunkSize)
		if err != nil {
			return nil, err
		}

		if len(offsets) == 0 {
			break
		}

		// If we only got 1 offset, the line is too long to fit in a chunk
		if len(offsets) == 1 {
			return nil, fmt.Errorf("line too long to read (exceeds chunk size)")
		}

		// Skip first offset if not at start of file (might be partial line)
		startIdx := 0
		if chunkStart > 0 {
			startIdx = 1
		}

		// Write offsets backwards into allOffsets array
		for i := len(offsets) - 1; i >= startIdx; i-- {
			writePos--
			allOffsets[writePos] = offsets[i]
			if writePos == 0 {
				break
			}
		}

		// Next iteration backs up from the first complete line
		if startIdx < len(offsets) {
			currentEndPos = offsets[startIdx]
		}

		if chunkStart == 0 || writePos == 0 {
			break
		}
	}

	// Slice to get only the filled portion
	allOffsets = allOffsets[writePos:]

	// Calculate actual line indices
	// allOffsets[i] is the byte offset of line i
	totalLines := len(allOffsets) - 1

	if totalLines == 0 {
		return []string{}, nil
	}

	// Clamp to available lines
	if lineEnd >= totalLines {
		lineEnd = totalLines - 1
	}
	if lineStart >= totalLines {
		return []string{}, nil
	}

	// Convert from "from end" indices to "from start" indices
	// lineStart=0 means last line (index totalLines-1)
	// lineEnd=99 means 100th line from end (index totalLines-100)
	fromStartIndex := totalLines - lineEnd - 1
	toStartIndex := totalLines - lineStart - 1

	startOffset := allOffsets[fromStartIndex]
	readAmt := toStartIndex - fromStartIndex + 1

	return ReadLines(file, startOffset, readAmt)
}