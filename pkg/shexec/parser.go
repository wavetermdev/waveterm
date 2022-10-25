package shexec

import (
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/scripthaus-dev/mshell/pkg/packet"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

type ParseEnviron struct {
	Env map[string]string
}

func (e *ParseEnviron) Get(name string) expand.Variable {
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

func (e *ParseEnviron) Each(fn func(name string, vr expand.Variable) bool) {
	for key, _ := range e.Env {
		rtn := fn(key, e.Get(key))
		if !rtn {
			break
		}
	}
}

func doCmdSubst(commandStr string, w io.Writer, word *syntax.CmdSubst) error {
	return nil
}

func doProcSubst(w *syntax.ProcSubst) (string, error) {
	return "", nil
}

func GetParserConfig(envMap map[string]string) *expand.Config {
	cfg := &expand.Config{
		Env:       &ParseEnviron{Env: envMap},
		GlobStar:  false,
		NullGlob:  false,
		NoUnset:   false,
		CmdSubst:  func(w io.Writer, word *syntax.CmdSubst) error { return doCmdSubst("", w, word) },
		ProcSubst: doProcSubst,
		ReadDir:   nil,
	}
	return cfg
}

func QuotedLitToStr(word *syntax.Word) (string, error) {
	cfg := GetParserConfig(nil)
	return expand.Literal(cfg, word)
}

// https://wiki.bash-hackers.org/syntax/shellvars
var NoStoreVarNames = map[string]bool{
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
	"BASH_LINENO":           true,
	"BASH_REMATCH":          true,
	"BASH_SOURCE":           true,
	"BASH_SUBSHELL":         true,
	"BASH_VERSINFO":         true,
	"BASH_VERSION":          true,
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
}

func parseDeclareStmt(envBuffer *bytes.Buffer, varsBuffer *bytes.Buffer, stmt *syntax.Stmt, src []byte) error {
	cmd := stmt.Cmd
	decl, ok := cmd.(*syntax.DeclClause)
	if !ok || decl.Variant.Value != "declare" || len(decl.Args) != 2 {
		return fmt.Errorf("invalid declare variant")
	}
	declArgs := decl.Args[0]
	if !declArgs.Naked || len(declArgs.Value.Parts) != 1 {
		return fmt.Errorf("wrong number of declare args parts")
	}
	declArgLit, ok := declArgs.Value.Parts[0].(*syntax.Lit)
	if !ok {
		return fmt.Errorf("declare args is not a literal")
	}
	declArgStr := declArgLit.Value
	if !strings.HasPrefix(declArgStr, "-") {
		return fmt.Errorf("declare args not an argument (does not start with '-')")
	}
	declAssign := decl.Args[1]
	if declAssign.Name == nil {
		return fmt.Errorf("declare does not have a valid name")
	}
	varName := declAssign.Name.Value
	if NoStoreVarNames[varName] {
		return nil
	}
	if strings.Index(varName, "=") != -1 || strings.Index(varName, "\x00") != -1 {
		return fmt.Errorf("invalid varname (cannot contain '=' or 0 byte)")
	}
	fullDeclBytes := src[decl.Pos().Offset():decl.End().Offset()]
	if strings.Index(declArgStr, "x") == -1 {
		// non-exported vars get written to vars as decl statements
		varsBuffer.Write(fullDeclBytes)
		varsBuffer.WriteRune('\n')
		return nil
	}
	if declArgStr != "-x" {
		return fmt.Errorf("can only export plain bash variables (no arrays)")
	}
	// exported vars are parsed into Env0 format
	if declAssign.Naked || declAssign.Array != nil || declAssign.Index != nil || declAssign.Append || declAssign.Value == nil {
		return fmt.Errorf("invalid variable to export")
	}
	varValue := declAssign.Value
	varValueStr, err := QuotedLitToStr(varValue)
	if err != nil {
		return fmt.Errorf("parsing declare value: %w", err)
	}
	if strings.Index(varValueStr, "\x00") != -1 {
		return fmt.Errorf("invalid export var value (cannot contain 0 byte)")
	}
	envBuffer.WriteString(fmt.Sprintf("%s=%s\x00", varName, varValueStr))
	return nil
}

func parseDeclareOutput(state *packet.ShellState, declareBytes []byte) error {
	r := bytes.NewReader(declareBytes)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "aliases")
	if err != nil {
		return err
	}
	var envBuffer, varsBuffer bytes.Buffer
	for _, stmt := range file.Stmts {
		err = parseDeclareStmt(&envBuffer, &varsBuffer, stmt, declareBytes)
		if err != nil {
			// TODO where to put parse errors?
			continue
		}
	}
	state.Env0 = envBuffer.Bytes()
	state.ShellVars = varsBuffer.String()
	return nil
}

func ParseShellStateOutput(outputBytes []byte) (*packet.ShellState, error) {
	// 5 fields: version, cwd, env/vars, aliases, funcs
	fields := bytes.Split(outputBytes, []byte{0, 0})
	if len(fields) != 5 {
		return nil, fmt.Errorf("invalid shell state output, wrong number of fields, fields=%d", len(fields))
	}
	rtn := &packet.ShellState{}
	rtn.Version = string(fields[0])
	if strings.Index(rtn.Version, "bash") == -1 {
		return nil, fmt.Errorf("invalid shell state output, only bash is supported")
	}
	cwdStr := string(fields[1])
	if strings.HasSuffix(cwdStr, "\r\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-2]
	}
	rtn.Cwd = string(cwdStr)
	parseDeclareOutput(rtn, fields[2])
	rtn.Aliases = strings.ReplaceAll(string(fields[3]), "\r\n", "\n")
	rtn.Funcs = strings.ReplaceAll(string(fields[4]), "\r\n", "\n")
	return rtn, nil
}
