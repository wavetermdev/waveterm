package shexec

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/alessio/shellescape"
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

	// we want these in our remote state object
	// "EUID":                  true,
	// "SHELLOPTS":             true,
	// "UID":                   true,
	// "BASH_VERSINFO":         true,
	// "BASH_VERSION":          true,
}

type DeclareDeclType struct {
	Args  string
	Name  string
	Value string
}

var declareDeclArgsRe = regexp.MustCompile("^[aAxrifx]*$")
var bashValidIdentifierRe = regexp.MustCompile("^[a-zA-Z_][a-zA-Z0-9_]*$")

func (d *DeclareDeclType) Validate() error {
	if len(d.Name) == 0 || !IsValidBashIdentifier(d.Name) {
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

func (d *DeclareDeclType) Serialize() string {
	return fmt.Sprintf("%s|%s=%s\x00", d.Args, d.Name, d.Value)
}

func (d *DeclareDeclType) EnvString() string {
	return d.Name + "=" + d.Value
}

func (d *DeclareDeclType) DeclareStmt() string {
	var argsStr string
	if d.Args == "" {
		argsStr = "--"
	} else {
		argsStr = "-" + d.Args
	}
	return fmt.Sprintf("declare %s %s=%s", argsStr, d.Name, shellescape.Quote(d.Value))
}

// envline should be valid
func ParseDeclLine(envLine string) *DeclareDeclType {
	eqIdx := strings.Index(envLine, "=")
	if eqIdx == -1 {
		return nil
	}
	namePart := envLine[0:eqIdx]
	valPart := envLine[eqIdx+1:]
	pipeIdx := strings.Index(namePart, "|")
	if pipeIdx == -1 {
		return nil
	}
	return &DeclareDeclType{
		Args:  namePart[0:pipeIdx],
		Name:  namePart[pipeIdx+1:],
		Value: valPart,
	}
}

func DeclMapFromState(state *packet.ShellState) map[string]*DeclareDeclType {
	if state == nil {
		return nil
	}
	rtn := make(map[string]*DeclareDeclType)
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := ParseDeclLine(string(varLine))
		if decl != nil {
			rtn[decl.Name] = decl
		}
	}
	return rtn
}

func SerializeDeclMap(declMap map[string]*DeclareDeclType) []byte {
	var rtn bytes.Buffer
	for _, decl := range declMap {
		rtn.WriteString(decl.Serialize())
	}
	return rtn.Bytes()
}

func EnvMapFromState(state *packet.ShellState) map[string]string {
	if state == nil {
		return nil
	}
	rtn := make(map[string]string)
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := ParseDeclLine(string(varLine))
		if decl != nil && decl.IsExport() {
			rtn[decl.Name] = decl.Value
		}
	}
	return rtn
}

func ShellVarMapFromState(state *packet.ShellState) map[string]string {
	if state == nil {
		return nil
	}
	rtn := make(map[string]string)
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := ParseDeclLine(string(varLine))
		if decl != nil {
			rtn[decl.Name] = decl.Value
		}
	}
	return rtn
}

func VarDeclsFromState(state *packet.ShellState) []*DeclareDeclType {
	if state == nil {
		return nil
	}
	var rtn []*DeclareDeclType
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := ParseDeclLine(string(varLine))
		if decl != nil {
			rtn = append(rtn, decl)
		}
	}
	return rtn
}

func IsValidBashIdentifier(s string) bool {
	return bashValidIdentifierRe.MatchString(s)
}

func (d *DeclareDeclType) IsExport() bool {
	return strings.Index(d.Args, "x") >= 0
}

func (d *DeclareDeclType) IsReadOnly() bool {
	return strings.Index(d.Args, "r") >= 0
}

func parseDeclareStmt(stmt *syntax.Stmt, src []byte) (*DeclareDeclType, error) {
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
		varValueStr, err := QuotedLitToStr(declAssign.Value)
		if err != nil {
			return nil, fmt.Errorf("parsing declare value: %w", err)
		}
		rtn.Value = varValueStr
	} else if declAssign.Array != nil {
		rtn.Value = string(src[declAssign.Array.Pos().Offset():declAssign.Array.End().Offset()])
	} else {
		return nil, fmt.Errorf("invalid decl, not plain value or array")
	}
	if err := rtn.Validate(); err != nil {
		return nil, err
	}
	return rtn, nil
}

func parseDeclareOutput(state *packet.ShellState, declareBytes []byte) error {
	r := bytes.NewReader(declareBytes)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "aliases")
	if err != nil {
		return err
	}
	var varsBuffer bytes.Buffer
	var firstParseErr error
	for _, stmt := range file.Stmts {
		decl, err := parseDeclareStmt(stmt, declareBytes)
		if err != nil {
			if firstParseErr == nil {
				firstParseErr = err
			}
		}
		if decl != nil && !NoStoreVarNames[decl.Name] {
			varsBuffer.WriteString(decl.Serialize())
		}
	}
	state.ShellVars = varsBuffer.Bytes()
	if firstParseErr != nil {
		state.Error = firstParseErr.Error()
	}
	return nil
}

func ParseShellStateOutput(outputBytes []byte) (*packet.ShellState, error) {
	// 5 fields: version, cwd, env/vars, aliases, funcs
	fields := bytes.Split(outputBytes, []byte{0, 0})
	if len(fields) != 5 {
		return nil, fmt.Errorf("invalid shell state output, wrong number of fields, fields=%d", len(fields))
	}
	rtn := &packet.ShellState{}
	rtn.Version = strings.TrimSpace(string(fields[0]))
	if strings.Index(rtn.Version, "bash") == -1 {
		return nil, fmt.Errorf("invalid shell state output, only bash is supported")
	}
	cwdStr := string(fields[1])
	if strings.HasSuffix(cwdStr, "\r\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-2]
	} else if strings.HasSuffix(cwdStr, "\n") {
		cwdStr = cwdStr[0 : len(cwdStr)-1]
	}
	rtn.Cwd = string(cwdStr)
	err := parseDeclareOutput(rtn, fields[2])
	if err != nil {
		return nil, err
	}
	rtn.Aliases = strings.ReplaceAll(string(fields[3]), "\r\n", "\n")
	rtn.Funcs = strings.ReplaceAll(string(fields[4]), "\r\n", "\n")
	return rtn, nil
}
