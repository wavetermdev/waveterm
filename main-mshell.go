// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package main

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/cmdtail"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
)

const MShellVersion = "0.1.0"

// in single run mode, we don't want mshell to die from signals
// since we want the single mshell to persist even if session / main mshell
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
		sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to mshell", pk.GetType()))
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
	startPacket := cmd.MakeCmdStartPacket()
	sender.SendPacket(startPacket)
	donePacket := cmd.WaitForCommand()
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
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot make mshell command: %v", err)))
		return
	}
	cmdStdin, err := cmd.StdinPipe()
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot pipe stdin to command: %v", err)))
		return
	}
	// touch ptyout file (should exist for tailer to work correctly)
	ptyOutFd, err := os.OpenFile(fileNames.PtyOutFile, os.O_CREATE|os.O_TRUNC|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		sender.SendPacket(packet.MakeIdErrorPacket(pk.CmdId, fmt.Sprintf("cannot open pty out file '%s': %v", fileNames.PtyOutFile, err)))
		return
	}
	ptyOutFd.Close() // just opened to create the file, can close right after
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
	_, err = base.GetMShellPath()
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
	initPacket := packet.MakeInitPacket()
	initPacket.Env = os.Environ()
	initPacket.HomeDir = homeDir
	initPacket.ScHomeDir = scHomeDir
	if user, _ := user.Current(); user != nil {
		initPacket.User = user.Username
	}
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
				continue
			}
			continue
		}
		if pk.GetType() == packet.CdPacketStr {
			cdPacket := pk.(*packet.CdPacketType)
			err := os.Chdir(cdPacket.Dir)
			resp := packet.MakeResponsePacket(cdPacket.PacketId)
			if err != nil {
				resp.Error = err.Error()
			} else {
				resp.Success = true
			}
			sender.SendPacket(resp)
			continue
		}
		if pk.GetType() == packet.ErrorPacketStr {
			errPk := pk.(*packet.ErrorPacketType)
			errPk.Error = "invalid packet sent to mshell: " + errPk.Error
			sender.SendPacket(errPk)
			continue
		}
		sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to mshell", pk.GetType()))
	}
}

func handleRemote() {
	packetCh := packet.PacketParser(os.Stdin)
	sender := packet.MakePacketSender(os.Stdout)
	defer func() {
		// wait for sender to complete
		close(sender.SendCh)
		<-sender.DoneCh
	}()
	initPacket := packet.MakeInitPacket()
	initPacket.Version = MShellVersion
	sender.SendPacket(initPacket)
	var runPacket *packet.RunPacketType
	for pk := range packetCh {
		if pk.GetType() == packet.PingPacketStr {
			continue
		}
		if pk.GetType() == packet.RunPacketStr {
			runPacket, _ = pk.(*packet.RunPacketType)
			break
		}
		if pk.GetType() == packet.RawPacketStr {
			rawPk := pk.(*packet.RawPacketType)
			sender.SendMessage("got raw packet '%s'", rawPk.Data)
			continue
		}
		sender.SendErrorPacket(fmt.Sprintf("invalid packet '%s' sent to mshell", pk.GetType()))
		return
	}
	cmd, err := shexec.RunCommand(runPacket, sender)
	if err != nil {
		sender.SendErrorPacket(fmt.Sprintf("error running command: %v", err))
		return
	}
	defer cmd.Close()
	startPacket := cmd.MakeCmdStartPacket()
	sender.SendPacket(startPacket)
	cmd.RunIOAndWait(packetCh, sender)
}

func handleServer() {
}

func detectOpenFds() {

}

type ClientOpts struct {
	IsSSH       bool
	SSHOptsTerm bool
	SSHOpts     []string
	Command     string
	Fds         []packet.RemoteFd
	Cwd         string
}

func parseClientOpts() (*ClientOpts, error) {
	opts := &ClientOpts{}
	iter := base.MakeOptsIter(os.Args[1:])
	for iter.HasNext() {
		argStr := iter.Next()
		if argStr == "--ssh" {
			if opts.IsSSH {
				return nil, fmt.Errorf("duplicate '--ssh' option")
			}
			opts.IsSSH = true
			break
		}
	}
	if opts.IsSSH {
		// parse SSH opts
		for iter.HasNext() {
			argStr := iter.Next()
			if argStr == "--" {
				opts.SSHOptsTerm = true
				break
			}
			if argStr == "--cwd" {
				if !iter.HasNext() {
					return nil, fmt.Errorf("'--cwd [dir]' missing directory")
				}
			}
			opts.SSHOpts = append(opts.SSHOpts, argStr)
		}
		if !opts.SSHOptsTerm {
			return nil, fmt.Errorf("ssh options must be terminated with '--' followed by [command]")
		}
		if !iter.HasNext() {
			return nil, fmt.Errorf("no command specified")
		}
		opts.Command = strings.Join(iter.Rest(), " ")
		if strings.TrimSpace(opts.Command) == "" {
			return nil, fmt.Errorf("no command or empty command specified")
		}
	}
	return opts, nil
}

