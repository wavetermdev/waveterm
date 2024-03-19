// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellenv"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

type DeclareDeclType = shellenv.DeclareDeclType

func doCmdSubst(commandStr string, w io.Writer, word *syntax.CmdSubst) error {
	return nil
}

func doProcSubst(w *syntax.ProcSubst) (string, error) {
	return "", nil
}

type bashParseEnviron struct {
	Env map[string]string
}

func (e *bashParseEnviron) Get(name string) expand.Variable {
	val, ok := e.Env[name]
	if !ok {
		return expand.Variable{}
	}
	return expand.Variable{
		Exported: true,
		Kind:     expand.String,
		Str:      val,
	}
}

func (e *bashParseEnviron) Each(fn func(name string, vr expand.Variable) bool) {
	for key := range e.Env {
		rtn := fn(key, e.Get(key))
		if !rtn {
			break
		}
	}
}

func GetParserConfig(envMap map[string]string) *expand.Config {
	cfg := &expand.Config{
		Env:       &bashParseEnviron{Env: envMap},
		GlobStar:  false,
		NullGlob:  false,
		NoUnset:   false,
		CmdSubst:  func(w io.Writer, word *syntax.CmdSubst) error { return doCmdSubst("", w, word) },
		ProcSubst: doProcSubst,
		ReadDir:   nil,
	}
	return cfg
}

// https://wiki.bash-hackers.org/syntax/shellvars
var BashNoStoreVarNames = map[string]bool{
	"BASH":                  true,
	"BASHOPTS":              true,
	"BASHPID":               true,
	"BASH_ALIASES":          true,
	"BASH_ARGC":             true,
	"BASH_ARGV":             true,
	"BASH_ARGV0":            true,
	"BASH_CMDS":             true,
	"BASH_COMMAND":          true,
	"BASH_EXECUTION_STRING": true,
	"LINENO":                true,
	"BASH_LINENO":           true,
	"BASH_REMATCH":          true,
	"BASH_SOURCE":           true,
	"BASH_SUBSHELL":         true,
	"COPROC":                true,
	"DIRSTACK":              true,
	"EPOCHREALTIME":         true,
	"EPOCHSECONDS":          true,
	"FUNCNAME":              true,
	"HISTCMD":               true,
	"OLDPWD":                true,
	"PIPESTATUS":            true,
	"PPID":                  true,
	"PWD":                   true,
	"RANDOM":                true,
	"SECONDS":               true,
	"SHLVL":                 true,
	"HISTFILE":              true,
	"HISTFILESIZE":          true,
	"HISTCONTROL":           true,
	"HISTIGNORE":            true,
	"HISTSIZE":              true,
	"HISTTIMEFORMAT":        true,
	"SRANDOM":               true,
	"COLUMNS":               true,
	"LINES":                 true,

	// we want these in our remote state object
	// "EUID":                  true,
	// "SHELLOPTS":             true,
	// "UID":                   true,
	// "BASH_VERSINFO":         true,
	// "BASH_VERSION":          true,
}

var declareDeclArgsRe = regexp.MustCompile("^[aAxrifx]*$")
var bashValidIdentifierRe = regexp.MustCompile("^[a-zA-Z_][a-zA-Z0-9_]*$")

func bashValidate(d *DeclareDeclType) error {
	if len(d.Name) == 0 || !isValidBashIdentifier(d.Name) {
		return fmt.Errorf("invalid shell variable name (invalid bash identifier)")
	}
	if strings.Index(d.Value, "\x00") >= 0 {
		return fmt.Errorf("invalid shell variable value (cannot contain 0 byte)")
	}
	if !declareDeclArgsRe.MatchString(d.Args) {
		return fmt.Errorf("invalid shell variable type %s", shellescape.Quote(d.Args))
	}
	return nil
}

func isValidBashIdentifier(s string) bool {
	return bashValidIdentifierRe.MatchString(s)
}

func bashParseDeclareStmt(stmt *syntax.Stmt, src string) (*DeclareDeclType, error) {
	cmd := stmt.Cmd
	decl, ok := cmd.(*syntax.DeclClause)
	if !ok || decl.Variant.Value != "declare" || len(decl.Args) != 2 {
		return nil, fmt.Errorf("invalid declare variant")
	}
	rtn := &DeclareDeclType{}
	declArgs := decl.Args[0]
	if !declArgs.Naked || len(declArgs.Value.Parts) != 1 {
		return nil, fmt.Errorf("wrong number of declare args parts")
	}
	declArgsLit, ok := declArgs.Value.Parts[0].(*syntax.Lit)
	if !ok {
		return nil, fmt.Errorf("declare args is not a literal")
	}
	if !strings.HasPrefix(declArgsLit.Value, "-") {
		return nil, fmt.Errorf("declare args not an argument (does not start with '-')")
	}
	if declArgsLit.Value == "--" {
		rtn.Args = ""
	} else {
		rtn.Args = declArgsLit.Value[1:]
	}
	declAssign := decl.Args[1]
	if declAssign.Name == nil {
		return nil, fmt.Errorf("declare does not have a valid name")
	}
	rtn.Name = declAssign.Name.Value
	if declAssign.Naked || declAssign.Index != nil || declAssign.Append {
		return nil, fmt.Errorf("invalid decl format")
	}
	if declAssign.Value != nil {
		rtn.Value = string(src[declAssign.Value.Pos().Offset():declAssign.Value.End().Offset()])
	} else if declAssign.Array != nil {
		rtn.Value = string(src[declAssign.Array.Pos().Offset():declAssign.Array.End().Offset()])
	} else {
		return nil, fmt.Errorf("invalid decl, not plain value or array")
	}
	err := bashNormalize(rtn)
	if err != nil {
		return nil, err
	}
	if err = bashValidate(rtn); err != nil {
		return nil, err
	}
	return rtn, nil
}

