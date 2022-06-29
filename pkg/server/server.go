// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package server

import (
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/mpio"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
)

type MServer struct {
	Lock         *sync.Mutex
	MainInput    *packet.PacketParser
	Sender       *packet.PacketSender
	FdContextMap map[base.CommandKey]*serverFdContext
	Debug        bool
}

func (m *MServer) Close() {
	m.Sender.Close()
	m.Sender.WaitForDone()
}

type serverFdContext struct {
	M       *MServer
	Lock    *sync.Mutex
	Sender  *packet.PacketSender
	CK      base.CommandKey
	Readers map[int]*mpio.PacketReader
}

func (c *serverFdContext) processDataPacket(pk *packet.DataPacketType) {
	c.Lock.Lock()
	reader := c.Readers[pk.FdNum]
	c.Lock.Unlock()
	if reader == nil {
		ackPacket := packet.MakeDataAckPacket()
		ackPacket.CK = c.CK
		ackPacket.FdNum = pk.FdNum
		ackPacket.Error = "write to closed file (no fd)"
		c.M.Sender.SendPacket(ackPacket)
		return
	}
	reader.AddData(pk)
}

func (m *MServer) MakeServerFdContext(ck base.CommandKey) *serverFdContext {
	m.Lock.Lock()
	defer m.Lock.Unlock()
	rtn := &serverFdContext{
		M:       m,
		Lock:    &sync.Mutex{},
		Sender:  m.Sender,
		CK:      ck,
		Readers: make(map[int]*mpio.PacketReader),
	}
	m.FdContextMap[ck] = rtn
	return rtn
}

func (m *MServer) ProcessCommandPacket(pk packet.CommandPacketType) {
	ck := pk.GetCK()
	if ck == "" {
		m.Sender.SendErrorPacket(fmt.Sprintf("received '%s' packet without ck", pk.GetType()))
		return
	}
	m.Lock.Lock()
	fdContext := m.FdContextMap[ck]
	m.Lock.Unlock()
	if fdContext == nil {
		m.Sender.SendCKErrorPacket(ck, fmt.Sprintf("no server context for ck '%s'", ck))
		return
	}
	if pk.GetType() == packet.DataPacketStr {
		dataPacket := pk.(*packet.DataPacketType)
		fdContext.processDataPacket(dataPacket)
		return
	} else if pk.GetType() == packet.DataAckPacketStr {
		m.Sender.SendPacket(pk)
		return
	} else {
		m.Sender.SendCKErrorPacket(ck, fmt.Sprintf("invalid packet '%s' received", packet.AsExtType(pk)))
		return
	}
}

func (c *serverFdContext) GetWriter(fdNum int) io.WriteCloser {
	return mpio.MakePacketWriter(fdNum, c.Sender, c.CK)
}

func (c *serverFdContext) GetReader(fdNum int) io.ReadCloser {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	reader := mpio.MakePacketReader(fdNum)
	c.Readers[fdNum] = reader
	return reader
}

func (m *MServer) RemoveFdContext(ck base.CommandKey) {
	m.Lock.Lock()
	defer m.Lock.Unlock()
	delete(m.FdContextMap, ck)
}

func (m *MServer) runCommand(runPacket *packet.RunPacketType) {
	if err := runPacket.CK.Validate("packet"); err != nil {
		m.Sender.SendErrorPacket(fmt.Sprintf("server run packets require valid ck: %s", err))
		return
	}
	fdContext := m.MakeServerFdContext(runPacket.CK)
	go func() {
		defer m.RemoveFdContext(runPacket.CK)
		donePk, err := shexec.RunClientSSHCommandAndWait(runPacket, fdContext, shexec.SSHOpts{}, m, m.Debug)
		if donePk != nil {
			m.Sender.SendPacket(donePk)
		}
		if err != nil {
			m.Sender.SendCKErrorPacket(runPacket.CK, err.Error())
		}
	}()
}

func (m *MServer) UnknownPacket(pk packet.PacketType) {
	m.Sender.SendPacket(pk)
}

func RunServer() (int, error) {
	debug := false
	if len(os.Args) >= 3 && os.Args[2] == "--debug" {
		debug = true
	}
	server := &MServer{
		Lock:         &sync.Mutex{},
		FdContextMap: make(map[base.CommandKey]*serverFdContext),
		Debug:        debug,
	}
	if debug {
		packet.GlobalDebug = true
	}
	server.MainInput = packet.MakePacketParser(os.Stdin)
	server.Sender = packet.MakePacketSender(os.Stdout)
	defer server.Close()
	initPacket := packet.MakeInitPacket()
	initPacket.Version = base.MShellVersion
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
		server.Sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to mshell", packet.AsString(pk)))
		continue
	}
	return 0, nil
}
