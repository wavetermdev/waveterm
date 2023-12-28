// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/server"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shexec"
)

var BuildTime = "0"

func readFullRunPacket(packetParser *packet.PacketParser) (*packet.RunPacketType, error) {
	rpb := packet.MakeRunPacketBuilder()
	for pk := range packetParser.MainCh {
		ok, runPacket := rpb.ProcessPacket(pk)
		if runPacket != nil {
			return runPacket, nil
		}
		if !ok {
			return nil, fmt.Errorf("invalid packet '%s' sent to mshell", pk.GetType())
		}
	}
	return nil, fmt.Errorf("no run packet received")
}

func handleSingle(shellType string) {
	packetParser := packet.MakePacketParser(os.Stdin, nil)
	sender := packet.MakePacketSender(os.Stdout, nil)
	defer func() {
		sender.Close()
		sender.WaitForDone()
	}()
	initPacket := shexec.MakeInitPacket()
	sender.SendPacket(initPacket)
	if len(os.Args) >= 3 && os.Args[2] == "--version" {
		return
	}
	runPacket, err := readFullRunPacket(packetParser)
	if err != nil {
		sender.SendErrorResponse(runPacket.ReqId, err)
		return
	}
	err = shexec.ValidateRunPacket(runPacket)
	if err != nil {
		sender.SendErrorResponse(runPacket.ReqId, err)
		return
	}
	err = runPacket.CK.Validate("run packet")
	if err != nil {
		sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("run packets from server must have a CK: %v", err))
	}
	if runPacket.Detached {
		cmd, startPk, err := shexec.RunCommandDetached(runPacket, sender)
		if err != nil {
			sender.SendErrorResponse(runPacket.ReqId, err)
			return
		}
		sender.SendPacket(startPk)
		sender.Close()
		sender.WaitForDone()
		cmd.DetachedWait(startPk)
		return
	} else {
		shexec.IgnoreSigPipe()
		ticker := time.NewTicker(1 * time.Minute)
		go func() {
			for range ticker.C {
				// this will let the command detect when the server has gone away
				// that will then trigger cmd.SendHup() to send SIGHUP to the exec'ed process
				sender.SendPacket(packet.MakePingPacket())
			}
		}()
		defer ticker.Stop()
		cmd, err := shexec.RunCommandSimple(runPacket, sender, true, shellType)
		if err != nil {
			sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("error running command: %w", err))
			return
		}
		defer cmd.Close()
		startPacket := cmd.MakeCmdStartPacket(runPacket.ReqId)
		sender.SendPacket(startPacket)
		go func() {
			exitErr := sender.WaitForDone()
			if exitErr != nil {
				base.Logf("I/O error talking to server, sending SIGHUP to children\n")
				cmd.SendSignal(syscall.SIGHUP)
			}
		}()
		cmd.RunRemoteIOAndWait(packetParser, sender)
		return
	}
}

func handleUsage() {
	usage := `
mshell is a helper program for wave terminal.  it is used to execute commands

Options:
    --help                 - prints this message
    --version              - print version
    --server               - multiplexer to run multiple commands
	--single               - run a single command (connected to multiplexer)
	--single --version     - return an init packet with version info

	--shell [bash|zsh]     - override default shell, force bash or zsh

mshell does not open any external ports and does not require any additional permissions.
it communicates exclusively through stdin/stdout with an attached process
via a JSON packet format.
`
	fmt.Printf("%s\n\n", strings.TrimSpace(usage))
}

// only allows bash or zsh (default is bash)
// in the future will detect the user's shell and set that as the default
func getShellType() string {
	shellType := packet.ShellType_bash
	for idx, arg := range os.Args {
		if idx == 0 {
			continue
		}
		if arg == "--shell" {
			if idx+1 < len(os.Args) {
				shellType = os.Args[idx+1]
				break
			}
			break
		}
	}
	if shellType != packet.ShellType_bash && shellType != packet.ShellType_zsh {
		shellType = packet.ShellType_bash
	}
	return shellType
}

func main() {
	base.SetBuildTime(BuildTime)
	if len(os.Args) == 1 {
		handleUsage()
		return
	}
	shellType := getShellType()
	firstArg := os.Args[1]
	if firstArg == "--help" {
		handleUsage()
		return
	} else if firstArg == "--version" {
		fmt.Printf("mshell %s+%s\n", base.MShellVersion, base.BuildTime)
		return
	} else if firstArg == "--single" || firstArg == "--single-from-server" {
		base.InitDebugLog("single")
		handleSingle(shellType)
		return
	} else if firstArg == "--server" {
		base.InitDebugLog("server")
		rtnCode, err := server.RunServer(shellType)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[error] %v\n", err)
		}
		if rtnCode != 0 {
			os.Exit(rtnCode)
		}
		return
	} else {
		handleUsage()
		return
	}
}
