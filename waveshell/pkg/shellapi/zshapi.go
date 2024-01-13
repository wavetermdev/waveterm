// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"bytes"
	"context"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path"
	"strings"
	"sync"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/binpack"
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
	"EPOCHSECONDS":         true,
	"EPOCHREALTIME":        true,
	"TTY":                  true,
	"epochtime":            true,
	"langinfo":             true,

	"aliases":              true,
	"dis_aliases":          true,
	"saliases":             true,
	"dis_saliases":         true,
	"galiases":             true,
	"dis_galiases":         true,
	"builtins":             true,
	"dis_builtins":         true,
	"modules":              true,
	"history":              true,
	"historywords":         true,
	"jobdirs":              true,
	"jobstates":            true,
	"jobtexts":             true,
	"funcfiletrace":        true,
	"funcsourcetrace":      true,
	"funcstack":            true,
	"functrace":            true,
	"parameters":           true,
	"commands":             true,
	"functions":            true,
	"dis_functions":        true,
	"functions_source":     true,
	"dis_functions_source": true,
	"_comps":               true,
	"_patcomps":            true,
	"_postpatcomps":        true,
}

var ZshUniqueArrayVars = map[string]bool{
	"path":  true,
	"fpath": true,
}

var ZshUnsetVars = []string{
	"HISTFILE",
	"ZSH_EXECUTION_STRING",
}

// do not use these directly, call GetLocalMajorVersion()
var localZshMajorVersionOnce = &sync.Once{}
var localZshMajorVersion = ""

// sentinel value for functions that should be autoloaded
const ZshFnAutoLoad = "autoload"

type ZshParamKey struct {
	// paramtype cannot contain spaces
	// "aliases", "dis_aliases", "saliases", "dis_saliases", "galiases", "dis_galiases"
	// "functions", "dis_functions", "functions_source", "dis_functions_source"
	ParamType string
	ParamName string
}

func (k ZshParamKey) String() string {
	return k.ParamType + " " + k.ParamName
}

func ZshParamKeyFromString(s string) (ZshParamKey, error) {
	parts := strings.SplitN(s, " ", 2)
	if len(parts) != 2 {
		return ZshParamKey{}, fmt.Errorf("invalid zsh param key")
	}
	return ZshParamKey{ParamType: parts[0], ParamName: parts[1]}, nil
}

