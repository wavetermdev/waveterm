// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package statediff

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
)

const LineDiffVersion = 0

type SingleLineEntry struct {
	LineVal int
	Run     int
}

type LineDiffType struct {
	Lines   []SingleLineEntry
	NewData []string
}

func (diff LineDiffType) Dump() {
	fmt.Printf("DIFF:\n")
	pos := 1
	for _, entry := range diff.Lines {
		fmt.Printf("  %d-%d: %d\n", pos, pos+entry.Run, entry.LineVal)
		pos += entry.Run
	}
	for idx, str := range diff.NewData {
		fmt.Printf("  n%d: %s\n", idx+1, str)
	}
}

// simple encoding
// a 0 means read a line from NewData
// a non-zero number means read the 1-indexed line from OldData
func (diff LineDiffType) applyDiff(oldData []string) ([]string, error) {
	rtn := make([]string, 0, len(diff.Lines))
	newDataPos := 0
	for _, entry := range diff.Lines {
		if entry.LineVal == 0 {
			for i := 0; i < entry.Run; i++ {
				if newDataPos >= len(diff.NewData) {
					return nil, fmt.Errorf("not enough newdata for diff")
				}
				rtn = append(rtn, diff.NewData[newDataPos])
				newDataPos++
			}
		} else {
			oldDataPos := entry.LineVal - 1 // 1-indexed
			for i := 0; i < entry.Run; i++ {
				realPos := oldDataPos + i
				if realPos < 0 || realPos >= len(oldData) {
					return nil, fmt.Errorf("diff index out of bounds %d old-data-len:%d", realPos, len(oldData))
				}
				rtn = append(rtn, oldData[realPos])
			}
		}
	}
	return rtn, nil
}

func putUVarint(buf *bytes.Buffer, viBuf []byte, ival int) {
	l := binary.PutUvarint(viBuf, uint64(ival))
	buf.Write(viBuf[0:l])
}

// simple encoding
// write varints.  first version, then len, then len-number-of-varints, then fill the rest with newdata
// [version] [len-varint] [varint]xlen... newdata (bytes)
func (diff LineDiffType) Encode() []byte {
	var buf bytes.Buffer
	viBuf := make([]byte, binary.MaxVarintLen64)
	putUVarint(&buf, viBuf, LineDiffVersion)
	putUVarint(&buf, viBuf, len(diff.Lines))
	for _, entry := range diff.Lines {
		putUVarint(&buf, viBuf, entry.LineVal)
		putUVarint(&buf, viBuf, entry.Run)
	}
	for idx, str := range diff.NewData {
		buf.WriteString(str)
		if idx != len(diff.NewData)-1 {
			buf.WriteByte('\n')
		}
	}
	return buf.Bytes()
}

func (rtn *LineDiffType) Decode(diffBytes []byte) error {
	r := bytes.NewBuffer(diffBytes)
	version, err := binary.ReadUvarint(r)
	if err != nil {
		return fmt.Errorf("invalid diff, cannot read version: %v", err)
	}
	if version != LineDiffVersion {
		return fmt.Errorf("invalid diff, bad version: %d", version)
	}
	linesLen64, err := binary.ReadUvarint(r)
	if err != nil {
		return fmt.Errorf("invalid diff, cannot read lines length: %v", err)
	}
	linesLen := int(linesLen64)
	rtn.Lines = make([]SingleLineEntry, linesLen)
	for idx := 0; idx < linesLen; idx++ {
		lineVal, err := binary.ReadUvarint(r)
		if err != nil {
			return fmt.Errorf("invalid diff, cannot read line %d: %v", idx, err)
		}
		lineRun, err := binary.ReadUvarint(r)
		if err != nil {
			return fmt.Errorf("invalid diff, cannot read line-run %d: %v", idx, err)
		}
		rtn.Lines[idx] = SingleLineEntry{LineVal: int(lineVal), Run: int(lineRun)}
	}
	restOfInput := string(r.Bytes())
	if len(restOfInput) > 0 {
		rtn.NewData = strings.Split(restOfInput, "\n")
	}
	return nil
}

func makeLineDiff(oldData []string, newData []string) LineDiffType {
	var rtn LineDiffType
	oldDataMap := make(map[string]int) // 1-indexed
	for idx, str := range oldData {
		if _, found := oldDataMap[str]; found {
			continue
		}
		oldDataMap[str] = idx + 1
	}
	var cur *SingleLineEntry
	rtn.Lines = make([]SingleLineEntry, 0)
	for _, str := range newData {
		oldIdx, found := oldDataMap[str]
		if cur != nil && cur.LineVal != 0 {
			checkLine := cur.LineVal + cur.Run - 1
			if checkLine < len(oldData) && oldData[checkLine] == str {
				cur.Run++
				continue
			}
		} else if cur != nil && cur.LineVal == 0 && !found {
			cur.Run++
			rtn.NewData = append(rtn.NewData, str)
			continue
		}
		if cur != nil {
			rtn.Lines = append(rtn.Lines, *cur)
		}
		cur = &SingleLineEntry{Run: 1}
		if found {
			cur.LineVal = oldIdx
		} else {
			cur.LineVal = 0
			rtn.NewData = append(rtn.NewData, str)
		}
	}
	if cur != nil {
		rtn.Lines = append(rtn.Lines, *cur)
	}
	return rtn
}

func MakeLineDiff(str1 string, str2 string) []byte {
	if str1 == str2 {
		return nil
	}
	str1Arr := strings.Split(str1, "\n")
	str2Arr := strings.Split(str2, "\n")
	diff := makeLineDiff(str1Arr, str2Arr)
	return diff.Encode()
}

func ApplyLineDiff(str1 string, diffBytes []byte) (string, error) {
	if len(diffBytes) == 0 {
		return str1, nil
	}
	var diff LineDiffType
	err := diff.Decode(diffBytes)
	if err != nil {
		return "", err
	}
	str1Arr := strings.Split(str1, "\n")
	str2Arr, err := diff.applyDiff(str1Arr)
	if err != nil {
		return "", err
	}
	return strings.Join(str2Arr, "\n"), nil
}
