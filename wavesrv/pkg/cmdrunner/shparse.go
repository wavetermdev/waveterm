// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmdrunner

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/waveshell/pkg/shexec"
	"github.com/wavetermdev/waveterm/waveshell/pkg/simpleexpand"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/utilfn"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

var ValidMetaCmdRe = regexp.MustCompile("^/([a-z_][a-z0-9_-]*)(?::([a-z][a-z0-9_-]*))?$")

type BareMetaCmdDecl struct {
	CmdStr  string
	MetaCmd string
}

var BareMetaCmds = []BareMetaCmdDecl{
	BareMetaCmdDecl{"cr", "cr"},
	BareMetaCmdDecl{"connect", "cr"},
	BareMetaCmdDecl{"clear", "clear"},
	BareMetaCmdDecl{"reset", "reset"},
	BareMetaCmdDecl{"codeedit", "codeedit"},
	BareMetaCmdDecl{"codeview", "codeview"},
	BareMetaCmdDecl{"imageview", "imageview"},
	BareMetaCmdDecl{"markdownview", "markdownview"},
	BareMetaCmdDecl{"mdview", "markdownview"},
	BareMetaCmdDecl{"csvview", "csvview"},
}

const (
	CmdParseTypePositional = "pos"
	CmdParseTypeRaw        = "raw"
)

var CmdParseOverrides map[string]string = map[string]string{
	"setenv":  CmdParseTypePositional,
	"unset":   CmdParseTypePositional,
	"set":     CmdParseTypePositional,
	"run":     CmdParseTypeRaw,
	"comment": CmdParseTypeRaw,
	"chat":    CmdParseTypeRaw,
}

func DumpPacket(pk *scpacket.FeCommandPacketType) {
	if pk == nil || pk.MetaCmd == "" {
		fmt.Printf("[no metacmd]\n")
		return
	}
	if pk.MetaSubCmd == "" {
		fmt.Printf("/%s\n", pk.MetaCmd)
	} else {
		fmt.Printf("/%s:%s\n", pk.MetaCmd, pk.MetaSubCmd)
	}
	for _, arg := range pk.Args {
		fmt.Printf("  %q\n", arg)
	}
	for key, val := range pk.Kwargs {
		fmt.Printf("  [%s]=%q\n", key, val)
	}
}

func isQuoted(source string, w *syntax.Word) bool {
	if w == nil {
		return false
	}
	offset := w.Pos().Offset()
	if int(offset) >= len(source) {
		return false
	}
	return source[offset] == '"' || source[offset] == '\''
}

func getSourceStr(source string, w *syntax.Word) string {
	if w == nil {
		return ""
	}
	offset := w.Pos().Offset()
	end := w.End().Offset()
	return source[offset:end]
}

func SubMetaCmd(cmd string) string {
	switch cmd {
	case "s":
		return "screen"
	case "r":
		return "run"
	case "c":
		return "comment"
	case "e":
		return "eval"
	case "export":
		return "setenv"
	case "connection":
		return "remote"
	default:
		return cmd
	}
}

// returns (metaCmd, metaSubCmd, rest)
// if metaCmd is "" then this isn't a valid metacmd string
func parseMetaCmd(origCommandStr string) (string, string, string) {
	commandStr := strings.TrimSpace(origCommandStr)
	if len(commandStr) < 2 {
		return "run", "", origCommandStr
	}
	fields := strings.SplitN(commandStr, " ", 2)
	firstArg := fields[0]
	rest := ""
	if len(fields) > 1 {
		rest = strings.TrimSpace(fields[1])
	}
	for _, decl := range BareMetaCmds {
		if firstArg == decl.CmdStr {
			return decl.MetaCmd, "", rest
		}
	}
	m := ValidMetaCmdRe.FindStringSubmatch(firstArg)
	if m == nil {
		return "run", "", origCommandStr
	}
	return SubMetaCmd(m[1]), m[2], rest
}

func onlyPositionalArgs(metaCmd string, metaSubCmd string) bool {
	return (CmdParseOverrides[metaCmd] == CmdParseTypePositional) && metaSubCmd == ""
}

func onlyRawArgs(metaCmd string, metaSubCmd string) bool {
	return CmdParseOverrides[metaCmd] == CmdParseTypeRaw
}

func setBracketArgs(argMap map[string]string, bracketStr string) error {
	bracketStr = strings.TrimSpace(bracketStr)
	if bracketStr == "" {
		return nil
	}
	strReader := strings.NewReader(bracketStr)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	var wordErr error
	var ectx simpleexpand.SimpleExpandContext // do not set HomeDir (we don't expand ~ in bracket args)
	err := parser.Words(strReader, func(w *syntax.Word) bool {
		litStr, _ := simpleexpand.SimpleExpandWord(ectx, w, bracketStr)
		eqIdx := strings.Index(litStr, "=")
		var varName, varVal string
		if eqIdx == -1 {
			varName = litStr
		} else {
			varName = litStr[0:eqIdx]
			varVal = litStr[eqIdx+1:]
		}
		if !shexec.IsValidBashIdentifier(varName) {
			wordErr = fmt.Errorf("invalid identifier %s in bracket args", utilfn.ShellQuote(varName, true, 20))
			return false
		}
		if varVal == "" {
			varVal = "1"
		}
		argMap[varName] = varVal
		return true
	})
	if err != nil {
		return err
	}
	if wordErr != nil {
		return wordErr
	}
	return nil
}

