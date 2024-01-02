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

	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
)

const BaseZshOpts = ``

const ZshShellVersionCmdStr = `echo zsh v$ZSH_VERSION`

var ZshIgnoreVars = map[string]bool{
	"_": true,
}

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
	cmd := `
[%ZSHVERSION%];
printf "\x00\x00";
pwd;
printf "\x00\x00";
env -0;
printf "\x00";
typeset -p +H -m '*';
printf "\x00\x00";
[%GITBRANCH%]
`
	cmd = strings.TrimSpace(cmd)
	cmd = strings.ReplaceAll(cmd, "[%ZSHVERSION%]", ZshShellVersionCmdStr)
	cmd = strings.ReplaceAll(cmd, "[%GITBRANCH%]", GetGitBranchCmdStr)
	return cmd
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
	// 5 fields: version, cwd, env, vars, gitbrach
	fields := bytes.Split(outputBytes, []byte{0, 0})
	if len(fields) != 5 {
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
	zshEnv := parseZshEnv(fields[2])
	zshDecls, err := parseZshDecls(fields[3])
	if err != nil {
		return nil, err
	}
	for _, decl := range zshDecls {
		if decl.IsZshScalarBound() {
			decl.ZshEnvValue = zshEnv[decl.ZshBoundScalar]
		}
	}
	return rtn, nil
}

func parseZshEnv(output []byte) map[string]string {
	outputStr := string(output)
	lines := strings.Split(outputStr, "\x00")
	rtn := make(map[string]string)
	for _, line := range lines {
		if line == "" {
			continue
		}
		eqIdx := strings.Index(line, "=")
		if eqIdx == -1 {
			continue
		}
		name := line[0:eqIdx]
		if ZshIgnoreVars[name] {
			continue
		}
		val := line[eqIdx+1:]
		rtn[name] = val
	}
	return rtn
}

func parseZshScalarBoundAssignment(declStr string, decl *DeclareDeclType) error {
	declStr = strings.TrimLeft(declStr, " ")
	spaceIdx := strings.Index(declStr, " ")
	if spaceIdx == -1 {
		return fmt.Errorf("invalid zsh decl (scalar bound): %q", declStr)
	}
	decl.ZshBoundScalar = declStr[0:spaceIdx]
	standardDecl := declStr[spaceIdx+1:]
	return parseStandardZshAssignment(standardDecl, decl)
}

func parseStandardZshAssignment(declStr string, decl *DeclareDeclType) error {
	declStr = strings.TrimLeft(declStr, " ")
	eqIdx := strings.Index(declStr, "=")
	if eqIdx == -1 {
		return fmt.Errorf("invalid zsh decl: %q", declStr)
	}
	decl.Name = declStr[0:eqIdx]
	decl.Value = declStr[eqIdx+1:]
	return nil
}

func parseZshDeclAssignment(declStr string, decl *DeclareDeclType) error {
	if decl.IsZshScalarBound() {
		return parseZshScalarBoundAssignment(declStr, decl)
	}
	return parseStandardZshAssignment(declStr, decl)
}

func parseZshDeclLine(line string) (*DeclareDeclType, error) {
	if strings.HasPrefix(line, "export ") {
		exportLine := line[7:]
		var exportArgs string
		if strings.HasPrefix(exportLine, "-") {
			spaceIdx := strings.Index(exportLine, " ")
			if spaceIdx == -1 {
				return nil, fmt.Errorf("invalid zsh export line: %q", line)
			}
			exportArgs = strings.TrimSpace(exportLine[1:spaceIdx])
			exportLine = exportLine[spaceIdx+1:]
			if strings.Index(exportArgs, "x") == -1 {
				exportArgs = "x" + exportArgs
			}
		}
		rtn := &DeclareDeclType{IsZshDecl: true, Args: exportArgs}
		err := parseZshDeclAssignment(exportLine, rtn)
		if err != nil {
			return nil, err
		}
		return rtn, nil
	} else if strings.HasPrefix(line, "typeset ") {
		typesetLine := line[8:]
		var typesetArgs string
		if strings.HasPrefix(typesetLine, "-") {
			spaceIdx := strings.Index(typesetLine, " ")
			if spaceIdx == -1 {
				return nil, fmt.Errorf("invalid zsh typeset line: %q", line)
			}
			typesetArgs = strings.TrimSpace(typesetLine[1:spaceIdx])
			typesetLine = typesetLine[spaceIdx+1:]
		}
		rtn := &DeclareDeclType{IsZshDecl: true, Args: typesetArgs}
		err := parseZshDeclAssignment(typesetLine, rtn)
		if err != nil {
			return nil, err
		}
		return rtn, nil
	} else {
		return nil, fmt.Errorf("invalid zsh decl line: %q", line)
	}
}

func parseZshDecls(output []byte) ([]*DeclareDeclType, error) {
	outputStr := string(output)
	lines := strings.Split(outputStr, "\n")
	var rtn []*DeclareDeclType
	for _, line := range lines {
		if line == "" {
			continue
		}
		decl, err := parseZshDeclLine(line)
		if err != nil {
			base.Logf("error parsing zsh decl line: %v", err)
			continue
		}
		if decl == nil {
			continue
		}
		rtn = append(rtn, decl)
	}
	return rtn, nil
}