func handleClient() (int, error) {
	fmt.Printf("mshell client\n")
	opts, err := parseClientOpts()
	if err != nil {
		return 1, fmt.Errorf("parsing opts: %w", err)
	}
	if !opts.IsSSH {
		return 1, fmt.Errorf("when running in client mode '--ssh' option must be present")
	}
	fmt.Printf("opts: %v\n", opts)
	sshRemoteCommand := `PATH=$PATH:~/.mshell; mshell --remote`
	sshOpts := append(opts.SSHOpts, sshRemoteCommand)
	ecmd := exec.Command("ssh", sshOpts...)
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return 1, fmt.Errorf("creating stdin pipe: %v", err)
	}
	outputReader, err := ecmd.StdoutPipe()
	if err != nil {
		return 1, fmt.Errorf("creating stdout pipe: %v", err)
	}
	ecmd.Stderr = ecmd.Stdout
	err = ecmd.Start()
	if err != nil {
		return 1, fmt.Errorf("running ssh command: %w", err)
	}
	parser := packet.PacketParser(outputReader)
	go func() {
		fmt.Printf("%v %v\n", parser, inputWriter)
	}()
	exitErr := ecmd.Wait()
	return shexec.GetExitCode(exitErr), nil
}

func handleUsage() {
	usage := `
Client Usage: mshell [mshell-opts] --ssh [ssh-opts] user@host -- [command]

mshell multiplexes input and output streams to a remote command over ssh.

Options:
    --env 'X=Y;A=B'   - set remote environment variables for command, semicolon separated
    --env-file [file] - load environment variables from [file] (.env format)
    --env-copy [glob] - copy local environment variables to remote using [glob] pattern
    --cwd [dir]       - execute remote command in [dir]
    --no-auto-fds     - do not auto-detect additional fds
    --sudo            - execute "sudo [command]"
    --fds [fdspec]    - open fds based off [fdspec], comma separated (implies --no-auto-fds)
                        <[num] opens for reading
                        >[num] opens for writing
                        e.g. --fds '<5,>6,>7'
    [command]         - a single argument (should be quoted)

Examples:
    # execute a python script remotely, with stdin still hooked up correctly
    mshell --cwd "~/work" --ssh -i key.pem ubuntu@somehost -- "python /dev/fd/4" 4< myscript.py

    # capture multiple outputs
    mshell --ssh ubuntu@test -- "cat file1.txt > /dev/fd/3; cat file2.txt > /dev/fd/4" 3> file1.txt 4> file2.txt

    # environment variable copying, setting working directory
    # note the single quotes on command (otherwise the local shell will expand the variables)
    TEST1=hello TEST2=world mshell --cwd "~/work" --env-copy "TEST*" --ssh user@host -- 'echo $(pwd) $TEST1 $TEST2'

    # execute a script, catpure stdout/stderr in fd-3 and fd-4
    # useful if you need to see stdout for interacting with ssh (password or host auth)
    mshell --ssh user@host -- "test.sh > /dev/fd/3 2> /dev/fd/4" 3> test.stdout 4> test.stderr

mshell is licensed under the MPLv2
Please see https://github.com/scripthaus-dev/mshell for extended usage modes, source code, bugs, and feature requests
`
	fmt.Printf("%s\n\n", strings.TrimSpace(usage))
}

func main() {
	if len(os.Args) == 1 {
		handleUsage()
		return
	}
	firstArg := os.Args[1]
	if firstArg == "--help" {
		handleUsage()
		return
	} else if firstArg == "--version" {
		fmt.Printf("mshell v%s\n", MShellVersion)
		return
	} else if firstArg == "--remote" {
		handleRemote()
		return
	} else if firstArg == "--server" {
		handleServer()
		return
	} else {
		rtnCode, err := handleClient()
		if err != nil {
			fmt.Printf("[error] %v\n", err)
		}
		os.Exit(rtnCode)
		return
	}

	if len(os.Args) >= 2 {
		cmdId, err := uuid.Parse(os.Args[1])
		if err != nil {
			packet.SendErrorPacket(os.Stdout, fmt.Sprintf("invalid non-cmdid passed to mshell", err))
			return
		}
		doSingle(cmdId.String())
		time.Sleep(100 * time.Millisecond)
		return
	} else {
		doMain()
	}
}
