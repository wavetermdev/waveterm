// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shexec

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"time"

	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"golang.org/x/crypto/ssh"
	"golang.org/x/mod/semver"
)

// TODO - track buffer sizes for sending input

const NotFoundVersion = "v0.0"

type CmdWrap struct {
	Cmd *exec.Cmd
}

func (cw CmdWrap) Kill() {
	cw.Cmd.Process.Kill()
}

func (cw CmdWrap) Wait() error {
	return cw.Cmd.Wait()
}

func (cw CmdWrap) Sender() (*packet.PacketSender, io.WriteCloser, error) {
	inputWriter, err := cw.Cmd.StdinPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("creating stdin pipe: %v", err)
	}
	sender := packet.MakePacketSender(inputWriter, nil)
	return sender, inputWriter, nil
}

func (cw CmdWrap) Parser() (*packet.PacketParser, io.ReadCloser, io.ReadCloser, error) {
	stdoutReader, err := cw.Cmd.StdoutPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("creating stdout pipe: %v", err)
	}
	stderrReader, err := cw.Cmd.StderrPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("creating stderr pipe: %v", err)
	}
	stdoutPacketParser := packet.MakePacketParser(stdoutReader, &packet.PacketParserOpts{IgnoreUntilValid: true})
	stderrPacketParser := packet.MakePacketParser(stderrReader, nil)
	packetParser := packet.CombinePacketParsers(stdoutPacketParser, stderrPacketParser, true)
	return packetParser, stdoutReader, stderrReader, nil
}

func (cw CmdWrap) Start() error {
	return cw.Cmd.Start()
}

type SessionWrap struct {
	Session  *ssh.Session
	StartCmd string
}

func (sw SessionWrap) Kill() {
	sw.Session.Close()
}

func (sw SessionWrap) Wait() error {
	return sw.Session.Wait()
}

func (sw SessionWrap) Start() error {
	return sw.Session.Start(sw.StartCmd)
}

func (sw SessionWrap) Sender() (*packet.PacketSender, io.WriteCloser, error) {
	inputWriter, err := sw.Session.StdinPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("creating stdin pipe: %v", err)
	}
	sender := packet.MakePacketSender(inputWriter, nil)
	return sender, inputWriter, nil
}

func (sw SessionWrap) Parser() (*packet.PacketParser, io.ReadCloser, io.ReadCloser, error) {
	stdoutReader, err := sw.Session.StdoutPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("creating stdout pipe: %v", err)
	}
	stderrReader, err := sw.Session.StderrPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("creating stderr pipe: %v", err)
	}
	stdoutPacketParser := packet.MakePacketParser(stdoutReader, &packet.PacketParserOpts{IgnoreUntilValid: true})
	stderrPacketParser := packet.MakePacketParser(stderrReader, nil)
	packetParser := packet.CombinePacketParsers(stdoutPacketParser, stderrPacketParser, true)
	return packetParser, io.NopCloser(stdoutReader), io.NopCloser(stderrReader), nil
}

type ConnInterface interface {
	Kill()
	Wait() error
	Sender() (*packet.PacketSender, io.WriteCloser, error)
	Parser() (*packet.PacketParser, io.ReadCloser, io.ReadCloser, error)
	Start() error
}

type ClientProc struct {
	Cmd          ConnInterface
	InitPk       *packet.InitPacketType
	StartTs      time.Time
	StdinWriter  io.WriteCloser
	StdoutReader io.ReadCloser
	StderrReader io.ReadCloser
	Input        *packet.PacketSender
	Output       *packet.PacketParser
}

// returns (clientproc, initpk, error)
func MakeClientProc(ctx context.Context, ecmd ConnInterface) (*ClientProc, *packet.InitPacketType, error) {
	startTs := time.Now()
	sender, inputWriter, err := ecmd.Sender()
	if err != nil {
		return nil, nil, err
	}
	packetParser, stdoutReader, stderrReader, err := ecmd.Parser()
	if err != nil {
		return nil, nil, err
	}
	err = ecmd.Start()
	if err != nil {
		return nil, nil, fmt.Errorf("running local client: %w", err)
	}
	cproc := &ClientProc{
		Cmd:          ecmd,
		StartTs:      startTs,
		StdinWriter:  inputWriter,
		StdoutReader: stdoutReader,
		StderrReader: stderrReader,
		Input:        sender,
		Output:       packetParser,
	}

	var pk packet.PacketType
	select {
	case pk = <-packetParser.MainCh:
	case <-ctx.Done():
		cproc.Close()
		return nil, nil, ctx.Err()
	}
	if pk != nil {
		if pk.GetType() != packet.InitPacketStr {
			cproc.Close()
			return nil, nil, fmt.Errorf("invalid packet received from mshell client: %s", packet.AsString(pk))
		}
		initPk := pk.(*packet.InitPacketType)
		if initPk.NotFound {
			cproc.Close()
			return nil, initPk, fmt.Errorf("mshell client not found")
		}
		if semver.MajorMinor(initPk.Version) != semver.MajorMinor(base.MShellVersion) {
			cproc.Close()
			return nil, initPk, fmt.Errorf("invalid remote mshell version '%s', must be '=%s'", initPk.Version, semver.MajorMinor(base.MShellVersion))
		}
		cproc.InitPk = initPk
	}
	if cproc.InitPk == nil {
		cproc.Close()
		return nil, nil, fmt.Errorf("no init packet received from mshell client")
	}
	return cproc, cproc.InitPk, nil
}

func (cproc *ClientProc) Close() {
	if cproc.Input != nil {
		cproc.Input.Close()
	}
	if cproc.StdinWriter != nil {
		cproc.StdinWriter.Close()
	}
	if cproc.StdoutReader != nil {
		cproc.StdoutReader.Close()
	}
	if cproc.StderrReader != nil {
		cproc.StderrReader.Close()
	}
	if cproc.Cmd != nil {
		cproc.Cmd.Kill()
	}
}

func (cproc *ClientProc) ProxySingleOutput(ck base.CommandKey, sender *packet.PacketSender, packetCallback func(packet.PacketType)) {
	sentDonePk := false
	for pk := range cproc.Output.MainCh {
		if packetCallback != nil {
			packetCallback(pk)
		}
		if pk.GetType() == packet.CmdDonePacketStr {
			sentDonePk = true
		}
		sender.SendPacket(pk)
	}
	exitErr := cproc.Cmd.Wait()
	if !sentDonePk {
		endTs := time.Now()
		cmdDuration := endTs.Sub(cproc.StartTs)
		donePacket := packet.MakeCmdDonePacket(ck)
		donePacket.Ts = endTs.UnixMilli()
		donePacket.ExitCode = GetExitCode(exitErr)
		donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
		sender.SendPacket(donePacket)
	}
}
