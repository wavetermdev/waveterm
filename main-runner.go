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
	"time"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-runner/pkg/base"
	"github.com/scripthaus-dev/sh2-runner/pkg/cmdtail"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
	"github.com/scripthaus-dev/sh2-runner/pkg/shexec"
)

// in single run mode, we don't want the runner to die from signals
// since we want the single runner to persist even if session / main runner
// is terminated.
func setupSingleSignals(cmd *shexec.ShExecType) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for range sigCh {
			// do nothing
		}
	}()
}

func doSingle(cmdId string) {
	packetCh := packet.PacketParser(os.Stdin)
	sender := packet.MakePacketSender(os.Stdout)
	var runPacket *packet.RunPacketType
	for pk := range packetCh {
		if pk.GetType() == packet.PingPacketStr {
			continue
		}
		if pk.GetType() == packet.RunPacketStr {
			runPacket, _ = pk.(*packet.RunPacketType)
			break
		}
		sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to runner", pk.GetType()))
		return
	}
	if runPacket == nil {
		sender.SendErrorPacket("did not receive a 'run' packet")
		return
	}
	if runPacket.CmdId == "" {
		runPacket.CmdId = cmdId
	}
	if runPacket.CmdId != cmdId {
		sender.SendErrorPacket(fmt.Sprintf("run packet cmdid[%s] did not match arg[%s]", runPacket.CmdId, cmdId))
		return
	}
	cmd, err := shexec.RunCommand(runPacket, sender)
	if err != nil {
		sender.SendErrorPacket(fmt.Sprintf("error running command: %v", err))
		return
	}
	setupSingleSignals(cmd)
	startPacket := packet.MakeCmdStartPacket()
	startPacket.Ts = time.Now().UnixMilli()
	startPacket.CmdId = runPacket.CmdId
	startPacket.Pid = cmd.Cmd.Process.Pid
	startPacket.RunnerPid = os.Getpid()
	sender.SendPacket(startPacket)
	donePacket := cmd.WaitForCommand(runPacket.CmdId)
	sender.SendPacket(donePacket)
	sender.CloseSendCh()
	sender.WaitForDone()
}

func doMainRun(pk *packet.RunPacketType, sender *packet.PacketSender) {
	if pk.CmdId == "" {
		pk.CmdId = uuid.New().String()
	}
	err := shexec.ValidateRunPacket(pk)
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("invalid run packet: %v", err)))
		return
	}
	fileNames, err := base.GetCommandFileNames(pk.SessionId, pk.CmdId)
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot get command file names: %v", err)))
		return
	}
	cmd, err := shexec.MakeRunnerExec(pk.CmdId)
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot make runner command: %v", err)))
		return
	}
	cmdStdin, err := cmd.StdinPipe()
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot pipe stdin to command: %v", err)))
		return
	}
	runnerOutFd, err := os.OpenFile(fileNames.RunnerOutFile, os.O_CREATE|os.O_TRUNC|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot open runner out file '%s': %v", fileNames.RunnerOutFile, err)))
		return
	}
	defer runnerOutFd.Close()
	cmd.Stdout = runnerOutFd
	cmd.Stderr = runnerOutFd
	err = cmd.Start()
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("error starting command: %v", err)))
		return
	}
	go func() {
		err = packet.SendPacket(cmdStdin, pk)
		if err != nil {
			sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("error sending forked runner command: %v", err)))
			return
		}
		cmdStdin.Close()

		// clean up zombies
		cmd.Wait()
	}()
}

func doGetCmd(tailer *cmdtail.Tailer, pk *packet.GetCmdPacketType, sender *packet.PacketSender) error {
	err := tailer.AddWatch(pk)
	if err != nil {
		return err
	}
	return nil
}

func doMain() {
	scHomeDir, err := base.GetScHomeDir()
	if err != nil {
		packet.SendErrorPacket(os.Stdout, err.Error())
		return
	}
	homeDir := base.GetHomeDir()
	err = os.Chdir(homeDir)
	if err != nil {
		packet.SendErrorPacket(os.Stdout, fmt.Sprintf("cannot change directory to $HOME '%s': %v", homeDir, err))
		return
	}
	err = base.EnsureRunnerPath()
	if err != nil {
		packet.SendErrorPacket(os.Stdout, err.Error())
		return
	}
	packetCh := packet.PacketParser(os.Stdin)
	sender := packet.MakePacketSender(os.Stdout)
	tailer, err := cmdtail.MakeTailer(sender.SendCh)
	if err != nil {
		packet.SendErrorPacket(os.Stdout, err.Error())
		return
	}
	go tailer.Run()
	initPacket := packet.MakeRunnerInitPacket()
	initPacket.Env = os.Environ()
	initPacket.HomeDir = homeDir
	initPacket.ScHomeDir = scHomeDir
	sender.SendPacket(initPacket)
	for pk := range packetCh {
		if pk.GetType() == packet.PingPacketStr {
			continue
		}
		if pk.GetType() == packet.RunPacketStr {
			doMainRun(pk.(*packet.RunPacketType), sender)
			continue
		}
		if pk.GetType() == packet.GetCmdPacketStr {
			err = doGetCmd(tailer, pk.(*packet.GetCmdPacketType), sender)
			if err != nil {
				errPk := packet.MakeErrorPacket(err.Error())
				sender.SendPacket(errPk)
			}
			continue
		}
		if pk.GetType() == packet.ErrorPacketStr {
			errPk := pk.(*packet.ErrorPacketType)
			errPk.Error = "invalid packet sent to runner: " + errPk.Error
			sender.SendPacket(errPk)
			continue
		}
		sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to runner", pk.GetType()))
	}
}

func main() {
	if len(os.Args) >= 2 {
		cmdId, err := uuid.Parse(os.Args[1])
		if err != nil {
			packet.SendErrorPacket(os.Stdout, fmt.Sprintf("invalid non-cmdid passed to runner", err))
			return
		}
		doSingle(cmdId.String())
		return
	} else {
		doMain()
	}
}