type ZshMap = map[ZshParamKey]string

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
	rtn, err := z.ParseShellStateOutput(outputBytes)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func (z zshShellApi) GetBaseShellOpts() string {
	return BaseZshOpts
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
	rcBuf.WriteString("unset KSH_ARRAYS\n")
	rcBuf.WriteString("zmodload zsh/parameter\n")
	varDecls := shellenv.VarDeclsFromState(pk.State)
	for _, varDecl := range varDecls {
		if ZshIgnoreVars[varDecl.Name] {
			continue
		}
		if ZshUniqueArrayVars[varDecl.Name] && !varDecl.IsUniqueArray() {
			varDecl.AddFlag("U")
		}
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

	// aliases
	aliasMap, err := DecodeZshMap([]byte(pk.State.Aliases))
	if err != nil {
		base.Logf("error decoding zsh aliases: %v\n", err)
		rcBuf.WriteString("# error decoding zsh aliases\n")
	} else {
		for aliasKey, aliasValue := range aliasMap {
			// tricky here, don't quote AliasName (it gets implicit quotes, and quoting doesn't work as expected)
			aliasStr := fmt.Sprintf("%s[%s]=%s\n", aliasKey.ParamType, aliasKey.ParamName, shellescape.Quote(aliasValue))
			rcBuf.WriteString(aliasStr)
		}
	}
	return rcBuf.String()
}

const numRandomBytes = 4

// returns (binary-separator, cmd string)
func GetZshShellStateCmd() string {
	var sectionSeparator []byte
	for len(sectionSeparator) < numRandomBytes {
		// any character *except* null (0)
		rn := rand.Intn(256)
		if rn > 0 && rn < 256 { // exclude 0, also helps to suppress security warning to have a guard here
			sectionSeparator = append(sectionSeparator, byte(rn))
		}
	}
	sectionSeparator = append(sectionSeparator, 0, 0)
	// we have to use these crazy separators because zsh allows basically anything in
	// variable names and values (including nulls).
	// note that we don't need crazy separators for "env" or "typeset".
	// environment variables *cannot* contain nulls by definition, and "typeset" already escapes nulls.
	// the raw aliases and functions though need to be handled more carefully
	cmd := `
unsetopt SH_WORD_SPLIT;
zmodload zsh/parameter;
[%ZSHVERSION%];
printf "\x00[%SECTIONSEP%]";
pwd;
printf "[%SECTIONSEP%]";
env -0;
printf "[%SECTIONSEP%]";
typeset -p +H -m '*';
printf "[%SECTIONSEP%]";
for var in "${(@k)aliases}"; do
	printf "aliases %s[%PARTSEP%]%s[%PARTSEP%]" $var ${aliases[$var]}
done
for var in "${(@k)dis_aliases}"; do
	printf "dis_aliases %s[%PARTSEP%]%s[%PARTSEP%]" $var ${dis_aliases[$var]}
done
for var in "${(@k)saliases}"; do
	printf "saliases %s[%PARTSEP%]%s[%PARTSEP%]" $var ${saliases[$var]}
done
for var in "${(@k)dis_saliases}"; do
	printf "dis_saliases %s[%PARTSEP%]%s[%PARTSEP%]" $var ${dis_saliases[$var]}
done
for var in "${(@k)galiases}"; do
	printf "galiases %s[%PARTSEP%]%s[%PARTSEP%]" $var ${galiases[$var]}
done
for var in "${(@k)dis_galiases}"; do
	printf "dis_galiases %s[%PARTSEP%]%s[%PARTSEP%]" $var ${dis_galiases[$var]}
done
printf "[%SECTIONSEP%]";
for var in "${(@k)functions}"; do
    printf "functions %s[%PARTSEP%]%s[%PARTSEP%]" $var ${functions[$var]}
done
for var in "${(@k)dis_functions}"; do
	printf "dis_functions %s[%PARTSEP%]%s[%PARTSEP%]" $var ${dis_functions[$var]}
done
for var in "${(@k)functions_source}"; do
	printf "functions_source %s[%PARTSEP%]%s[%PARTSEP%]" $var ${functions_source[$var]}
done
for var in "${(@k)dis_functions_source}"; do
    printf "dis_functions_source %s[%PARTSEP%]%s[%PARTSEP%]" $var ${dis_functions_source[$var]}
done
printf "[%SECTIONSEP%]";
[%GITBRANCH%]
`
	cmd = strings.TrimSpace(cmd)
	cmd = strings.ReplaceAll(cmd, "[%ZSHVERSION%]", ZshShellVersionCmdStr)
	cmd = strings.ReplaceAll(cmd, "[%GITBRANCH%]", GetGitBranchCmdStr)
	cmd = strings.ReplaceAll(cmd, "[%PARTSEP%]", utilfn.ShellHexEscape(string(sectionSeparator[0:len(sectionSeparator)-1])))
	cmd = strings.ReplaceAll(cmd, "[%SECTIONSEP%]", utilfn.ShellHexEscape(string(sectionSeparator)))
	return cmd
}

func GetZshShellStateRedirectCommandStr(outputFdNum int) string {
	return fmt.Sprintf("cat <(%s) > /dev/fd/%d", GetZshShellStateCmd(), outputFdNum)
}

func MakeZshExitTrap(fdNum int) string {
	stateCmd := GetZshShellStateRedirectCommandStr(fdNum)
	fmtStr := `
zshexit () {
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

// for debugging (not for production use)
func writeZshStateToFile(outputBytes []byte) error {
	msHome := base.GetMShellHomeDir()
	stateFileName := path.Join(msHome, "state.txt")
	os.WriteFile(stateFileName, outputBytes, 0644)
	return nil
}

func EncodeZshMap(m ZshMap) []byte {
	var buf bytes.Buffer
	binpack.PackUInt(&buf, uint64(len(m)))
	for key, value := range m {
		binpack.PackValue(&buf, []byte(key.String()))
		binpack.PackValue(&buf, []byte(value))
	}
	return buf.Bytes()
}

func DecodeZshMap(barr []byte) (ZshMap, error) {
	rtn := make(ZshMap)
	buf := bytes.NewBuffer(barr)
	u := binpack.MakeUnpacker(buf)
	numEntries := u.UnpackUInt("numEntries")
	for idx := 0; idx < numEntries; idx++ {
		key := string(u.UnpackValue("key"))
		value := string(u.UnpackValue("value"))
		zshKey, err := ZshParamKeyFromString(key)
		if err != nil {
			return nil, err
		}
		rtn[zshKey] = value
	}
	if u.Error() != nil {
		return nil, u.Error()
	}
	return rtn, nil
}

func parseZshAliasStateOutput(aliasBytes []byte, partSeparator []byte) map[ZshParamKey]string {
	aliasParts := bytes.Split(aliasBytes, partSeparator)
	rtn := make(map[ZshParamKey]string)
	for aliasPartIdx := 0; aliasPartIdx < len(aliasParts)-1; aliasPartIdx += 2 {
		aliasNameAndType := string(aliasParts[aliasPartIdx])
		aliasNameAndTypeParts := strings.SplitN(aliasNameAndType, " ", 2)
		if len(aliasNameAndTypeParts) != 2 {
			continue
		}
		aliasKey := ZshParamKey{ParamType: aliasNameAndTypeParts[0], ParamName: aliasNameAndTypeParts[1]}
		aliasValue := string(aliasParts[aliasPartIdx+1])
		rtn[aliasKey] = aliasValue
	}
	return rtn
}

func isSourceFileInFpath(fpathArr []string, sourceFile string) bool {
	for _, fpath := range fpathArr {
		if strings.HasPrefix(sourceFile, fpath) {
			return true
		}
	}
	return false
}

func ParseZshFunctions(fpathArr []string, fnBytes []byte, partSeparator []byte) map[ZshParamKey]string {
	fnBody := make(map[ZshParamKey]string)
	fnSource := make(map[string]string)
	fnParts := bytes.Split(fnBytes, partSeparator)
	for fnPartIdx := 0; fnPartIdx < len(fnParts)-1; fnPartIdx += 2 {
		fnTypeAndName := string(fnParts[fnPartIdx])
		fnValue := string(fnParts[fnPartIdx+1])
		fnTypeAndNameParts := strings.SplitN(fnTypeAndName, " ", 2)
		if len(fnTypeAndNameParts) != 2 {
			continue
		}
		fnType := fnTypeAndNameParts[0]
		fnName := fnTypeAndNameParts[1]
		if fnType == "functions" || fnType == "dis_functions" {
			fnBody[ZshParamKey{ParamType: fnType, ParamName: fnName}] = fnValue
		}
		if fnType == "functions_source" || fnType == "dis_functions_source" {
			fnSource[fnName] = fnValue
		}
	}
	// ok, so the trick here is that we want to only include functions that are *not* autoloaded
	// the ones that are pending autoloading or come from a source file in fpath, can just be set to autoload
	for fnKey := range fnBody {
		source := fnSource[fnKey.ParamName]
		if isSourceFileInFpath(fpathArr, source) {
			fnBody[fnKey] = ZshFnAutoLoad
		}
	}
	return fnBody
}

func makeZshFuncsStrForShellState(fnMap map[ZshParamKey]string) string {
	var buf bytes.Buffer
	for fnKey, fnValue := range fnMap {
		buf.WriteString(fmt.Sprintf("%s %s %s\x00", fnKey.ParamType, fnKey.ParamName, fnValue))
	}
	return buf.String()
}

func (z zshShellApi) ParseShellStateOutput(outputBytes []byte) (*packet.ShellState, error) {
	// if scbase.IsDevMode() {
	// 	writeZshStateToFile(outputBytes)
	// }
	firstZeroIdx := bytes.Index(outputBytes, []byte{0})
	firstDZeroIdx := bytes.Index(outputBytes, []byte{0, 0})
	if firstZeroIdx == -1 || firstDZeroIdx == -1 {
		return nil, fmt.Errorf("invalid zsh shell state output, could not parse separator bytes")
	}
	versionStr := string(outputBytes[0:firstZeroIdx])
	sectionSeparator := outputBytes[firstZeroIdx+1 : firstDZeroIdx+2]
	// partSeparator := sectionSeparator[0 : len(sectionSeparator)-1]
	// 7 fields: version [0], cwd [1], env [2], vars [3], aliases [4], functions [5], pvars [6]
	fields := bytes.Split(outputBytes, sectionSeparator)
	if len(fields) != 7 {
		base.Logf("invalid -- numfields\n")
		return nil, fmt.Errorf("invalid zsh shell state output, wrong number of fields, fields=%d", len(fields))
	}
	rtn := &packet.ShellState{}
	rtn.Version = strings.TrimSpace(versionStr)
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
		base.Logf("invalid - parsedecls %v\n", err)
		return nil, err
	}
	for _, decl := range zshDecls {
		if decl.IsZshScalarBound() {
			decl.ZshEnvValue = zshEnv[decl.ZshBoundScalar]
		}
	}
	rtn.Aliases = string(fields[4])
	// zshFuncs := ParseZshFunctions(strings.Split(zshEnv["FPATH"], ":"), fields[5], partSeparator)
	pvarMap := parsePVarOutput(fields[6], true)
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
