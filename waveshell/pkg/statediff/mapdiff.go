// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package statediff

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

const MapDiffVersion = 0

// 0-bytes are not allowed in entries or keys (same as bash)

type MapDiffType struct {
	ToAdd    map[string][]byte
	ToRemove []string
}

func (diff MapDiffType) Dump() {
	fmt.Printf("VAR-DIFF\n")
	for name, val := range diff.ToAdd {
		fmt.Printf("  add[%s] %s\n", name, val)
	}
	for _, name := range diff.ToRemove {
		fmt.Printf("  rem[%s]\n", name)
	}
}

func makeMapDiff(oldMap map[string][]byte, newMap map[string][]byte) MapDiffType {
	var rtn MapDiffType
	rtn.ToAdd = make(map[string][]byte)
	for name, newVal := range newMap {
		oldVal, found := oldMap[name]
		if !found || !bytes.Equal(oldVal, newVal) {
			rtn.ToAdd[name] = newVal
			continue
		}
	}
	for name := range oldMap {
		_, found := newMap[name]
		if !found {
			rtn.ToRemove = append(rtn.ToRemove, name)
		}
	}
	return rtn
}

func (diff MapDiffType) apply(oldMap map[string][]byte) map[string][]byte {
	rtn := make(map[string][]byte)
	for name, val := range oldMap {
		rtn[name] = val
	}
	for name, val := range diff.ToAdd {
		rtn[name] = val
	}
	for _, name := range diff.ToRemove {
		delete(rtn, name)
	}
	return rtn
}

func (diff MapDiffType) Encode() []byte {
	var buf bytes.Buffer
	viBuf := make([]byte, binary.MaxVarintLen64)
	putUVarint(&buf, viBuf, MapDiffVersion)
	putUVarint(&buf, viBuf, len(diff.ToAdd))
	for key, val := range diff.ToAdd {
		buf.WriteString(key)
		buf.WriteByte(0)
		buf.Write(val)
		buf.WriteByte(0)
	}
	for _, val := range diff.ToRemove {
		buf.WriteString(val)
		buf.WriteByte(0)
	}
	return buf.Bytes()
}

func (diff *MapDiffType) Decode(diffBytes []byte) error {
	r := bytes.NewBuffer(diffBytes)
	version, err := binary.ReadUvarint(r)
	if err != nil {
		return fmt.Errorf("invalid diff, cannot read version: %v", err)
	}
	if version != MapDiffVersion {
		return fmt.Errorf("invalid diff, bad version: %d", version)
	}
	mapLen64, err := binary.ReadUvarint(r)
	if err != nil {
		return fmt.Errorf("invalid diff, cannot map length: %v", err)
	}
	mapLen := int(mapLen64)
	fields := bytes.Split(r.Bytes(), []byte{0})
	if len(fields) < 2*mapLen {
		return fmt.Errorf("invalid diff, not enough fields, maplen:%d fields:%d", mapLen, len(fields))
	}
	mapFields := fields[0 : 2*mapLen]
	removeFields := fields[2*mapLen:]
	diff.ToAdd = make(map[string][]byte)
	for i := 0; i < len(mapFields); i += 2 {
		diff.ToAdd[string(mapFields[i])] = mapFields[i+1]
	}
	for _, removeVal := range removeFields {
		if len(removeVal) == 0 {
			continue
		}
		diff.ToRemove = append(diff.ToRemove, string(removeVal))
	}
	return nil
}

func MakeMapDiff(m1 map[string][]byte, m2 map[string][]byte) []byte {
	diff := makeMapDiff(m1, m2)
	if len(diff.ToAdd) == 0 && len(diff.ToRemove) == 0 {
		return nil
	}
	return diff.Encode()
}

func ApplyMapDiff(oldMap map[string][]byte, diffBytes []byte) (map[string][]byte, error) {
	if len(diffBytes) == 0 {
		return oldMap, nil
	}
	var diff MapDiffType
	err := diff.Decode(diffBytes)
	if err != nil {
		return nil, err
	}
	return diff.apply(oldMap), nil
}