func bashParseDeclareOutput(state *packet.ShellState, declareBytes []byte, pvarBytes []byte) error {
	declareStr := string(declareBytes)
	r := bytes.NewReader(declareBytes)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "bash-declare-output")
	if err != nil {
		return fmt.Errorf("cannot parse bash declare output: %w", err)
	}
	var firstParseErr error
	declMap := make(map[string]*DeclareDeclType)
	for _, stmt := range file.Stmts {
		decl, err := bashParseDeclareStmt(stmt, declareStr)
		if err != nil {
			if firstParseErr == nil {
				firstParseErr = err
			}
		}
		if decl != nil && !BashNoStoreVarNames[decl.Name] {
			declMap[decl.Name] = decl
		}
	}
	pvarMap := parseExtVarOutput(pvarBytes, "", "")
	utilfn.CombineMaps(declMap, pvarMap)
	state.ShellVars = shellenv.SerializeDeclMap(declMap) // this writes out the decls in a canonical order
	if firstParseErr != nil {
		state.Error = firstParseErr.Error()
	}
	return nil
}

func parseBashShellStateOutput(outputBytes []byte) (*packet.ShellState, error) {
	if scbase.IsDevMode() && DebugState {
		writeStateToFile(packet.ShellType_bash, outputBytes)
	}
	// 7 fields: ignored [0], version [1], cwd [2], env/vars [3], aliases [4], funcs [5], pvars [6]
	fields := bytes.Split(outputBytes, []byte{0, 0})
	if len(fields) != 7 {
		return nil, fmt.Errorf("invalid bash shell state output, wrong number of fields, fields=%d", len(fields))
	}
	rtn := &packet.ShellState{}
	rtn.Version = strings.TrimSpace(string(fields[1]))
	if rtn.GetShellType() != packet.ShellType_bash {
		return nil, fmt.Errorf("invalid bash shell state output, wrong shell type: %q", rtn.Version)
	}
	if _, _, err := packet.ParseShellStateVersion(rtn.Version); err != nil {
		return nil, fmt.Errorf("invalid bash shell state output, invalid version: %v", err)
	}
	cwdStr := string(fields[2])
	if strings.HasSuffix(cwdStr, "\r\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-2]
	} else if strings.HasSuffix(cwdStr, "\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-1]
	}
	rtn.Cwd = string(cwdStr)
	err := bashParseDeclareOutput(rtn, fields[3], fields[6])
	if err != nil {
		return nil, err
	}
	rtn.Aliases = strings.ReplaceAll(string(fields[4]), "\r\n", "\n")
	rtn.Funcs = strings.ReplaceAll(string(fields[5]), "\r\n", "\n")
	rtn.Funcs = shellenv.RemoveFunc(rtn.Funcs, "_waveshell_exittrap")
	return rtn, nil
}

func bashNormalize(d *DeclareDeclType) error {
	if d.DataType() == shellenv.DeclTypeAssocArray {
		return bashNormalizeAssocArrayDecl(d)
	}
	return nil
}

// normalizes order of assoc array keys so value is stable
func bashNormalizeAssocArrayDecl(d *DeclareDeclType) error {
	if d.DataType() != shellenv.DeclTypeAssocArray {
		return fmt.Errorf("invalid decltype passed to assocArrayDeclToStr: %s", d.DataType())
	}
	varMap, err := bashAssocArrayVarToMap(d)
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(varMap))
	for key := range varMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var buf bytes.Buffer
	buf.WriteByte('(')
	for _, key := range keys {
		buf.WriteByte('[')
		buf.WriteString(key)
		buf.WriteByte(']')
		buf.WriteByte('=')
		buf.WriteString(varMap[key])
		buf.WriteByte(' ')
	}
	buf.WriteByte(')')
	d.Value = buf.String()
	return nil
}

func bashAssocArrayVarToMap(d *DeclareDeclType) (map[string]string, error) {
	if d.DataType() != shellenv.DeclTypeAssocArray {
		return nil, fmt.Errorf("decl is not an assoc-array")
	}
	refStr := "X=" + d.Value
	r := strings.NewReader(refStr)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "assocdecl")
	if err != nil {
		return nil, fmt.Errorf("parsing bash assoc-array value: %w", err)
	}
	if len(file.Stmts) != 1 {
		return nil, fmt.Errorf("invalid assoc-array parse (multiple stmts)")
	}
	stmt := file.Stmts[0]
	callExpr, ok := stmt.Cmd.(*syntax.CallExpr)
	if !ok || len(callExpr.Args) != 0 || len(callExpr.Assigns) != 1 {
		return nil, fmt.Errorf("invalid assoc-array parse (bad expr)")
	}
	assign := callExpr.Assigns[0]
	arrayExpr := assign.Array
	if arrayExpr == nil {
		return nil, fmt.Errorf("invalid assoc-array parse (no array expr)")
	}
	rtn := make(map[string]string)
	for _, elem := range arrayExpr.Elems {
		indexStr := refStr[elem.Index.Pos().Offset():elem.Index.End().Offset()]
		valStr := refStr[elem.Value.Pos().Offset():elem.Value.End().Offset()]
		rtn[indexStr] = valStr
	}
	return rtn, nil
}

func BashDeclareStmt(d *DeclareDeclType) string {
	var argsStr string
	if d.Args == "" {
		argsStr = "--"
	} else {
		argsStr = "-" + d.Args
	}
	return fmt.Sprintf("declare %s %s=%s", argsStr, d.Name, d.Value)
}
