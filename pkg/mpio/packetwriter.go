// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package mpio

import (
	"encoding/base64"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

type PacketWriter struct {
	FdNum  int
	Sender *packet.PacketSender
	CK     base.CommandKey
}

func MakePacketWriter(fdNum int, sender *packet.PacketSender, ck base.CommandKey) *PacketWriter {
	return &PacketWriter{FdNum: fdNum, Sender: sender, CK: ck}
}

func (pw *PacketWriter) Write(data []byte) (int, error) {
	pk := packet.MakeDataPacket()
	pk.CK = pw.CK
	pk.FdNum = pw.FdNum
	pk.Data64 = base64.StdEncoding.EncodeToString(data)
	return len(data), pw.Sender.SendPacket(pk)
}

func (pw *PacketWriter) Close() error {
	pk := packet.MakeDataPacket()
	pk.CK = pw.CK
	pk.FdNum = pw.FdNum
	pk.Eof = true
	return pw.Sender.SendPacket(pk)
}
