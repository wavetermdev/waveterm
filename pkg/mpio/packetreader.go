// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package mpio

import (
	"encoding/base64"
	"errors"
	"io"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/packet"
)

type PacketReader struct {
	CVar  *sync.Cond
	FdNum int
	Buf   []byte
	Eof   bool
	Err   error
}

func MakePacketReader(fdNum int) *PacketReader {
	return &PacketReader{
		CVar:  sync.NewCond(&sync.Mutex{}),
		FdNum: fdNum,
	}
}

func (pr *PacketReader) AddData(pk *packet.DataPacketType) {
	pr.CVar.L.Lock()
	defer pr.CVar.L.Unlock()
	defer pr.CVar.Broadcast()
	if pr.Eof || pr.Err != nil {
		return
	}
	if pk.Data64 != "" {
		realData, err := base64.StdEncoding.DecodeString(pk.Data64)
		if err != nil {
			pr.Err = err
			return
		}
		pr.Buf = append(pr.Buf, realData...)
	}
	pr.Eof = pk.Eof
	if pk.Error != "" {
		pr.Err = errors.New(pk.Error)
	}
	return
}

func (pr *PacketReader) Read(buf []byte) (int, error) {
	pr.CVar.L.Lock()
	defer pr.CVar.L.Unlock()
	for {
		if pr.Err != nil {
			return 0, pr.Err
		}
		if pr.Eof {
			return 0, io.EOF
		}
		if len(pr.Buf) == 0 {
			pr.CVar.Wait()
			continue
		}
		nr := copy(buf, pr.Buf)
		pr.Buf = pr.Buf[nr:]
		if len(pr.Buf) == 0 {
			pr.Buf = nil
		}
		return nr, nil
	}
}

func (pr *PacketReader) Close() error {
	pr.CVar.L.Lock()
	defer pr.CVar.L.Unlock()
	defer pr.CVar.Broadcast()
	if pr.Err == nil {
		pr.Err = io.ErrClosedPipe
	}
	return nil
}

type NullReader struct{}

func (NullReader) Read(buf []byte) (int, error) {
	return 0, io.EOF
}

func (NullReader) Close() error {
	return nil
}
