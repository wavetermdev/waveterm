// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellenv"
	"github.com/wavetermdev/waveterm/waveshell/pkg/statediff"
)

const BaseBashOpts = `set +m; set +H; shopt -s extglob`

const BashShellVersionCmdStr = `echo bash v${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}.${BASH_VERSINFO[2]}`
const RemoteBashPath = "bash"

// TODO fix bash path in these constants
const RunBashSudoCommandFmt = `sudo -n -C %d bash /dev/fd/%d`
const RunBashSudoPasswordCommandFmt = `cat /dev/fd/%d | sudo -k -S -C %d bash -c "echo '[from-mshell]'; exec %d>&-; bash /dev/fd/%d < /dev/fd/%d"`

// do not use these directly, call GetLocalMajorVersion()
var localBashMajorVersionOnce = &sync.Once{}
var localBashMajorVersion = ""

// the "exec 2>" line also adds an extra printf at the *beginning* to strip out spurious rc file output
var GetBashShellStateCmds = []string{
	"exec 2> /dev/null;",
	BashShellVersionCmdStr + ";",
	`pwd;`,
	`declare -p $(compgen -A variable);`,
	`alias -p;`,
	`declare -f;`,
	GetGitBranchCmdStr + ";",
}

type bashShellApi struct{}

func (b bashShellApi) GetShellType() string {
	return packet.ShellType_bash
}

func (b bashShellApi) MakeExitTrap(fdNum int) string {
	return MakeBashExitTrap(fdNum)
}

func (b bashShellApi) GetLocalMajorVersion() string {
	return GetLocalBashMajorVersion()
}

func (b bashShellApi) GetLocalShellPath() string {
	return GetLocalBashPath()
}

func (b bashShellApi) GetRemoteShellPath() string {
	return RemoteBashPath
}

func (b bashShellApi) MakeRunCommand(cmdStr string, opts RunCommandOpts) string {
	if !opts.Sudo {
		return fmt.Sprintf(RunCommandFmt, cmdStr)
	}
	if opts.SudoWithPass {
		return fmt.Sprintf(RunBashSudoPasswordCommandFmt, opts.PwFdNum, opts.MaxFdNum+1, opts.PwFdNum, opts.CommandFdNum, opts.CommandStdinFdNum)
	} else {
		return fmt.Sprintf(RunBashSudoCommandFmt, opts.MaxFdNum+1, opts.CommandFdNum)
	}
}

func (b bashShellApi) MakeShExecCommand(cmdStr string, rcFileName string, usePty bool) *exec.Cmd {
	return MakeBashShExecCommand(cmdStr, rcFileName, usePty)
}

func (b bashShellApi) GetShellState() (*packet.ShellState, error) {
	return GetBashShellState()
}

func (b bashShellApi) GetBaseShellOpts() string {
	return BaseBashOpts
}

func (b bashShellApi) ParseShellStateOutput(output []byte) (*packet.ShellState, error) {
	return parseBashShellStateOutput(output)
}

func (b bashShellApi) MakeRcFileStr(pk *packet.RunPacketType) string {
	var rcBuf bytes.Buffer
	rcBuf.WriteString(b.GetBaseShellOpts() + "\n")
	varDecls := shellenv.VarDeclsFromState(pk.State)
	for _, varDecl := range varDecls {
		if varDecl.IsExport() || varDecl.IsReadOnly() {
			continue
		}
		rcBuf.WriteString(BashDeclareStmt(varDecl))
		rcBuf.WriteString("\n")
	}
	if pk.State != nil && pk.State.Funcs != "" {
		rcBuf.WriteString(pk.State.Funcs)
		rcBuf.WriteString("\n")
	}
	if pk.State != nil && pk.State.Aliases != "" {
		rcBuf.WriteString(pk.State.Aliases)
		rcBuf.WriteString("\n")
	}
	return rcBuf.String()
}

func GetBashShellStateCmd() string {
	return strings.Join(GetBashShellStateCmds, ` printf "\x00\x00";`)
}

func execGetLocalBashShellVersion() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), GetStateTimeout)
	defer cancelFn()
	ecmd := exec.CommandContext(ctx, "bash", "-c", BashShellVersionCmdStr)
	out, err := ecmd.Output()
	if err != nil {
		return ""
	}
	versionStr := strings.TrimSpace(string(out))
	if strings.Index(versionStr, "bash ") == -1 {
		// invalid shell version (only bash is supported)
		return ""
	}
	return versionStr
}

func GetLocalBashMajorVersion() string {
	localBashMajorVersionOnce.Do(func() {
		fullVersion := execGetLocalBashShellVersion()
		localBashMajorVersion = packet.GetMajorVersion(fullVersion)
	})
	return localBashMajorVersion
}

