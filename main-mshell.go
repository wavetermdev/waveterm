// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package main

import (
	"bytes"
	"fmt"
	"os"
	"os/signal"
	"os/user"
	"strings"
	"syscall"
	"time"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/cmdtail"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"golang.org/x/sys/unix"
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

func doSingle(ck base.CommandKey) {
	packetParser := packet.MakePacketParser(os.Stdin)
	sender := packet.MakePacketSender(os.Stdout)
	var runPacket *packet.RunPacketType
	for pk := range packetParser.MainCh {
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
	if runPacket.CK.IsEmpty() {
		runPacket.CK = ck
	}
	if runPacket.CK != ck {
		sender.SendErrorPacket(fmt.Sprintf("run packet cmdid[%s] did not match arg[%s]", runPacket.CK, ck))
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
	err := shexec.ValidateRunPacket(pk)
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("invalid run packet: %v", err)))
		return
	}
	fileNames, err := base.GetCommandFileNames(pk.CK)
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("cannot get command file names: %v", err)))
		return
	}
	cmd, err := shexec.MakeRunnerExec(pk.CK)
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("cannot make mshell command: %v", err)))
		return
	}
	cmdStdin, err := cmd.StdinPipe()
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("cannot pipe stdin to command: %v", err)))
		return
	}
	// touch ptyout file (should exist for tailer to work correctly)
	ptyOutFd, err := os.OpenFile(fileNames.PtyOutFile, os.O_CREATE|os.O_TRUNC|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("cannot open pty out file '%s': %v", fileNames.PtyOutFile, err)))
		return
	}
	ptyOutFd.Close() // just opened to create the file, can close right after
	runnerOutFd, err := os.OpenFile(fileNames.RunnerOutFile, os.O_CREATE|os.O_TRUNC|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("cannot open runner out file '%s': %v", fileNames.RunnerOutFile, err)))
		return
	}
	defer runnerOutFd.Close()
	cmd.Stdout = runnerOutFd
	cmd.Stderr = runnerOutFd
	err = cmd.Start()
	if err != nil {
		sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("error starting command: %v", err)))
		return
	}
	go func() {
		err = packet.SendPacket(cmdStdin, pk)
		if err != nil {
			sender.SendPacket(packet.MakeCKErrorPacket(pk.CK, fmt.Sprintf("error sending forked runner command: %v", err)))
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
	packetParser := packet.MakePacketParser(os.Stdin)
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
	for pk := range packetParser.MainCh {
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

func handleSingle() {
	packetParser := packet.MakePacketParser(os.Stdin)
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
	for pk := range packetParser.MainCh {
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
	if runPacket == nil {
		sender.SendErrorPacket(fmt.Sprintf("no run packet received"))
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
	cmd.RunRemoteIOAndWait(packetParser, sender)
}

func handleServer() {
}

func detectOpenFds() ([]packet.RemoteFd, error) {
	var fds []packet.RemoteFd
	for fdNum := 3; fdNum <= 64; fdNum++ {
		flags, err := unix.FcntlInt(uintptr(fdNum), unix.F_GETFL, 0)
		if err != nil {
			continue
		}
		flags = flags & 3
		rfd := packet.RemoteFd{FdNum: fdNum}
		if flags&2 == 2 {
			return nil, fmt.Errorf("invalid fd=%d, mshell does not support fds open for reading and writing", fdNum)
		}
		if flags&1 == 1 {
			rfd.Write = true
		} else {
			rfd.Read = true
		}
		fds = append(fds, rfd)
	}
	return fds, nil
}

func parseClientOpts() (*shexec.ClientOpts, error) {
	opts := &shexec.ClientOpts{}
	iter := base.MakeOptsIter(os.Args[1:])
	for iter.HasNext() {
		argStr := iter.Next()
		if argStr == "--ssh" {
			if !iter.IsNextPlain() {
				return nil, fmt.Errorf("'--ssh [user@host]' missing host")
			}
			opts.SSHHost = iter.Next()
			continue
		}
		if argStr == "--ssh-opts" {
			if !iter.HasNext() {
				return nil, fmt.Errorf("'--ssh-opts [options]' missing options")
			}
			opts.SSHOptsStr = iter.Next()
			continue
		}
		if argStr == "-i" {
			if !iter.IsNextPlain() {
				return nil, fmt.Errorf("-i [identity-file]' missing file")
			}
			opts.SSHIdentity = iter.Next()
			continue
		}
		if argStr == "-l" {
			if !iter.IsNextPlain() {
				return nil, fmt.Errorf("-l [user]' missing user")
			}
			opts.SSHUser = iter.Next()
			continue
		}
		if argStr == "--cwd" {
			if !iter.IsNextPlain() {
				return nil, fmt.Errorf("'--cwd [dir]' missing directory")
			}
			opts.Cwd = iter.Next()
			continue
		}
		if argStr == "--debug" {
			opts.Debug = true
			continue
		}
		if argStr == "--sudo" {
			opts.Sudo = true
			continue
		}
		if argStr == "--sudo-with-password" {
			if !iter.HasNext() {
				return nil, fmt.Errorf("'--sudo-with-password [pw]', missing password")
			}
			opts.Sudo = true
			opts.SudoWithPass = true
			opts.SudoPw = iter.Next()
			continue
		}
		if argStr == "--sudo-with-passfile" {
			if !iter.IsNextPlain() {
				return nil, fmt.Errorf("'--sudo-with-passfile [file]', missing file")
			}
			opts.Sudo = true
			opts.SudoWithPass = true
			fileName := iter.Next()
			contents, err := os.ReadFile(fileName)
			if err != nil {
				return nil, fmt.Errorf("cannot read --sudo-with-passfile file '%s': %w", fileName, err)
			}
			if newlineIdx := bytes.Index(contents, []byte{'\n'}); newlineIdx != -1 {
				contents = contents[0:newlineIdx]
			}
			opts.SudoPw = string(contents) + "\n"
			continue
		}
		if argStr == "--" {
			if !iter.HasNext() {
				return nil, fmt.Errorf("'--' should be followed by command")
			}
			opts.Command = strings.Join(iter.Rest(), " ")
			break
		}
	}
	return opts, nil
}

func handleClient() (int, error) {
	opts, err := parseClientOpts()
	if err != nil {
		return 1, fmt.Errorf("parsing opts: %w", err)
	}
	if opts.Debug {
		packet.GlobalDebug = true
	}
	if opts.Command == "" {
		return 1, fmt.Errorf("no [command] specified.  [command] follows '--' option (see usage)")
	}
	fds, err := detectOpenFds()
	if err != nil {
		return 1, err
	}
	opts.Fds = fds
	donePacket, err := shexec.RunClientSSHCommandAndWait(opts)
	if err != nil {
		return 1, err
	}
	return donePacket.ExitCode, nil
}

func handleUsage() {
	usage := `
Client Usage: mshell [opts] --ssh user@host -- [command]

mshell multiplexes input and output streams to a remote command over ssh.

Options:
    -i [identity-file] - used to set '-i' option for ssh command
    -l [user]          - used to set '-l' option for ssh command
    --cwd [dir]        - execute remote command in [dir]
    --ssh-opts [opts]  - addition options to pass to ssh command
    [command]          - the remote command to execute

Sudo Options:
    --sudo                      - use only if sudo never requires a password
    --sudo-with-password [pw]   - not recommended, use --sudo-with-passfile if possible
    --sudo-with-passfile [file]

Sudo options allow you to run the given command using "sudo".  The first
option only works when you can sudo without a password.  Your password will be passed
securely through a high numbered fd to "sudo -S".  See full documentation for more details.

Examples:
    # execute a python script remotely, with stdin still hooked up correctly
    mshell --cwd "~/work" -i key.pem --ssh ubuntu@somehost -- "python3 /dev/fd/4" 4< myscript.py

    # capture multiple outputs
    mshell --ssh ubuntu@test -- "cat file1.txt > /dev/fd/3; cat file2.txt > /dev/fd/4" 3> file1.txt 4> file2.txt

    # execute a script, catpure stdout/stderr in fd-3 and fd-4
    # useful if you need to see stdout for interacting with ssh (password or host auth)
    mshell --ssh user@host -- "test.sh > /dev/fd/3 2> /dev/fd/4" 3> test.stdout 4> test.stderr

    # run a script as root (via sudo), capture output
    mshell --sudo-with-passfile pw.txt --ssh ubuntu@somehost -- "python3 /dev/fd/3 > /dev/fd/4" 3< myscript.py 4> script-output.txt < script-input.txt

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
	} else if firstArg == "--single" {
		handleSingle()
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
		ck := base.CommandKey(os.Args[1])
		if err := ck.Validate("mshell arg"); err != nil {
			packet.SendErrorPacket(os.Stdout, err.Error())
			return
		}
		doSingle(ck)
		time.Sleep(100 * time.Millisecond)
		return
	} else {
		doMain()
	}
}
