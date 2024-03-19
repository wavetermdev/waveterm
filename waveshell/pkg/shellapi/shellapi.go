// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alessio/shellescape"
	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellutil"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

const GetStateTimeout = 15 * time.Second
const GetGitBranchCmdStr = `printf "GITBRANCH %s\x00" "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"`
const GetK8sContextCmdStr = `printf "K8SCONTEXT %s\x00" "$(kubectl config current-context 2>/dev/null)"`
const GetK8sNamespaceCmdStr = `printf "K8SNAMESPACE %s\x00" "$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null)"`
const RunCommandFmt = `%s`
const DebugState = false

var userShellRegexp = regexp.MustCompile(`^UserShell: (.*)$`)

var cachedMacUserShell string
var macUserShellOnce = &sync.Once{}

const DefaultMacOSShell = "/bin/bash"

type RunCommandOpts struct {
	Sudo              bool
	SudoWithPass      bool
	MaxFdNum          int // needed for Sudo
	CommandFdNum      int // needed for Sudo
	PwFdNum           int // needed for SudoWithPass
	CommandStdinFdNum int // needed for SudoWithPass
}

const (
	ShellStateOutputStatus_Done = "done"
)

type ShellStateOutput struct {
	Status     string
	Output     []byte
	ShellState *packet.ShellState
	Stats      *packet.ShellStateStats
	Error      string
}

type ShellApi interface {
	GetShellType() string
	MakeExitTrap(fdNum int) (string, []byte)
	GetLocalMajorVersion() string
	GetLocalShellPath() string
	GetRemoteShellPath() string
	MakeRunCommand(cmdStr string, opts RunCommandOpts) string
	MakeShExecCommand(cmdStr string, rcFileName string, usePty bool) *exec.Cmd
	GetShellState(chan ShellStateOutput)
	GetBaseShellOpts() string
	ParseShellStateOutput(output []byte) (*packet.ShellState, *packet.ShellStateStats, error)
	MakeRcFileStr(pk *packet.RunPacketType) string
	MakeShellStateDiff(oldState *packet.ShellState, oldStateHash string, newState *packet.ShellState) (*packet.ShellStateDiff, error)
	ApplyShellStateDiff(oldState *packet.ShellState, diff *packet.ShellStateDiff) (*packet.ShellState, error)
}

var _ ShellApi = &bashShellApi{}
var _ ShellApi = &zshShellApi{}

func DetectLocalShellType() string {
	shellPath := GetMacUserShell()
	if shellPath == "" {
		shellPath = os.Getenv("SHELL")
	}
	if shellPath == "" {
		return packet.ShellType_bash
	}
	_, file := filepath.Split(shellPath)
	if strings.HasPrefix(file, "zsh") {
		return packet.ShellType_zsh
	}
	return packet.ShellType_bash
}

func HasShell(shellType string) bool {
	if shellType == packet.ShellType_bash {
		_, err := exec.LookPath("bash")
		return err != nil
	}
	if shellType == packet.ShellType_zsh {
		_, err := exec.LookPath("zsh")
		return err != nil
	}
	return false
}

func MakeShellApi(shellType string) (ShellApi, error) {
	if shellType == "" || shellType == packet.ShellType_bash {
		return &bashShellApi{}, nil
	}
	if shellType == packet.ShellType_zsh {
		return &zshShellApi{}, nil
	}
	return nil, fmt.Errorf("shell type not supported: %s", shellType)
}

func GetMacUserShell() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	macUserShellOnce.Do(func() {
		cachedMacUserShell = internalMacUserShell()
	})
	return cachedMacUserShell
}

