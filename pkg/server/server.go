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
	"github.com/scripthaus-dev/mshell/pkg/shexec"
)

// TODO create unblockable packet-sender (backed by an array) for clientproc
type MServer struct {
	Lock      *sync.Mutex
	MainInput *packet.PacketParser
	Sender    *packet.PacketSender
	ClientMap map[base.CommandKey]*shexec.ClientProc
	Debug     bool
}

func (m *MServer) Close() {
	m.Sender.Close()
	m.Sender.WaitForDone()
}

func (m *MServer) ProcessCommandPacket(pk packet.CommandPacketType) {
	ck := pk.GetCK()
	if ck == "" {
		m.Sender.SendMessage(fmt.Sprintf("received '%s' packet without ck", pk.GetType()))
		return
	}
	m.Lock.Lock()
	cproc := m.ClientMap[ck]
	m.Lock.Unlock()
	if cproc == nil {
		m.Sender.SendCmdError(ck, fmt.Errorf("no client proc for ck '%s'", ck))
		return
	}
	cproc.Input.SendPacket(pk)
	return
}

func (m *MServer) runCommand(runPacket *packet.RunPacketType) {
	if err := runPacket.CK.Validate("packet"); err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require valid ck: %s", err))
		return
	}
	cproc, err := shexec.MakeClientProc(runPacket.CK)
	if err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("starting mshell client: %s", err))
		return
	}
	fmt.Printf("client start: %v\n", runPacket.CK)
	m.Lock.Lock()
	m.ClientMap[runPacket.CK] = cproc
	m.Lock.Unlock()
	go func() {
		defer func() {
			m.Lock.Lock()
			delete(m.ClientMap, runPacket.CK)
			m.Lock.Unlock()
			cproc.Close()
			fmt.Printf("client done: %v\n", runPacket.CK)
		}()
		shexec.SendRunPacketAndRunData(cproc.Input, runPacket)
		cproc.ProxyOutput(m.Sender)
	}()
}

func RunServer() (int, error) {
	debug := false
	if len(os.Args) >= 3 && os.Args[2] == "--debug" {
		debug = true
	}
	server := &MServer{
		Lock:      &sync.Mutex{},
		ClientMap: make(map[base.CommandKey]*shexec.ClientProc),
		Debug:     debug,
	}
	if debug {
		packet.GlobalDebug = true
	}
	server.MainInput = packet.MakePacketParser(os.Stdin)
	server.Sender = packet.MakePacketSender(os.Stdout)
	defer server.Close()
	var err error
	initPacket, err := shexec.MakeServerInitPacket()
	if err != nil {
		return 1, err
	}
	server.Sender.SendPacket(initPacket)
	builder := packet.MakeRunPacketBuilder()
	for pk := range server.MainInput.MainCh {
		if server.Debug {
			fmt.Printf("PK> %s\n", packet.AsString(pk))
		}
		ok, runPacket := builder.ProcessPacket(pk)
		if ok {
			if runPacket != nil {
				server.runCommand(runPacket)
				continue
			}
			continue
		}
		if cmdPk, ok := pk.(packet.CommandPacketType); ok {
			server.ProcessCommandPacket(cmdPk)
			continue
		}
		server.Sender.SendMessage(fmt.Sprintf("invalid packet '%s' sent to mshell server", packet.AsString(pk)))
		continue
	}
	return 0, nil
}
