// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
	"github.com/scripthaus-dev/sh2-runner/pkg/shexec"
)

func setupSignals(cmd *shexec.ShExecType) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		for sig := range sigCh {
			cmd.Cmd.Process.Signal(sig)
		}
	}()
}

func main() {
	packetCh := packet.PacketParser(os.Stdin)
	var runPacket *packet.RunPacketType
	for pk := range packetCh {
		if pk.GetType() == packet.PingPacketStr {
			continue
		}
		if pk.GetType() == packet.RunPacketStr {
			runPacket, _ = pk.(*packet.RunPacketType)
			break
		}
		if pk.GetType() == packet.ErrorPacketStr {
			packet.SendPacket(os.Stdout, pk)
			return
		}
		packet.SendErrorPacket(os.Stdout, fmt.Sprintf("invalid packet '%s' sent to runner", pk.GetType()))
		return
	}
	if runPacket == nil {
		packet.SendErrorPacket(os.Stdout, "did not receive a 'run' packet")
		return
	}
	cmd, err := shexec.RunCommand(runPacket)
	if err != nil {
		packet.SendErrorPacket(os.Stdout, fmt.Sprintf("error running command: %v", err))
		return
	}
	setupSignals(cmd)
	packet.SendPacket(os.Stdout, packet.MakeOkCmdPacket(fmt.Sprintf("running command %s/%s", runPacket.SessionId, runPacket.CmdId), runPacket.CmdId, cmd.Cmd.Process.Pid))
	cmd.WaitForCommand()
	packet.SendPacket(os.Stdout, packet.MakeDonePacket())
}
