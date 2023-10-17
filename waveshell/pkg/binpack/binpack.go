// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package binpack

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

type Unpacker struct {
	R   FullByteReader
	Err error
}

type FullByteReader interface {
	io.ByteReader
	io.Reader
}

func PackValue(w io.Writer, barr []byte) error {
	viBuf := make([]byte, binary.MaxVarintLen64)
	viLen := binary.PutUvarint(viBuf, uint64(len(barr)))
	_, err := w.Write(viBuf[0:viLen])
	if err != nil {
		return err
	}
	if len(barr) > 0 {
		_, err = w.Write(barr)
		if err != nil {
			return err
		}
	}
	return nil
}

func PackStrArr(w io.Writer, strs []string) error {
	barr, err := json.Marshal(strs)
	if err != nil {
		return err
	}
	return PackValue(w, barr)
}

func PackInt(w io.Writer, ival int) error {
	viBuf := make([]byte, binary.MaxVarintLen64)
	l := binary.PutUvarint(viBuf, uint64(ival))
	_, err := w.Write(viBuf[0:l])
	return err
}

func UnpackValue(r FullByteReader) ([]byte, error) {
	lenVal, err := binary.ReadUvarint(r)
	if err != nil {
		return nil, err
	}
	if lenVal == 0 {
		return nil, nil
	}
	rtnBuf := make([]byte, int(lenVal))
	_, err = io.ReadFull(r, rtnBuf)
	if err != nil {
		return nil, err
	}
	return rtnBuf, nil
}

func UnpackStrArr(r FullByteReader) ([]string, error) {
	barr, err := UnpackValue(r)
	if err != nil {
		return nil, err
	}
	var strs []string
	err = json.Unmarshal(barr, &strs)
	if err != nil {
		return nil, err
	}
	return strs, nil
}

func UnpackInt(r io.ByteReader) (int, error) {
	ival64, err := binary.ReadVarint(r)
	if err != nil {
		return 0, err
	}
	return int(ival64), nil
}

func (u *Unpacker) UnpackValue(name string) []byte {
	if u.Err != nil {
		return nil
	}
	rtn, err := UnpackValue(u.R)
	if err != nil {
		u.Err = fmt.Errorf("cannot unpack %s: %v", name, err)
	}
	return rtn
}

func (u *Unpacker) UnpackInt(name string) int {
	if u.Err != nil {
		return 0
	}
	rtn, err := UnpackInt(u.R)
	if err != nil {
		u.Err = fmt.Errorf("cannot unpack %s: %v", name, err)
	}
	return rtn
}

func (u *Unpacker) UnpackStrArr(name string) []string {
	if u.Err != nil {
		return nil
	}
	rtn, err := UnpackStrArr(u.R)
	if err != nil {
		u.Err = fmt.Errorf("cannot unpack %s: %v", name, err)
	}
	return rtn
}

func (u *Unpacker) Error() error {
	return u.Err
}

func MakeUnpacker(r FullByteReader) *Unpacker {
	return &Unpacker{R: r}
}
