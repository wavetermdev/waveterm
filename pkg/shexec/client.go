package shexec

import (
	"fmt"
	"io"
	"os/exec"
	"time"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

type ClientProc struct {
	Cmd          *exec.Cmd
	CK           base.CommandKey
	StartTs      time.Time
	StdinWriter  io.WriteCloser
	StdoutReader io.ReadCloser
	StderrReader io.ReadCloser
	Input        *packet.PacketSender
	Output       *packet.PacketParser
}

func MakeClientProc(ck base.CommandKey) (*ClientProc, error) {
	ecmd, err := SSHOpts{}.MakeMShellSingleCmd()
	if err != nil {
		return nil, err
	}
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stdin pipe: %v", err)
	}
	stdoutReader, err := ecmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stdout pipe: %v", err)
	}
	stderrReader, err := ecmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stderr pipe: %v", err)
	}
	startTs := time.Now()
	err = ecmd.Start()
	if err != nil {
		return nil, fmt.Errorf("running local client: %w", err)
	}
	sender := packet.MakePacketSender(inputWriter)
	stdoutPacketParser := packet.MakePacketParser(stdoutReader)
	stderrPacketParser := packet.MakePacketParser(stderrReader)
	packetParser := packet.CombinePacketParsers(stdoutPacketParser, stderrPacketParser)
	cproc := &ClientProc{
		Cmd:          ecmd,
		CK:           ck,
		StartTs:      startTs,
		StdinWriter:  inputWriter,
		StdoutReader: stdoutReader,
		StderrReader: stderrReader,
		Input:        sender,
		Output:       packetParser,
	}
	versionOk := false
	for pk := range packetParser.MainCh {
		if pk.GetType() != packet.InitPacketStr {
			cproc.Close()
			return nil, fmt.Errorf("invalid packet received from mshell client: %s", packet.AsString(pk))
		}
		initPk := pk.(*packet.InitPacketType)
		if initPk.NotFound {
			cproc.Close()
			return nil, fmt.Errorf("mshell command not found on local server")
		}
		if initPk.Version != base.MShellVersion {
			cproc.Close()
			return nil, fmt.Errorf("invalid remote mshell version 'v%s', must be v%s", initPk.Version, base.MShellVersion)
		}
		versionOk = true
		break
	}
	if !versionOk {
		cproc.Close()
		return nil, fmt.Errorf("no init packet received from mshell client")
	}
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
		cproc.Cmd.Process.Kill()
	}
}

func (cproc *ClientProc) ProxyOutput(sender *packet.PacketSender) {
	sentDonePk := false
	for pk := range cproc.Output.MainCh {
		if pk.GetType() == packet.CmdDonePacketStr {
			sentDonePk = true
		}
		sender.SendPacket(pk)
	}
	exitErr := cproc.Cmd.Wait()
	if !sentDonePk {
		endTs := time.Now()
		cmdDuration := endTs.Sub(cproc.StartTs)
		donePacket := packet.MakeCmdDonePacket(cproc.CK)
		donePacket.Ts = endTs.UnixMilli()
		donePacket.ExitCode = GetExitCode(exitErr)
		donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
		sender.SendPacket(donePacket)
	}
}
