// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellenv"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

const BaseZshOpts = ``

const ZshShellVersionCmdStr = `echo zsh v$ZSH_VERSION`

var ZshIgnoreVars = map[string]bool{
	"_":                    true,
	"0":                    true,
	"terminfo":             true,
	"RANDOM":               true,
	"COLUMNS":              true,
	"LINES":                true,
	"argv":                 true,
	"SECONDS":              true,
	"PWD":                  true,
	"HISTCHARS":            true,
	"HISTFILE":             true,
	"HISTSIZE":             true,
	"SAVEHIST":             true,
	"ZSH_EXECUTION_STRING": true,
}

var ZshUnsetVars = []string{
	"HISTFILE",
	"ZSH_EXECUTION_STRING",
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
	return exec.Command(GetLocalZshPath(), "-l", "-i", "-c", cmdStr)
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
	rtn, err := parseZshShellStateOutput(outputBytes)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func (z zshShellApi) GetBaseShellOpts() string {
	return BaseZshOpts
}

func (z zshShellApi) ParseShellStateOutput(output []byte) (*packet.ShellState, error) {
	return parseZshShellStateOutput(output)
}

func makeZshTypesetStmt(varDecl *shellenv.DeclareDeclType) string {
	if !varDecl.IsZshDecl {
		// not sure what to do here?
		return ""
	}
	var argsStr string
	if varDecl.Args == "" {
		argsStr = "--"
	} else {
		argsStr = "-" + varDecl.Args
	}
	if varDecl.IsZshScalarBound() {
		// varDecl.Value contains the extra "separator" field (if present in the original typeset def)
		return fmt.Sprintf("typeset %s %s %s=%s", argsStr, varDecl.ZshBoundScalar, varDecl.Name, varDecl.Value)
	} else {
		return fmt.Sprintf("typeset %s %s=%s", argsStr, varDecl.Name, varDecl.Value)
	}
}

func (z zshShellApi) MakeRcFileStr(pk *packet.RunPacketType) string {
	var rcBuf bytes.Buffer
	rcBuf.WriteString(z.GetBaseShellOpts() + "\n")
	rcBuf.WriteString("unsetopt GLOBAL_RCS\n")
	varDecls := shellenv.VarDeclsFromState(pk.State)
	log.Printf("MakeRCFile: num-decls: %d", len(varDecls))
	for _, varDecl := range varDecls {
		stmt := makeZshTypesetStmt(varDecl)
		if stmt == "" {
			continue
		}
		rcBuf.WriteString(makeZshTypesetStmt(varDecl))
		rcBuf.WriteString("\n")
	}
	if shellenv.FindVarDecl(varDecls, "ZDOTDIR") == nil {
		rcBuf.WriteString("unset ZDOTDIR\n")
		rcBuf.WriteString("\n")
	}
	for _, varName := range ZshUnsetVars {
		rcBuf.WriteString("unset " + shellescape.Quote(varName) + "\n")
	}
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
	// 5 fields: version [0], cwd [1], env [2], vars [3], pvars [4]
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
	pvarMap := parsePVarOutput(fields[4], true)
	utilfn.CombineMaps(zshDecls, pvarMap)
	rtn.ShellVars = shellenv.SerializeDeclMap(zshDecls)
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

// returns (newDeclStr, argsStr, err)
func parseZshDeclArgs(declStr string, isExport bool) (string, string, error) {
	origDeclStr := declStr
	var argsStr string
	if isExport {
		argsStr = "x"
	}
	declStr = strings.TrimLeft(declStr, " ")
	for strings.HasPrefix(declStr, "-") {
		spaceIdx := strings.Index(declStr, " ")
		if spaceIdx == -1 {
			return "", "", fmt.Errorf("invalid zsh export line: %q", origDeclStr)
		}
		newArgsStr := strings.TrimSpace(declStr[1:spaceIdx])
		argsStr = argsStr + newArgsStr
		declStr = declStr[spaceIdx+1:]
		declStr = strings.TrimLeft(declStr, " ")
	}
	return declStr, argsStr, nil
}

func parseZshDeclLine(line string) (*DeclareDeclType, error) {
	if strings.HasSuffix(line, "\r") {
		line = line[0 : len(line)-1]
	}
	if strings.HasPrefix(line, "export ") {
		exportLine := line[7:]
		assignLine, exportArgs, err := parseZshDeclArgs(exportLine, true)
		rtn := &DeclareDeclType{IsZshDecl: true, Args: exportArgs}
		err = parseZshDeclAssignment(assignLine, rtn)
		if err != nil {
			return nil, err
		}
		return rtn, nil
	} else if strings.HasPrefix(line, "typeset ") {
		typesetLine := line[8:]
		assignLine, typesetArgs, err := parseZshDeclArgs(typesetLine, false)
		rtn := &DeclareDeclType{IsZshDecl: true, Args: typesetArgs}
		err = parseZshDeclAssignment(assignLine, rtn)
		if err != nil {
			return nil, err
		}
		return rtn, nil
	} else {
		return nil, fmt.Errorf("invalid zsh decl line: %q", line)
	}
}

// combine decl2 INTO decl1
func combineTiedZshDecls(decl1 *DeclareDeclType, decl2 *DeclareDeclType) {
	if decl2.IsExport() {
		decl1.AddFlag("x")
	}
	if decl2.IsArray() {
		decl1.AddFlag("a")
	}
}

func parseZshDecls(output []byte) (map[string]*DeclareDeclType, error) {
	// NOTES:
	// - we get extra \r characters in the output (trimmed in parseZshDeclLine) (we get \r\n)
	// - tied variables (-T) are printed twice! this is especially confusing for exported vars:
	//       (1) `export -T PATH path=( ... )`
	//       (2) `typeset -aT PATH path=( ... )`
	//    we have to "combine" these two lines into one decl.
	outputStr := string(output)
	lines := strings.Split(outputStr, "\n")
	rtn := make(map[string]*DeclareDeclType)
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
		if ZshIgnoreVars[decl.Name] {
			continue
		}
		if rtn[decl.Name] != nil && decl.IsZshScalarBound() {
			combineTiedZshDecls(rtn[decl.Name], decl)
			continue
		}
		rtn[decl.Name] = decl
	}
	return rtn, nil
}
