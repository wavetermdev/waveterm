package cmdrunner

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/alessio/shellescape"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

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

var ValidMetaCmdRe = regexp.MustCompile("^/([a-z][a-z0-9_-]*)(?::([a-z][a-z0-9_-]*))?$")

type BareMetaCmdDecl struct {
	CmdStr  string
	MetaCmd string
}

var BareMetaCmds = []BareMetaCmdDecl{
	BareMetaCmdDecl{"cd", "cd"},
	BareMetaCmdDecl{"cr", "cr"},
	BareMetaCmdDecl{"setenv", "setenv"},
	BareMetaCmdDecl{"export", "setenv"},
	BareMetaCmdDecl{"unset", "unset"},
	BareMetaCmdDecl{"clear", "clear"},
	BareMetaCmdDecl{".", "source"},
	BareMetaCmdDecl{"source", "source"},
	BareMetaCmdDecl{"reset", "reset"},
}

func SubMetaCmd(cmd string) string {
	switch cmd {
	case "s":
		return "screen"
	case "w":
		return "window"
	case "r":
		return "run"
	case "c":
		return "comment"
	case "e":
		return "eval"
	case "export":
		return "setenv"
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
	return (metaCmd == "setenv" || metaCmd == "unset") && metaSubCmd == ""
}

func onlyRawArgs(metaCmd string, metaSubCmd string) bool {
	return metaCmd == "run" || metaCmd == "comment"
}

// minimum maxlen=6
func ForceQuote(val string, maxLen int) string {
	if maxLen < 6 {
		maxLen = 6
	}
	rtn := shellescape.Quote(val)
	if strings.HasPrefix(rtn, "\"") || strings.HasPrefix(rtn, "'") {
		if len(rtn) > maxLen {
			return rtn[0:maxLen-4] + "..." + rtn[0:1]
		}
		return rtn
	}
	if len(rtn) > maxLen-2 {
		return "\"" + rtn[0:maxLen-5] + "...\""
	}
	return "\"" + rtn + "\""
}

func setBracketArgs(argMap map[string]string, bracketStr string) error {
	bracketStr = strings.TrimSpace(bracketStr)
	if bracketStr == "" {
		return nil
	}
	strReader := strings.NewReader(bracketStr)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	var wordErr error
	err := parser.Words(strReader, func(w *syntax.Word) bool {
		litStr, err := shexec.QuotedLitToStr(w)
		if err != nil {
			wordErr = fmt.Errorf("invalid expr in bracket args: %v", err)
			return false
		}
		eqIdx := strings.Index(litStr, "=")
		var varName, varVal string
		if eqIdx == -1 {
			varName = litStr
		} else {
			varName = litStr[0:eqIdx]
			varVal = litStr[eqIdx+1:]
		}
		if !shexec.IsValidBashIdentifier(varName) {
			wordErr = fmt.Errorf("invalid identifier %s in bracket args", ForceQuote(varName, 20))
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

func EvalMetaCommand(ctx context.Context, origPk *scpacket.FeCommandPacketType) (*scpacket.FeCommandPacketType, error) {
	if len(origPk.Args) == 0 {
		return nil, fmt.Errorf("empty command (no fields)")
	}
	if strings.TrimSpace(origPk.Args[0]) == "" {
		return nil, fmt.Errorf("empty command")
	}
	metaCmd, metaSubCmd, commandArgs := parseMetaCmd(origPk.Args[0])
	rtnPk := scpacket.MakeFeCommandPacket()
	rtnPk.MetaCmd = metaCmd
	rtnPk.MetaSubCmd = metaSubCmd
	rtnPk.Kwargs = make(map[string]string)
	rtnPk.UIContext = origPk.UIContext
	rtnPk.RawStr = origPk.RawStr
	for key, val := range origPk.Kwargs {
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
	err := parser.Words(commandReader, func(w *syntax.Word) bool {
		words = append(words, w)
		return true
	})
	if err != nil {
		return nil, fmt.Errorf("parsing metacmd, position %v", err)
	}
	envMap := make(map[string]string) // later we can add vars like session, window, screen, remote, and user
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
		rtnPk.Args = append(rtnPk.Args, literalVal)
	}
	if resolveBool(rtnPk.Kwargs["dump"], false) {
		DumpPacket(rtnPk)
	}
	return rtnPk, nil
}

func parseAliasStmt(stmt *syntax.Stmt) (string, string, error) {
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
	val, err := shexec.QuotedLitToStr(secondWord)
	if err != nil {
		return "", "", err
	}
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
		aliasName, aliasVal, err := parseAliasStmt(stmt)
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
			fmt.Printf("stmt-err: %v\n", err)
			continue
		}
		if funcName != "" {
			rtn[funcName] = funcVal
		}
	}
	return rtn, nil
}
