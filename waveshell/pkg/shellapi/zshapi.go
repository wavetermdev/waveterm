// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"os/exec"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
)

var GetZshShellStateCmds = []string{
	`echo zsh v${ZSH_VERSION};`,
	`pwd;`,
	`typeset -p +H -m '*';`,
	GetGitBranchCmdStr + ";",
}

type zshShellApi struct{}

func (z zshShellApi) GetShellType() string {
	return packet.ShellType_zsh
}

func (z zshShellApi) MakeExitTrap(fdNum int) string {
	return ""
}

func (z zshShellApi) GetLocalMajorVersion() string {
	return ""
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
	return exec.Command(GetLocalZshPath(), "-f", "-d", "-c", cmdStr)
}

func (z zshShellApi) GetShellState() (*packet.ShellState, error) {
	return &packet.ShellState{}, nil
}

func (z zshShellApi) GetBaseShellOpts() string {
	return ""
}

func (z zshShellApi) ParseShellStateOutput(output []byte) (*packet.ShellState, error) {
	return &packet.ShellState{}, nil
}

func (z zshShellApi) MakeRcFileStr(pk *packet.RunPacketType) string {
	return ""
}
