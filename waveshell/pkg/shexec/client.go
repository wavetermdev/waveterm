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
	defer func() {
		for _, extraFile := range cw.Cmd.ExtraFiles {
			if extraFile != nil {
				extraFile.Close()
			}
		}
	}()
	return cw.Cmd.Start()
}

func (cw CmdWrap) StdinPipe() (io.WriteCloser, error) {
	return cw.Cmd.StdinPipe()
}

func (cw CmdWrap) StdoutPipe() (io.ReadCloser, error) {
	return cw.Cmd.StdoutPipe()
}

func (cw CmdWrap) StderrPipe() (io.ReadCloser, error) {
	return cw.Cmd.StderrPipe()
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

func (sw SessionWrap) StdinPipe() (io.WriteCloser, error) {
	return sw.Session.StdinPipe()
}

func (sw SessionWrap) StdoutPipe() (io.ReadCloser, error) {
	stdoutReader, err := sw.Session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	return io.NopCloser(stdoutReader), nil
}

func (sw SessionWrap) StderrPipe() (io.ReadCloser, error) {
	stderrReader, err := sw.Session.StderrPipe()
	if err != nil {
		return nil, err
	}
	return io.NopCloser(stderrReader), nil
}

type ConnInterface interface {
	Kill()
	Wait() error
	Sender() (*packet.PacketSender, io.WriteCloser, error)
	Parser() (*packet.PacketParser, io.ReadCloser, io.ReadCloser, error)
	Start() error
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.ReadCloser, error)
	StderrPipe() (io.ReadCloser, error)
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

type WaveshellLaunchError struct {
	InitPk *packet.InitPacketType
}

func (wle WaveshellLaunchError) Error() string {
	if wle.InitPk.NotFound {
		return "waveshell client not found"
	} else if semver.MajorMinor(wle.InitPk.Version) != semver.MajorMinor(base.MShellVersion) {
		return fmt.Sprintf("invalid remote waveshell version '%s', must be '=%s'", wle.InitPk.Version, semver.MajorMinor(base.MShellVersion))
	}
	return fmt.Sprintf("invalid waveshell: init packet=%v", *wle.InitPk)
}

type InvalidPacketError struct {
	InvalidPk *packet.PacketType
}

func (ipe InvalidPacketError) Error() string {
	if ipe.InvalidPk == nil {
		return "no init packet received from waveshell client"
	}
	return fmt.Sprintf("invalid packet received from waveshell client: %s", packet.AsString(*ipe.InvalidPk))
}

// returns (clientproc, initpk, error)
func MakeClientProc(ctx context.Context, ecmd ConnInterface) (*ClientProc, error) {
	startTs := time.Now()
	sender, inputWriter, err := ecmd.Sender()
	if err != nil {
		return nil, err
	}
	packetParser, stdoutReader, stderrReader, err := ecmd.Parser()
	if err != nil {
		return nil, err
	}
	err = ecmd.Start()
	if err != nil {
		return nil, fmt.Errorf("running local client: %w", err)
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
		return nil, ctx.Err()
	}
	if pk == nil {
		cproc.Close()
		return nil, InvalidPacketError{}
	}
	if pk.GetType() != packet.InitPacketStr {
		cproc.Close()
		return nil, InvalidPacketError{InvalidPk: &pk}
	}
	initPk := pk.(*packet.InitPacketType)
	if initPk.NotFound {
		cproc.Close()
		return nil, WaveshellLaunchError{InitPk: initPk}
	}
	if semver.MajorMinor(initPk.Version) != semver.MajorMinor(base.MShellVersion) {
		cproc.Close()
		return nil, WaveshellLaunchError{InitPk: initPk}
	}
	cproc.InitPk = initPk
	return cproc, nil
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
