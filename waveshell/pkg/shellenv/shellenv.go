// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellenv

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/simpleexpand"
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
	IsPVar    bool

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

func (d *DeclareDeclType) IsArray() bool {
	return strings.Index(d.Args, "a") >= 0
}

func (d *DeclareDeclType) IsAssocArray() bool {
	return strings.Index(d.Args, "A") >= 0
}

func (d *DeclareDeclType) IsUniqueArray() bool {
	return d.IsArray() && strings.Index(d.Args, "U") >= 0
}

func (d *DeclareDeclType) AddFlag(flag string) {
	if strings.Index(d.Args, flag) >= 0 {
		return
	}
	d.Args += flag
}

func (d *DeclareDeclType) SortZshFlags() {
	// x is always first (or g)
	// T is always last
	// the 'i' flags are tricky (they shouldn't be sorted, because the order matters, e.g. i10)
	var hasX, hasG, hasT bool
	var newArgs []rune
	for _, r := range d.Args {
		if r == 'x' {
			hasX = true
			continue
		}
		if r == 'g' {
			hasG = true
			continue
		}
		if r == 'T' {
			hasT = true
			continue
		}
		newArgs = append(newArgs, r)
	}
	newArgsStr := string(newArgs)
	if hasG {
		newArgsStr = "g" + newArgsStr
	}
	if hasX {
		newArgsStr = "x" + newArgsStr
	}
	if hasT {
		newArgsStr += "T"
	}
	d.Args = newArgsStr
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

func FindVarDecl(decls []*DeclareDeclType, name string) *DeclareDeclType {
	for _, decl := range decls {
		if decl.Name == name {
			return decl
		}
	}
	return nil
}

// NOTE Serialize no longer writes the final null byte
func (d *DeclareDeclType) Serialize() []byte {
	if d.IsPVar {
		parts := []string{
			"p1",
			d.Name,
			d.Value,
		}
		return utilfn.EncodeStringArray(parts)
	} else if d.IsZshDecl {
		d.SortZshFlags()
		parts := []string{
			"z1",
			d.Args,
			d.Name,
			d.Value,
			d.ZshBoundScalar,
			d.ZshEnvValue,
		}
		return utilfn.EncodeStringArray(parts)
	} else {
		parts := []string{
			"b1",
			d.Args,
			d.Name,
			d.Value,
		}
		return utilfn.EncodeStringArray(parts)
	}
	// this is the v0 encoding (keeping here for reference since we still need to decode this)
	// rtn := fmt.Sprintf("%s|%s=%s\x00", d.Args, d.Name, d.Value)
	// return []byte(rtn)
}

func (d *DeclareDeclType) UnescapedValue() string {
	if d.IsPVar {
		return d.Value
	}
	ectx := simpleexpand.SimpleExpandContext{}
	rtn, _ := simpleexpand.SimpleExpandPartialWord(ectx, d.Value, false)
	return rtn
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

// envline should be valid
func parseDeclLine(envLineBytes []byte) *DeclareDeclType {
	if utilfn.EncodedStringArrayHasFirstKey(envLineBytes, "z1") {
		parts, err := utilfn.DecodeStringArray(envLineBytes)
		if err != nil {
			return nil
		}
		if len(parts) != 6 {
			return nil
		}
		return &DeclareDeclType{
			IsZshDecl:      true,
			Args:           parts[1],
			Name:           parts[2],
			Value:          parts[3],
			ZshBoundScalar: parts[4],
			ZshEnvValue:    parts[5],
		}
	} else if utilfn.EncodedStringArrayHasFirstKey(envLineBytes, "b1") {
		parts, err := utilfn.DecodeStringArray(envLineBytes)
		if err != nil {
			return nil
		}
		if len(parts) != 4 {
			return nil
		}
		return &DeclareDeclType{
			Args:  parts[1],
			Name:  parts[2],
			Value: parts[3],
		}
	} else if utilfn.EncodedStringArrayHasFirstKey(envLineBytes, "p1") {
		parts, err := utilfn.DecodeStringArray(envLineBytes)
		if err != nil {
			return nil
		}
		if len(parts) != 3 {
			return nil
		}
		return &DeclareDeclType{
			IsPVar: true,
			Name:   parts[1],
			Value:  parts[2],
		}
	}
	// legacy decoding (v0)
	envLine := string(envLineBytes)
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
func parseDeclLineToKV(envLine []byte) (string, []byte) {
	decl := parseDeclLine(envLine)
	if decl == nil {
		return "", nil
	}
	return decl.Name, envLine
}

func ShellStateVarsToMap(shellVars []byte) map[string][]byte {
	if len(shellVars) == 0 {
		return nil
	}
	rtn := make(map[string][]byte)
	vars := bytes.Split(shellVars, []byte{0})
	for _, varLine := range vars {
		name, val := parseDeclLineToKV(varLine)
		if name == "" {
			continue
		}
		rtn[name] = val
	}
	return rtn
}

func StrMapToShellStateVars(varMap map[string][]byte) []byte {
	var buf bytes.Buffer
	orderedKeys := utilfn.GetOrderedMapKeys(varMap)
	for _, key := range orderedKeys {
		val := varMap[key]
		buf.Write(val)
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
		decl := parseDeclLine(varLine)
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
		rtn.WriteByte(0)
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
		decl := parseDeclLine(varLine)
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
		decl := parseDeclLine(varLine)
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
	decls := VarDeclsFromState(state)
	for _, decl := range decls {
		fmt.Printf("  %s %#v\n", decl.Name, decl)
	}
	envMap := EnvMapFromState(state)
	fmt.Printf("DUMP-STATE-ENV:\n")
	for k, v := range envMap {
		fmt.Printf("  %s=%s\n", k, v)
	}
	fmt.Printf("\n\n")
}

func VarDeclsFromState(state *packet.ShellState) []*DeclareDeclType {
	if state == nil {
		return nil
	}
	var rtn []*DeclareDeclType
	vars := bytes.Split(state.ShellVars, []byte{0})
	for _, varLine := range vars {
		decl := parseDeclLine(varLine)
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
