package cmdrunner

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

type parseEnviron struct {
	Env map[string]string
}

func (e *parseEnviron) Get(name string) expand.Variable {
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

func (e *parseEnviron) Each(fn func(name string, vr expand.Variable) bool) {
	for key, _ := range e.Env {
		rtn := fn(key, e.Get(key))
		if !rtn {
			break
		}
	}
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

func doCmdSubst(commandStr string, w io.Writer, word *syntax.CmdSubst) error {
	return nil
}

func doProcSubst(w *syntax.ProcSubst) (string, error) {
	return "", nil
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

var ValidMetaCmdRe = regexp.MustCompile("^/([a-z][a-z0-9_-]*)(:[a-z][a-z0-9_-]*)?$")

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

func EvalMetaCommand(ctx context.Context, origPk *scpacket.FeCommandPacketType) (*scpacket.FeCommandPacketType, error) {
	if len(origPk.Args) == 0 {
		return nil, fmt.Errorf("empty command (no fields)")
	}
	metaCmd, metaSubCmd, commandArgs := parseMetaCmd(origPk.Args[0])
	rtnPk := scpacket.MakeFeCommandPacket()
	rtnPk.MetaCmd = metaCmd
	rtnPk.MetaSubCmd = metaSubCmd
	rtnPk.Kwargs = make(map[string]string)
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
	cfg := &expand.Config{
		Env:       &parseEnviron{Env: envMap},
		GlobStar:  false,
		NullGlob:  false,
		NoUnset:   false,
		CmdSubst:  func(w io.Writer, word *syntax.CmdSubst) error { return doCmdSubst(commandArgs, w, word) },
		ProcSubst: doProcSubst,
		ReadDir:   nil,
	}
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
	return rtnPk, nil
}
