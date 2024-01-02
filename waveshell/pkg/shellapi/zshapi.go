// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
)

const BaseZshOpts = ``

var GetZshShellStateCmds = []string{
	`echo zsh v${ZSH_VERSION};`,
	`pwd;`,
	`typeset -p +H -m '*';`,
	GetGitBranchCmdStr + ";",
}

const ZshShellVersionCmdStr = `echo zsh v$ZSH_VERSION`

// do not use these directly, call GetLocalMajorVersion()
var localZshMajorVersionOnce = &sync.Once{}
var localZshMajorVersion = ""

type zshShellApi struct{}

func (z zshShellApi) GetShellType() string {
	return packet.ShellType_zsh
}

func (z zshShellApi) MakeExitTrap(fdNum int) string {
	return MakeZshExitTrap(fdNum)
}

func (z zshShellApi) GetLocalMajorVersion() string {
	return GetLocalZshMajorVersion()
}

func (z zshShellApi) GetLocalShellPath() string {
	return "/bin/zsh"
}

func (z zshShellApi) GetRemoteShellPath() string {
	return "zsh"
}

func (z zshShellApi) MakeRunCommand(cmdStr string, opts RunCommandOpts) string {
	return cmdStr
}

func (z zshShellApi) MakeShExecCommand(cmdStr string, rcFileName string, usePty bool) *exec.Cmd {
	return exec.Command(GetLocalZshPath(), "-d", "-c", cmdStr)
}

func (z zshShellApi) GetShellState() (*packet.ShellState, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), GetStateTimeout)
	defer cancelFn()
	cmdStr := BaseZshOpts + "; " + GetZshShellStateCmd()
	ecmd := exec.CommandContext(ctx, GetLocalZshPath(), "-l", "-i", "-c", cmdStr)
	outputBytes, err := RunSimpleCmdInPty(ecmd)
	if err != nil {
		return nil, err
	}
	return parseZshShellStateOutput(outputBytes)
}

func (z zshShellApi) GetBaseShellOpts() string {
	return BaseZshOpts
}

func (z zshShellApi) ParseShellStateOutput(output []byte) (*packet.ShellState, error) {
	return parseZshShellStateOutput(output)
}

func (z zshShellApi) MakeRcFileStr(pk *packet.RunPacketType) string {
	var rcBuf bytes.Buffer
	rcBuf.WriteString(z.GetBaseShellOpts() + "\n")
	rcBuf.WriteString("unsetopt GLOBAL_RCS\n")
	return rcBuf.String()
}

func GetZshShellStateCmd() string {
	return strings.Join(GetZshShellStateCmds, ` printf "\x00\x00";`)
}

func GetZshShellStateRedirectCommandStr(outputFdNum int) string {
	return fmt.Sprintf("cat <(%s) > /dev/fd/%d", GetZshShellStateCmd(), outputFdNum)
}

func MakeZshExitTrap(fdNum int) string {
	stateCmd := GetZshShellStateRedirectCommandStr(fdNum)
	fmtStr := `
TRAPEXIT () {
    %s
}
`
	return fmt.Sprintf(fmtStr, stateCmd)
}

func execGetLocalZshShellVersion() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), GetStateTimeout)
	defer cancelFn()
	ecmd := exec.CommandContext(ctx, "zsh", "-c", ZshShellVersionCmdStr)
	out, err := ecmd.Output()
	if err != nil {
		return ""
	}
	versionStr := strings.TrimSpace(string(out))
	if strings.Index(versionStr, "zsh ") == -1 {
		return ""
	}
	return versionStr
}

func GetLocalZshMajorVersion() string {
	localZshMajorVersionOnce.Do(func() {
		fullVersion := execGetLocalZshShellVersion()
		localZshMajorVersion = packet.GetMajorVersion(fullVersion)
	})
	return localZshMajorVersion
}

func parseZshShellStateOutput(outputBytes []byte) (*packet.ShellState, error) {
	// 4 fields: version, cwd, env/vars, gitbrach
	fields := bytes.Split(outputBytes, []byte{0, 0})
	if len(fields) != 4 {
		return nil, fmt.Errorf("invalid zsh shell state output, wrong number of fields, fields=%d", len(fields))
	}
	rtn := &packet.ShellState{}
	rtn.Version = strings.TrimSpace(string(fields[0]))
	if strings.Index(rtn.Version, "zsh") == -1 {
		return nil, fmt.Errorf("invalid zsh shell state output, only zsh is supported")
	}
	cwdStr := string(fields[1])
	if strings.HasSuffix(cwdStr, "\r\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-2]
	} else if strings.HasSuffix(cwdStr, "\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-1]
	}
	rtn.Cwd = string(cwdStr)
	return rtn, nil
}
