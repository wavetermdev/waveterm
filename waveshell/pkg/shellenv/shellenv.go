// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellenv

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/simpleexpand"
	"github.com/wavetermdev/waveterm/waveshell/pkg/statediff"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

const (
	DeclTypeArray      = "array"
	DeclTypeAssocArray = "assoc"
	DeclTypeInt        = "int"
	DeclTypeNormal     = "normal"
)

type DeclareDeclType struct {
	IsZshDecl bool

	Args string
	Name string

	// this holds the raw quoted value suitable for bash. this is *not* the real expanded variable value
	Value string

	// special fields for zsh "-T" output.
	// for bound scalars, "Value" hold everything after the "=" (including the separator character)
	ZshBoundScalar string // the name of the "scalar" env variable
	ZshEnvValue    string // unlike Value this *is* the expanded value of scalar env variable
}

func (d *DeclareDeclType) IsExport() bool {
	return strings.Index(d.Args, "x") >= 0
}

func (d *DeclareDeclType) IsReadOnly() bool {
	return strings.Index(d.Args, "r") >= 0
}

func (d *DeclareDeclType) IsZshScalarBound() bool {
	return strings.Index(d.Args, "T") >= 0
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

func (d *DeclareDeclType) Serialize() []byte {
	if d.IsZshDecl {
		// return fmt.Sprintf("z%s|%s=%s\x00", d.Args, d.Name, d.Value)
		return nil
	}
	rtn := fmt.Sprintf("%s|%s=%s\x00", d.Args, d.Name, d.Value)
	return []byte(rtn)
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

// envline should be valid
func parseDeclLine(envLine string) *DeclareDeclType {
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
	decl := parseDeclLine(envLine)
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
	orderedKeys := utilfn.GetOrderedMapKeys(varMap)
	for _, key := range orderedKeys {
		val := varMap[key]
		buf.WriteString(val)
		buf.WriteByte(0)
	}
	return buf.Bytes()
}

func DeclMapFromState(state *packet.ShellState) map[string]*DeclareDeclType {
	if state == nil {
		return nil
	}
	rtn := make(map[string]*DeclareDeclType)
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := parseDeclLine(string(varLine))
		if decl != nil {
			rtn[decl.Name] = decl
		}
	}
	return rtn
}

func SerializeDeclMap(declMap map[string]*DeclareDeclType) []byte {
	var rtn bytes.Buffer
	orderedKeys := utilfn.GetOrderedMapKeys(declMap)
	for _, key := range orderedKeys {
		decl := declMap[key]
		rtn.Write(decl.Serialize())
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
		decl := parseDeclLine(string(varLine))
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
		decl := parseDeclLine(string(varLine))
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
		decl := parseDeclLine(string(varLine))
		if decl != nil {
			rtn = append(rtn, decl)
		}
	}
	return rtn
}

func RemoveFunc(funcs string, toRemove string) string {
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
