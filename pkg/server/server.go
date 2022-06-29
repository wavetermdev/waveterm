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
	Lock      *sync.Mutex
	MainInput *packet.PacketParser
	Sender    *packet.PacketSender
	FdContext *serverFdContext
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

func (m *MServer) MakeServerFdContext(ck base.CommandKey) *serverFdContext {
	rtn := &serverFdContext{
		M:       m,
		Lock:    &sync.Mutex{},
		Sender:  m.Sender,
		CK:      ck,
		Readers: make(map[int]*mpio.PacketReader),
	}
	return rtn
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
	return
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

func (m *MServer) runCommand(runPacket *packet.RunPacketType) {
	fdContext := m.MakeServerFdContext(runPacket.CK)
	m.Lock.Lock()
	m.FdContext = fdContext
	m.Lock.Unlock()
	go func() {
		donePk, err := shexec.RunClientSSHCommandAndWait(runPacket, fdContext, shexec.SSHOpts{}, true)
		fmt.Printf("done: err:%v, %v\n", err, donePk)
	}()
}

func RunServer() (int, error) {
	server := &MServer{
		Lock: &sync.Mutex{},
	}
	packet.GlobalDebug = true
	server.MainInput = packet.MakePacketParser(os.Stdin)
	server.Sender = packet.MakePacketSender(os.Stdout)
	defer server.Close()
	defer fmt.Printf("runserver done\n")
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
			server.runCommand(runPacket)
			continue
		}
		if pk.GetType() == packet.DataPacketStr {
			dataPacket := pk.(*packet.DataPacketType)
			server.FdContext.processDataPacket(dataPacket)
			continue
		}
		server.Sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to mshell", packet.AsExtType(pk)))
		continue
	}
	return 0, nil
}
