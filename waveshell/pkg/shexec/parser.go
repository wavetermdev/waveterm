// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shexec

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/simpleexpand"
	"github.com/wavetermdev/waveterm/waveshell/pkg/statediff"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

const (
	DeclTypeArray      = "array"
	DeclTypeAssocArray = "assoc"
	DeclTypeInt        = "int"
	DeclTypeNormal     = "normal"
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
	for key := range e.Env {
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

func writeIndent(buf *bytes.Buffer, num int) {
	for i := 0; i < num; i++ {
		buf.WriteByte(' ')
	}
}

func makeSpaceStr(num int) string {
	barr := make([]byte, num)
	for i := 0; i < num; i++ {
		barr[i] = ' '
	}
	return string(barr)
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
	"COLUMNS":               true,
	"LINES":                 true,

	// we want these in our remote state object
	// "EUID":                  true,
	// "SHELLOPTS":             true,
	// "UID":                   true,
	// "BASH_VERSINFO":         true,
	// "BASH_VERSION":          true,
}

type DeclareDeclType struct {
	Args string
	Name string

	// this holds the raw quoted value suitable for bash. this is *not* the real expanded variable value
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

func (d *DeclareDeclType) DeclareStmt() string {
	var argsStr string
	if d.Args == "" {
		argsStr = "--"
	} else {
		argsStr = "-" + d.Args
	}
	return fmt.Sprintf("declare %s %s=%s", argsStr, d.Name, d.Value)
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

// returns name => full-line
func parseDeclLineToKV(envLine string) (string, string) {
	decl := ParseDeclLine(envLine)
	if decl == nil {
		return "", ""
	}
	return decl.Name, envLine
}

func shellStateVarsToMap(shellVars []byte) map[string]string {
	if len(shellVars) == 0 {
		return nil
	}
	rtn := make(map[string]string)
	vars := bytes.Split(shellVars, []byte{0})
	for _, varLine := range vars {
		name, val := parseDeclLineToKV(string(varLine))
		if name == "" {
			continue
		}
		rtn[name] = val
	}
	return rtn
}

func strMapToShellStateVars(varMap map[string]string) []byte {
	var buf bytes.Buffer
	orderedKeys := getOrderedKeysStrMap(varMap)
	for _, key := range orderedKeys {
		val := varMap[key]
		buf.WriteString(val)
		buf.WriteByte(0)
	}
	return buf.Bytes()
}

func getOrderedKeysStrMap(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func getOrderedKeysDeclMap(m map[string]*DeclareDeclType) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
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
	orderedKeys := getOrderedKeysDeclMap(declMap)
	for _, key := range orderedKeys {
		decl := declMap[key]
		rtn.WriteString(decl.Serialize())
	}
	return rtn.Bytes()
}

func EnvMapFromState(state *packet.ShellState) map[string]string {
	if state == nil {
		return nil
	}
	rtn := make(map[string]string)
	ectx := simpleexpand.SimpleExpandContext{}
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := ParseDeclLine(string(varLine))
		if decl != nil && decl.IsExport() {
			rtn[decl.Name], _ = simpleexpand.SimpleExpandPartialWord(ectx, decl.Value, false)
		}
	}
	return rtn
}

func ShellVarMapFromState(state *packet.ShellState) map[string]string {
	if state == nil {
		return nil
	}
	rtn := make(map[string]string)
	ectx := simpleexpand.SimpleExpandContext{}
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := ParseDeclLine(string(varLine))
		if decl != nil {
			rtn[decl.Name], _ = simpleexpand.SimpleExpandPartialWord(ectx, decl.Value, false)
		}
	}
	return rtn
}

func DumpVarMapFromState(state *packet.ShellState) {
	fmt.Printf("DUMP-STATE-VARS:\n")
	if state == nil {
		fmt.Printf("  nil\n")
		return
	}
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		fmt.Printf("  %s\n", varLine)
	}
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

func (d *DeclareDeclType) DataType() string {
	if strings.Index(d.Args, "a") >= 0 {
		return DeclTypeArray
	}
	if strings.Index(d.Args, "A") >= 0 {
		return DeclTypeAssocArray
	}
	if strings.Index(d.Args, "i") >= 0 {
		return DeclTypeInt
	}
	return DeclTypeNormal
}

func parseDeclareStmt(stmt *syntax.Stmt, src string) (*DeclareDeclType, error) {
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
	err := rtn.normalize()
	if err != nil {
		return nil, err
	}
	if err = rtn.Validate(); err != nil {
		return nil, err
	}
	return rtn, nil
}

func parseDeclareOutput(state *packet.ShellState, declareBytes []byte, pvarBytes []byte) error {
	declareStr := string(declareBytes)
	r := bytes.NewReader(declareBytes)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "aliases")
	if err != nil {
		return err
	}
	var firstParseErr error
	declMap := make(map[string]*DeclareDeclType)
	for _, stmt := range file.Stmts {
		decl, err := parseDeclareStmt(stmt, declareStr)
		if err != nil {
			if firstParseErr == nil {
				firstParseErr = err
			}
		}
		if decl != nil && !NoStoreVarNames[decl.Name] {
			declMap[decl.Name] = decl
		}
	}
	pvars := bytes.Split(pvarBytes, []byte{0})
	for _, pvarBA := range pvars {
		pvarStr := string(pvarBA)
		pvarFields := strings.SplitN(pvarStr, " ", 2)
		if len(pvarFields) != 2 {
			continue
		}
		if pvarFields[0] == "" {
			continue
		}
		decl := &DeclareDeclType{Args: "x"}
		decl.Name = "PROMPTVAR_" + pvarFields[0]
		decl.Value = shellescape.Quote(pvarFields[1])
		declMap[decl.Name] = decl
	}
	state.ShellVars = SerializeDeclMap(declMap) // this writes out the decls in a canonical order
	if firstParseErr != nil {
		state.Error = firstParseErr.Error()
	}
	return nil
}

func ParseShellStateOutput(outputBytes []byte) (*packet.ShellState, error) {
	// 5 fields: version, cwd, env/vars, aliases, funcs
	fields := bytes.Split(outputBytes, []byte{0, 0})
	if len(fields) != 6 {
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
	err := parseDeclareOutput(rtn, fields[2], fields[5])
	if err != nil {
		return nil, err
	}
	rtn.Aliases = strings.ReplaceAll(string(fields[3]), "\r\n", "\n")
	rtn.Funcs = strings.ReplaceAll(string(fields[4]), "\r\n", "\n")
	rtn.Funcs = removeFunc(rtn.Funcs, "_mshell_exittrap")
	return rtn, nil
}

func removeFunc(funcs string, toRemove string) string {
	lines := strings.Split(funcs, "\n")
	var newLines []string
	removeLine := fmt.Sprintf("%s ()", toRemove)
	doingRemove := false
	for _, line := range lines {
		if line == removeLine {
			doingRemove = true
			continue
		}
		if doingRemove {
			if line == "}" {
				doingRemove = false
			}
			continue
		}
		newLines = append(newLines, line)
	}
	return strings.Join(newLines, "\n")
}

func (d *DeclareDeclType) normalize() error {
	if d.DataType() == DeclTypeAssocArray {
		return d.normalizeAssocArrayDecl()
	}
	return nil
}

// normalizes order of assoc array keys so value is stable
func (d *DeclareDeclType) normalizeAssocArrayDecl() error {
	if d.DataType() != DeclTypeAssocArray {
		return fmt.Errorf("invalid decltype passed to assocArrayDeclToStr: %s", d.DataType())
	}
	varMap, err := assocArrayVarToMap(d)
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

func assocArrayVarToMap(d *DeclareDeclType) (map[string]string, error) {
	if d.DataType() != DeclTypeAssocArray {
		return nil, fmt.Errorf("decl is not an assoc-array")
	}
	refStr := "X=" + d.Value
	r := strings.NewReader(refStr)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "assocdecl")
	if err != nil {
		return nil, err
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

func strMapsEqual(m1 map[string]string, m2 map[string]string) bool {
	if len(m1) != len(m2) {
		return false
	}
	for key, val1 := range m1 {
		val2, found := m2[key]
		if !found || val1 != val2 {
			return false
		}
	}
	for key := range m2 {
		_, found := m1[key]
		if !found {
			return false
		}
	}
	return true
}

func DeclsEqual(compareName bool, d1 *DeclareDeclType, d2 *DeclareDeclType) bool {
	if d1.IsExport() != d2.IsExport() {
		return false
	}
	if d1.DataType() != d2.DataType() {
		return false
	}
	if compareName && d1.Name != d2.Name {
		return false
	}
	return d1.Value == d2.Value // this works even for assoc arrays because we normalize them when parsing
}

func MakeShellStateDiff(oldState packet.ShellState, oldStateHash string, newState packet.ShellState) (packet.ShellStateDiff, error) {
	var rtn packet.ShellStateDiff
	rtn.BaseHash = oldStateHash
	if oldState.Version != newState.Version {
		return rtn, fmt.Errorf("cannot diff, states have different versions")
	}
	rtn.Version = newState.Version
	if oldState.Cwd != newState.Cwd {
		rtn.Cwd = newState.Cwd
	}
	rtn.Error = newState.Error
	oldVars := shellStateVarsToMap(oldState.ShellVars)
	newVars := shellStateVarsToMap(newState.ShellVars)
	rtn.VarsDiff = statediff.MakeMapDiff(oldVars, newVars)
	rtn.AliasesDiff = statediff.MakeLineDiff(oldState.Aliases, newState.Aliases)
	rtn.FuncsDiff = statediff.MakeLineDiff(oldState.Funcs, newState.Funcs)
	return rtn, nil
}

func ApplyShellStateDiff(oldState packet.ShellState, diff packet.ShellStateDiff) (packet.ShellState, error) {
	var rtnState packet.ShellState
	var err error
	rtnState.Version = oldState.Version
	rtnState.Cwd = oldState.Cwd
	if diff.Cwd != "" {
		rtnState.Cwd = diff.Cwd
	}
	rtnState.Error = diff.Error
	oldVars := shellStateVarsToMap(oldState.ShellVars)
	newVars, err := statediff.ApplyMapDiff(oldVars, diff.VarsDiff)
	if err != nil {
		return rtnState, fmt.Errorf("applying mapdiff 'vars': %v", err)
	}
	rtnState.ShellVars = strMapToShellStateVars(newVars)
	rtnState.Aliases, err = statediff.ApplyLineDiff(oldState.Aliases, diff.AliasesDiff)
	if err != nil {
		return rtnState, fmt.Errorf("applying diff 'aliases': %v", err)
	}
	rtnState.Funcs, err = statediff.ApplyLineDiff(oldState.Funcs, diff.FuncsDiff)
	if err != nil {
		return rtnState, fmt.Errorf("applying diff 'funcs': %v", err)
	}
	return rtnState, nil
}
