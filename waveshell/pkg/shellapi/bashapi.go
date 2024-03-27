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
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
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

func (b bashShellApi) MakeExitTrap(fdNum int) (string, []byte) {
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

func (b bashShellApi) GetShellState(ctx context.Context, outCh chan ShellStateOutput, stdinDataCh chan []byte) {
	GetBashShellState(ctx, outCh, stdinDataCh)
}

func (b bashShellApi) GetBaseShellOpts() string {
	return BaseBashOpts
}

func (b bashShellApi) ParseShellStateOutput(output []byte) (*packet.ShellState, *packet.ShellStateStats, error) {
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
		if varDecl.IsExtVar {
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

func GetBashShellStateCmd(fdNum int) (string, []byte) {
	endBytes := utilfn.AppendNonZeroRandomBytes(nil, NumRandomEndBytes)
	endBytes = append(endBytes, '\n')
	cmdStr := strings.TrimSpace(`
exec 2> /dev/null;
exec > [%OUTPUTFD%];
printf "\x00\x00";
[%BASHVERSIONCMD%];
printf "\x00\x00";
pwd;
printf "\x00\x00";
declare -p $(compgen -A variable);
printf "\x00\x00";
alias -p;
printf "\x00\x00";
declare -f;
printf "\x00\x00";
[%GITBRANCHCMD%];
printf "\x00\x00";
printf "[%ENDBYTES%]";
`)
	cmdStr = strings.ReplaceAll(cmdStr, "[%OUTPUTFD%]", fmt.Sprintf("/dev/fd/%d", fdNum))
	cmdStr = strings.ReplaceAll(cmdStr, "[%BASHVERSIONCMD%]", BashShellVersionCmdStr)
	cmdStr = strings.ReplaceAll(cmdStr, "[%GITBRANCHCMD%]", GetGitBranchCmdStr)
	cmdStr = strings.ReplaceAll(cmdStr, "[%ENDBYTES%]", utilfn.ShellHexEscape(string(endBytes)))
	return cmdStr, endBytes
}

func execGetLocalBashShellVersion() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), GetVersionTimeout)
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

func GetBashShellState(ctx context.Context, outCh chan ShellStateOutput, stdinDataCh chan []byte) {
	defer close(outCh)
	stateCmd, endBytes := GetBashShellStateCmd(StateOutputFdNum)
	cmdStr := BaseBashOpts + "; " + stateCmd
	ecmd := exec.CommandContext(ctx, GetLocalBashPath(), "-l", "-i", "-c", cmdStr)
	outputCh := make(chan []byte, 10)
	var outputWg sync.WaitGroup
	outputWg.Add(1)
	go func() {
		defer outputWg.Done()
		for outputBytes := range outputCh {
			outCh <- ShellStateOutput{Output: outputBytes}
		}
	}()
	outputBytes, err := StreamCommandWithExtraFd(ctx, ecmd, outputCh, StateOutputFdNum, endBytes, stdinDataCh)
	outputWg.Wait()
	if err != nil {
		outCh <- ShellStateOutput{Error: err.Error()}
		return
	}
	rtn, stats, err := parseBashShellStateOutput(outputBytes)
	if err != nil {
		outCh <- ShellStateOutput{Error: err.Error()}
		return
	}
	outCh <- ShellStateOutput{ShellState: rtn, Stats: stats}
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

func GetBashShellStateRedirectCommandStr(outputFdNum int) (string, []byte) {
	cmdStr, endBytes := GetBashShellStateCmd(outputFdNum)
	return cmdStr, endBytes
}

func MakeBashExitTrap(fdNum int) (string, []byte) {
	stateCmd, endBytes := GetBashShellStateRedirectCommandStr(fdNum)
	fmtStr := `
_waveshell_exittrap () {
    %s
}
trap _waveshell_exittrap EXIT
`
	return fmt.Sprintf(fmtStr, stateCmd), endBytes
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
	// work around a bug (before v0.6.0) where version could be invalid.
	// so only overwrite the oldversion if diff version is valid
	_, _, diffVersionErr := packet.ParseShellStateVersion(diff.Version)
	if diffVersionErr == nil {
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
