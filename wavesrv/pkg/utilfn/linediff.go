// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
)

const LineDiffVersion = 0

type LineDiffType struct {
	Lines   []int
	NewData []string
}

// simple encoding
// a 0 means read a line from NewData
// a non-zero number means read the 1-indexed line from OldData
func applyDiff(oldData []string, diff LineDiffType) ([]string, error) {
	rtn := make([]string, 0, len(diff.Lines))
	newDataPos := 0
	for i := 0; i < len(diff.Lines); i++ {
		if diff.Lines[i] == 0 {
			if newDataPos >= len(diff.NewData) {
				return nil, fmt.Errorf("not enough newdata for diff")
			}
			rtn = append(rtn, diff.NewData[newDataPos])
			newDataPos++
		} else {
			idx := diff.Lines[i] - 1 // 1-indexed
			if idx < 0 || idx >= len(oldData) {
				return nil, fmt.Errorf("diff index out of bounds %d old-data-len:%d", idx, len(oldData))
			}
			rtn = append(rtn, oldData[idx])
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
func encodeDiff(diff LineDiffType) []byte {
	var buf bytes.Buffer
	viBuf := make([]byte, binary.MaxVarintLen64)
	putUVarint(&buf, viBuf, 0)
	putUVarint(&buf, viBuf, len(diff.Lines))
	for _, val := range diff.Lines {
		putUVarint(&buf, viBuf, val)
	}
	for _, str := range diff.NewData {
		buf.WriteString(str)
		buf.WriteByte('\n')
	}
	return buf.Bytes()
}

func decodeDiff(diffBytes []byte) (LineDiffType, error) {
	var rtn LineDiffType
	r := bytes.NewBuffer(diffBytes)
	version, err := binary.ReadUvarint(r)
	if err != nil {
		return rtn, fmt.Errorf("invalid diff, cannot read version: %v", err)
	}
	if version != LineDiffVersion {
		return rtn, fmt.Errorf("invalid diff, bad version: %d", version)
	}
	linesLen64, err := binary.ReadUvarint(r)
	if err != nil {
		return rtn, fmt.Errorf("invalid diff, cannot read lines length: %v", err)
	}
	linesLen := int(linesLen64)
	rtn.Lines = make([]int, linesLen)
	for idx := 0; idx < linesLen; idx++ {
		vi, err := binary.ReadUvarint(r)
		if err != nil {
			return rtn, fmt.Errorf("invalid diff, cannot read line %d: %v", idx, err)
		}
		rtn.Lines[idx] = int(vi)
	}
	restOfInput := string(r.Bytes())
	rtn.NewData = strings.Split(restOfInput, "\n")
	return rtn, nil
}

func makeDiff(oldData []string, newData []string) LineDiffType {
	var rtn LineDiffType
	oldDataMap := make(map[string]int) // 1-indexed
	for idx, str := range oldData {
		if _, found := oldDataMap[str]; found {
			continue
		}
		oldDataMap[str] = idx + 1
	}
	rtn.Lines = make([]int, len(newData))
	for idx, str := range newData {
		oldIdx, found := oldDataMap[str]
		if found {
			rtn.Lines[idx] = oldIdx
		} else {
			rtn.Lines[idx] = 0
			rtn.NewData = append(rtn.NewData, str)
		}
	}
	return rtn
}

func MakeDiff(str1 string, str2 string) []byte {
	str1Arr := strings.Split(str1, "\n")
	str2Arr := strings.Split(str2, "\n")
	diff := makeDiff(str1Arr, str2Arr)
	return encodeDiff(diff)
}

func ApplyDiff(str1 string, diffBytes []byte) (string, error) {
	diff, err := decodeDiff(diffBytes)
	if err != nil {
		return "", err
	}
	str1Arr := strings.Split(str1, "\n")
	str2Arr, err := applyDiff(str1Arr, diff)
	if err != nil {
		return "", err
	}
	return strings.Join(str2Arr, "\n"), nil
}