var literalRtnStateCommands = []string{".", "source", "unset", "cd", "alias", "unalias", "deactivate"}

func getCallExprLitArg(callExpr *syntax.CallExpr, argNum int) string {
	if len(callExpr.Args) <= argNum {
		return ""
	}
	arg := callExpr.Args[argNum]
	if len(arg.Parts) == 0 {
		return ""
	}
	lit, ok := arg.Parts[0].(*syntax.Lit)
	if !ok {
		return ""
	}
	return lit.Value
}

// detects: export, declare, ., source, X=1, unset
func IsReturnStateCommand(cmdStr string) bool {
	cmdReader := strings.NewReader(cmdStr)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(cmdReader, "cmd")
	if err != nil {
		return false
	}
	for _, stmt := range file.Stmts {
		if callExpr, ok := stmt.Cmd.(*syntax.CallExpr); ok {
			if len(callExpr.Assigns) > 0 && len(callExpr.Args) == 0 {
				return true
			}
			arg0 := getCallExprLitArg(callExpr, 0)
			if arg0 != "" && utilfn.ContainsStr(literalRtnStateCommands, arg0) {
				return true
			}
			if arg0 == "git" {
				arg1 := getCallExprLitArg(callExpr, 1)
				if arg1 == "checkout" || arg1 == "switch" {
					return true
				}
			}
		} else if _, ok := stmt.Cmd.(*syntax.DeclClause); ok {
			return true
		}
	}
	return false
}

func EvalBracketArgs(origCmdStr string) (map[string]string, string, error) {
	rtn := make(map[string]string)
	if strings.HasPrefix(origCmdStr, " ") {
		rtn["nohist"] = "1"
	}
	cmdStr := strings.TrimSpace(origCmdStr)
	if !strings.HasPrefix(cmdStr, "[") {
		return rtn, origCmdStr, nil
	}
	rbIdx := strings.Index(cmdStr, "]")
	if rbIdx == -1 {
		return nil, "", fmt.Errorf("unmatched '[' found in command")
	}
	bracketStr := cmdStr[1:rbIdx]
	restStr := strings.TrimSpace(cmdStr[rbIdx+1:])
	err := setBracketArgs(rtn, bracketStr)
	if err != nil {
		return nil, "", err
	}
	return rtn, restStr, nil
}

func unescapeBackSlashes(s string) string {
	if strings.Index(s, "\\") == -1 {
		return s
	}
	var newStr []rune
	var lastSlash bool
	for _, r := range s {
		if lastSlash {
			lastSlash = false
			newStr = append(newStr, r)
			continue
		}
		if r == '\\' {
			lastSlash = true
			continue
		}
		newStr = append(newStr, r)
	}
	return string(newStr)
}

func EvalMetaCommand(ctx context.Context, origPk *scpacket.FeCommandPacketType) (*scpacket.FeCommandPacketType, error) {
	if len(origPk.Args) == 0 {
		return nil, fmt.Errorf("empty command (no fields)")
	}
	if strings.TrimSpace(origPk.Args[0]) == "" {
		return nil, fmt.Errorf("empty command")
	}
	bracketArgs, cmdStr, err := EvalBracketArgs(origPk.Args[0])
	if err != nil {
		return nil, err
	}
	metaCmd, metaSubCmd, commandArgs := parseMetaCmd(cmdStr)
	rtnPk := scpacket.MakeFeCommandPacket()
	rtnPk.MetaCmd = metaCmd
	rtnPk.MetaSubCmd = metaSubCmd
	rtnPk.Kwargs = make(map[string]string)
	rtnPk.UIContext = origPk.UIContext
	rtnPk.RawStr = origPk.RawStr
	for key, val := range origPk.Kwargs {
		rtnPk.Kwargs[key] = val
	}
	for key, val := range bracketArgs {
		rtnPk.Kwargs[key] = val
	}
	if onlyRawArgs(metaCmd, metaSubCmd) {
		// don't evaluate arguments for /run or /comment
		rtnPk.Args = []string{commandArgs}
		return rtnPk, nil
	}
	commandReader := strings.NewReader(commandArgs)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	var words []*syntax.Word
	err = parser.Words(commandReader, func(w *syntax.Word) bool {
		words = append(words, w)
		return true
	})
	if err != nil {
		return nil, fmt.Errorf("parsing metacmd, position %v", err)
	}
	envMap := make(map[string]string) // later we can add vars like session, screen, remote, and user
	cfg := shexec.GetParserConfig(envMap)
	// process arguments
	for idx, w := range words {
		literalVal, err := expand.Literal(cfg, w)
		if err != nil {
			return nil, fmt.Errorf("error evaluating metacmd argument %d [%s]: %v", idx+1, getSourceStr(commandArgs, w), err)
		}
		if isQuoted(commandArgs, w) || onlyPositionalArgs(metaCmd, metaSubCmd) {
			rtnPk.Args = append(rtnPk.Args, literalVal)
			continue
		}
		eqIdx := strings.Index(literalVal, "=")
		if eqIdx != -1 && eqIdx != 0 {
			varName := literalVal[:eqIdx]
			varVal := literalVal[eqIdx+1:]
			rtnPk.Kwargs[varName] = varVal
			continue
		}
		rtnPk.Args = append(rtnPk.Args, unescapeBackSlashes(literalVal))
	}
	if resolveBool(rtnPk.Kwargs["dump"], false) {
		DumpPacket(rtnPk)
	}
	return rtnPk, nil
}
