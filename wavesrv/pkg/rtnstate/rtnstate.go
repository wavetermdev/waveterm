// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rtnstate

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shexec"
	"github.com/wavetermdev/waveterm/waveshell/pkg/simpleexpand"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/utilfn"
	"mvdan.cc/sh/v3/syntax"
)

func parseAliasStmt(stmt *syntax.Stmt, sourceStr string) (string, string, error) {
	cmd := stmt.Cmd
	callExpr, ok := cmd.(*syntax.CallExpr)
	if !ok {
		return "", "", fmt.Errorf("wrong cmd type for alias")
	}
	if len(callExpr.Args) != 2 {
		return "", "", fmt.Errorf("wrong number of words in alias expr wordslen=%d", len(callExpr.Args))
	}
	firstWord := callExpr.Args[0]
	if firstWord.Lit() != "alias" {
		return "", "", fmt.Errorf("invalid alias cmd word (not 'alias')")
	}
	secondWord := callExpr.Args[1]
	var ectx simpleexpand.SimpleExpandContext // no homedir, do not want ~ expansion
	val, _ := simpleexpand.SimpleExpandWord(ectx, secondWord, sourceStr)
	eqIdx := strings.Index(val, "=")
	if eqIdx == -1 {
		return "", "", fmt.Errorf("no '=' in alias definition")
	}
	return val[0:eqIdx], val[eqIdx+1:], nil
}

func ParseAliases(aliases string) (map[string]string, error) {
	r := strings.NewReader(aliases)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "aliases")
	if err != nil {
		return nil, err
	}
	rtn := make(map[string]string)
	for _, stmt := range file.Stmts {
		aliasName, aliasVal, err := parseAliasStmt(stmt, aliases)
		if err != nil {
			// fmt.Printf("stmt-err: %v\n", err)
			continue
		}
		if aliasName != "" {
			rtn[aliasName] = aliasVal
		}
	}
	return rtn, nil
}

func parseFuncStmt(stmt *syntax.Stmt, source string) (string, string, error) {
	cmd := stmt.Cmd
	funcDecl, ok := cmd.(*syntax.FuncDecl)
	if !ok {
		return "", "", fmt.Errorf("cmd not FuncDecl")
	}
	name := funcDecl.Name.Value
	// fmt.Printf("func: [%s]\n", name)
	funcBody := funcDecl.Body
	// fmt.Printf("  %d:%d\n", funcBody.Cmd.Pos().Offset(), funcBody.Cmd.End().Offset())
	bodyStr := source[funcBody.Cmd.Pos().Offset():funcBody.Cmd.End().Offset()]
	// fmt.Printf("<<<\n%s\n>>>\n", bodyStr)
	// fmt.Printf("\n")
	return name, bodyStr, nil
}

func ParseFuncs(funcs string) (map[string]string, error) {
	r := strings.NewReader(funcs)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(r, "funcs")
	if err != nil {
		return nil, err
	}
	rtn := make(map[string]string)
	for _, stmt := range file.Stmts {
		funcName, funcVal, err := parseFuncStmt(stmt, funcs)
		if err != nil {
			// TODO where to put parse errors
			continue
		}
		if strings.HasPrefix(funcName, "_mshell_") {
			continue
		}
		if funcName != "" {
			rtn[funcName] = funcVal
		}
	}
	return rtn, nil
}

const MaxDiffKeyLen = 40
const MaxDiffValLen = 50

var IgnoreVars = map[string]bool{
	"PROMPT":            true,
	"PROMPT_VERSION":    true,
	"MSHELL":            true,
	"MSHELL_VERSION":    true,
	"WAVESHELL":         true,
	"WAVESHELL_VERSION": true,
}

func displayStateUpdateDiff(buf *bytes.Buffer, oldState packet.ShellState, newState packet.ShellState) {
	if newState.Cwd != oldState.Cwd {
		buf.WriteString(fmt.Sprintf("cwd %s\n", newState.Cwd))
	}
	if !bytes.Equal(newState.ShellVars, oldState.ShellVars) {
		newEnvMap := shexec.DeclMapFromState(&newState)
		oldEnvMap := shexec.DeclMapFromState(&oldState)
		for key, newVal := range newEnvMap {
			if IgnoreVars[key] {
				continue
			}
			oldVal, found := oldEnvMap[key]
			if !found || !shexec.DeclsEqual(false, oldVal, newVal) {
				var exportStr string
				if newVal.IsExport() {
					exportStr = "export "
				}
				buf.WriteString(fmt.Sprintf("%s%s=%s\n", exportStr, utilfn.EllipsisStr(key, MaxDiffKeyLen), utilfn.EllipsisStr(newVal.Value, MaxDiffValLen)))
			}
		}
		for key, _ := range oldEnvMap {
			if IgnoreVars[key] {
				continue
			}
			_, found := newEnvMap[key]
			if !found {
				buf.WriteString(fmt.Sprintf("unset %s\n", utilfn.EllipsisStr(key, MaxDiffKeyLen)))
			}
		}
	}
	if newState.Aliases != oldState.Aliases {
		newAliasMap, _ := ParseAliases(newState.Aliases)
		oldAliasMap, _ := ParseAliases(oldState.Aliases)
		for aliasName, newAliasVal := range newAliasMap {
			oldAliasVal, found := oldAliasMap[aliasName]
			if !found || newAliasVal != oldAliasVal {
				buf.WriteString(fmt.Sprintf("alias %s\n", utilfn.EllipsisStr(shellescape.Quote(aliasName), MaxDiffKeyLen)))
			}
		}
		for aliasName, _ := range oldAliasMap {
			_, found := newAliasMap[aliasName]
			if !found {
				buf.WriteString(fmt.Sprintf("unalias %s\n", utilfn.EllipsisStr(shellescape.Quote(aliasName), MaxDiffKeyLen)))
			}
		}
	}
	if newState.Funcs != oldState.Funcs {
		newFuncMap, _ := ParseFuncs(newState.Funcs)
		oldFuncMap, _ := ParseFuncs(oldState.Funcs)
		for funcName, newFuncVal := range newFuncMap {
			oldFuncVal, found := oldFuncMap[funcName]
			if !found || newFuncVal != oldFuncVal {
				buf.WriteString(fmt.Sprintf("function %s\n", utilfn.EllipsisStr(shellescape.Quote(funcName), MaxDiffKeyLen)))
			}
		}
		for funcName, _ := range oldFuncMap {
			_, found := newFuncMap[funcName]
			if !found {
				buf.WriteString(fmt.Sprintf("unset -f %s\n", utilfn.EllipsisStr(shellescape.Quote(funcName), MaxDiffKeyLen)))
			}
		}
	}
}

func GetRtnStateDiff(ctx context.Context, screenId string, lineId string) ([]byte, error) {
	cmd, err := sstore.GetCmdByScreenId(ctx, screenId, lineId)
	if err != nil {
		return nil, err
	}
	if cmd == nil {
		return nil, nil
	}
	if !cmd.RtnState {
		return nil, nil
	}
	if cmd.RtnStatePtr.IsEmpty() {
		return nil, nil
	}
	var outputBytes bytes.Buffer
	initialState, err := sstore.GetFullState(ctx, cmd.StatePtr)
	if err != nil {
		return nil, fmt.Errorf("getting initial full state: %v", err)
	}
	rtnState, err := sstore.GetFullState(ctx, cmd.RtnStatePtr)
	if err != nil {
		return nil, fmt.Errorf("getting rtn full state: %v", err)
	}
	displayStateUpdateDiff(&outputBytes, *initialState, *rtnState)
	return outputBytes.Bytes(), nil
}