// dscl . -read /User/[username] UserShell
// defaults to /bin/bash
func internalMacUserShell() string {
	osUser, err := user.Current()
	if err != nil {
		return DefaultMacOSShell
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	userStr := "/Users/" + osUser.Username
	out, err := exec.CommandContext(ctx, "dscl", ".", "-read", userStr, "UserShell").CombinedOutput()
	if err != nil {
		return DefaultMacOSShell
	}
	outStr := strings.TrimSpace(string(out))
	m := userShellRegexp.FindStringSubmatch(outStr)
	if m == nil {
		return DefaultMacOSShell
	}
	return m[1]
}

const FirstExtraFilesFdNum = 3

// returns output(stdout+stderr), extraFdOutput, error
func StreamCommandWithExtraFd(ecmd *exec.Cmd, outputCh chan []byte, extraFdNum int, endBytes []byte) ([]byte, error) {
	defer close(outputCh)
	ecmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(ecmd, shellutil.MShellEnvVars(shellutil.DefaultTermType))
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	defer cmdTty.Close()
	defer cmdPty.Close()
	pty.Setsize(cmdPty, &pty.Winsize{Rows: shellutil.DefaultTermRows, Cols: shellutil.DefaultTermCols})
	ecmd.Stdin = cmdTty
	ecmd.Stdout = cmdTty
	ecmd.Stderr = cmdTty
	ecmd.SysProcAttr = &syscall.SysProcAttr{}
	ecmd.SysProcAttr.Setsid = true
	ecmd.SysProcAttr.Setctty = true
	pipeReader, pipeWriter, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("could not create pipe: %w", err)
	}
	defer pipeWriter.Close()
	defer pipeReader.Close()
	extraFiles := make([]*os.File, extraFdNum+1)
	extraFiles[extraFdNum] = pipeWriter
	ecmd.ExtraFiles = extraFiles[FirstExtraFilesFdNum:]
	err = ecmd.Start()
	cmdTty.Close()
	pipeWriter.Close()
	if err != nil {
		return nil, err
	}
	var outputWg sync.WaitGroup
	var extraFdOutputBuf bytes.Buffer
	outputWg.Add(2)
	go func() {
		// ignore error (/dev/ptmx has read error when process is done)
		defer outputWg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := cmdPty.Read(buf)
			if n > 0 {
				chBuf := make([]byte, n)
				copy(chBuf, buf[:n])
				outputCh <- chBuf
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				errStr := fmt.Sprintf("\r\nerror reading from pty: %v\r\n", err)
				outputCh <- []byte(errStr)
				break
			}
		}
	}()
	go func() {
		defer outputWg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := pipeReader.Read(buf)
			if n > 0 {
				extraFdOutputBuf.Write(buf[:n])
				obytes := extraFdOutputBuf.Bytes()
				if bytes.HasSuffix(obytes, endBytes) {
					extraFdOutputBuf.Truncate(len(obytes) - len(endBytes))
					break
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
		}
	}()
	exitErr := ecmd.Wait()
	if exitErr != nil {
		return nil, exitErr
	}
	outputWg.Wait()
	return extraFdOutputBuf.Bytes(), nil
}

func RunSimpleCmdInPty(ecmd *exec.Cmd, endBytes []byte) ([]byte, error) {
	ecmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(ecmd, shellutil.MShellEnvVars(shellutil.DefaultTermType))
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: shellutil.DefaultTermRows, Cols: shellutil.DefaultTermCols})
	ecmd.Stdin = cmdTty
	ecmd.Stdout = cmdTty
	ecmd.Stderr = cmdTty
	ecmd.SysProcAttr = &syscall.SysProcAttr{}
	ecmd.SysProcAttr.Setsid = true
	ecmd.SysProcAttr.Setctty = true
	err = ecmd.Start()
	cmdTty.Close()
	if err != nil {
		cmdPty.Close()
		return nil, err
	}
	defer cmdPty.Close()
	ioDone := make(chan bool)
	var outputBuf bytes.Buffer
	go func() {
		// ignore error (/dev/ptmx has read error when process is done)
		defer close(ioDone)
		buf := make([]byte, 4096)
		for {
			n, err := cmdPty.Read(buf)
			if n > 0 {
				outputBuf.Write(buf[:n])
				obytes := outputBuf.Bytes()
				if bytes.HasSuffix(obytes, endBytes) {
					outputBuf.Truncate(len(obytes) - len(endBytes))
					break
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
		}
	}()
	exitErr := ecmd.Wait()
	if exitErr != nil {
		return nil, exitErr
	}
	<-ioDone
	return outputBuf.Bytes(), nil
}

func parseExtVarOutput(pvarBytes []byte, promptOutput string, zmodsOutput string) map[string]*DeclareDeclType {
	declMap := make(map[string]*DeclareDeclType)
	pvars := bytes.Split(pvarBytes, []byte{0})
	for _, pvarBA := range pvars {
		pvarStr := string(pvarBA)
		pvarFields := strings.SplitN(pvarStr, " ", 2)
		if len(pvarFields) != 2 {
			continue
		}
		if pvarFields[0] == "" {
			continue
		}
		if pvarFields[1] == "" {
			continue
		}
		decl := &DeclareDeclType{IsExtVar: true}
		decl.Name = "PROMPTVAR_" + pvarFields[0]
		decl.Value = shellescape.Quote(pvarFields[1])
		declMap[decl.Name] = decl
	}
	if promptOutput != "" {
		decl := &DeclareDeclType{IsExtVar: true}
		decl.Name = "PROMPTVAR_PS1"
		decl.Value = promptOutput
		declMap[decl.Name] = decl
	}
	if zmodsOutput != "" {
		var zmods []string
		lines := strings.Split(zmodsOutput, "\n")
		for _, line := range lines {
			fields := strings.Fields(line)
			if len(fields) != 2 || fields[0] != "zmodload" {
				continue
			}
			zmods = append(zmods, fields[1])
		}
		decl := &DeclareDeclType{IsExtVar: true}
		decl.Name = ZModsVarName
		decl.Value = utilfn.QuickJson(zmods)
		declMap[decl.Name] = decl
	}
	return declMap
}

// for debugging (not for production use)
func writeStateToFile(shellType string, outputBytes []byte) error {
	msHome := base.GetMShellHomeDir()
	stateFileName := path.Join(msHome, shellType+"-state.txt")
	os.WriteFile(stateFileName, outputBytes, 0644)
	return nil
}
