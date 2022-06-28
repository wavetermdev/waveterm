// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package server

import (
	"fmt"
	"os"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

type MServer struct {
	Lock      *sync.Mutex
	MainInput *packet.PacketParser
	Sender    *packet.PacketSender
}

func (m *MServer) Close() {
	m.Sender.Close()
	m.Sender.WaitForDone()
}

func RunServer() (int, error) {
	server := &MServer{
		Lock: &sync.Mutex{},
	}
	server.MainInput = packet.MakePacketParser(os.Stdin)
	server.Sender = packet.MakePacketSender(os.Stdout)
	defer server.Close()
	initPacket := packet.MakeInitPacket()
	initPacket.Version = base.MShellVersion
	server.Sender.SendPacket(initPacket)
	for pk := range server.MainInput.MainCh {
		fmt.Printf("PK> %s\n", packet.AsString(pk))
		if pk.GetType() == packet.PingPacketStr {
			continue
		}
		if pk.GetType() == packet.RunPacketStr {
			runPacket := pk.(*packet.RunPacketType)
			fmt.Printf("RUN> %s\n", runPacket)
			continue
		}
		server.Sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to mshell", packet.AsExtType(pk)))
		continue
	}
	return 0, nil
}