func GetBashShellState() (*packet.ShellState, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), GetStateTimeout)
	defer cancelFn()
	cmdStr := BaseBashOpts + "; " + GetBashShellStateCmd()
	ecmd := exec.CommandContext(ctx, GetLocalBashPath(), "-l", "-i", "-c", cmdStr)
	outputBytes, err := RunSimpleCmdInPty(ecmd)
	if err != nil {
		return nil, err
	}
	return parseBashShellStateOutput(outputBytes)
}

func GetLocalBashPath() string {
	if runtime.GOOS == "darwin" {
		macShell := GetMacUserShell()
		if strings.Index(macShell, "bash") != -1 {
			return shellescape.Quote(macShell)
		}
	}
	return "bash"
}

func GetLocalZshPath() string {
	if runtime.GOOS == "darwin" {
		macShell := GetMacUserShell()
		if strings.Index(macShell, "zsh") != -1 {
			return shellescape.Quote(macShell)
		}
	}
	return "zsh"
}

func GetBashShellStateRedirectCommandStr(outputFdNum int) string {
	return fmt.Sprintf("cat <(%s) > /dev/fd/%d", GetBashShellStateCmd(), outputFdNum)
}

func MakeBashExitTrap(fdNum int) string {
	stateCmd := GetBashShellStateRedirectCommandStr(fdNum)
	fmtStr := `
_waveshell_exittrap () {
    %s
}
trap _waveshell_exittrap EXIT
`
	return fmt.Sprintf(fmtStr, stateCmd)
}

func MakeBashShExecCommand(cmdStr string, rcFileName string, usePty bool) *exec.Cmd {
	if usePty {
		return exec.Command(GetLocalBashPath(), "--rcfile", rcFileName, "-i", "-c", cmdStr)
	} else {
		return exec.Command(GetLocalBashPath(), "--rcfile", rcFileName, "-c", cmdStr)
	}
}

func (bashShellApi) MakeShellStateDiff(oldState *packet.ShellState, oldStateHash string, newState *packet.ShellState) (*packet.ShellStateDiff, error) {
	if oldState == nil {
		return nil, fmt.Errorf("cannot diff, oldState is nil")
	}
	if newState == nil {
		return nil, fmt.Errorf("cannot diff, newState is nil")
	}
	if !packet.StateVersionsCompatible(oldState.Version, newState.Version) {
		return nil, fmt.Errorf("cannot diff, incompatible shell versions: %q %q", oldState.Version, newState.Version)
	}
	rtn := &packet.ShellStateDiff{}
	rtn.BaseHash = oldStateHash
	rtn.Version = newState.Version // always set version in the diff
	if oldState.Cwd != newState.Cwd {
		rtn.Cwd = newState.Cwd
	}
	rtn.Error = newState.Error
	oldVars := shellenv.ShellStateVarsToMap(oldState.ShellVars)
	newVars := shellenv.ShellStateVarsToMap(newState.ShellVars)
	rtn.VarsDiff = statediff.MakeMapDiff(oldVars, newVars)
	rtn.AliasesDiff = statediff.MakeLineDiff(oldState.Aliases, newState.Aliases, oldState.GetLineDiffSplitString())
	rtn.FuncsDiff = statediff.MakeLineDiff(oldState.Funcs, newState.Funcs, oldState.GetLineDiffSplitString())
	return rtn, nil
}

func (bashShellApi) ApplyShellStateDiff(oldState *packet.ShellState, diff *packet.ShellStateDiff) (*packet.ShellState, error) {
	if oldState == nil {
		return nil, fmt.Errorf("cannot apply diff, oldState is nil")
	}
	if diff == nil {
		return oldState, nil
	}
	rtnState := &packet.ShellState{}
	var err error
	rtnState.Version = oldState.Version
	if diff.Version != rtnState.Version {
		rtnState.Version = diff.Version
	}
	rtnState.Cwd = oldState.Cwd
	if diff.Cwd != "" {
		rtnState.Cwd = diff.Cwd
	}
	rtnState.Error = diff.Error
	oldVars := shellenv.ShellStateVarsToMap(oldState.ShellVars)
	newVars, err := statediff.ApplyMapDiff(oldVars, diff.VarsDiff)
	if err != nil {
		return nil, fmt.Errorf("applying mapdiff 'vars': %v", err)
	}
	rtnState.ShellVars = shellenv.StrMapToShellStateVars(newVars)
	rtnState.Aliases, err = statediff.ApplyLineDiff(oldState.Aliases, diff.AliasesDiff)
	if err != nil {
		return nil, fmt.Errorf("applying diff 'aliases': %v", err)
	}
	rtnState.Funcs, err = statediff.ApplyLineDiff(oldState.Funcs, diff.FuncsDiff)
	if err != nil {
		return nil, fmt.Errorf("applying diff 'funcs': %v", err)
	}
	return rtnState, nil
}
