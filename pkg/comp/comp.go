// scripthaus completion
package comp

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"mvdan.cc/sh/v3/syntax"
)

const (
	SimpleCompGenTypeFile           = "file"
	SimpleCompGenTypeDir            = "dir"
	SimpleCompGenTypeCommand        = "command"
	SimpleCompGenTypeRemote         = "remote"
	SimpleCompGenTypeRemoteInstance = "remoteinstance"
	SimpleCompGenTypeMetaCmd        = "metacmd"
	SimpleCompGenTypeGlobalCmd      = "globalcmd"
	SimpleCompGenTypeVariable       = "variable"
)

type CompContext struct {
	RemotePtr  sstore.RemotePtrType
	State      *packet.ShellState
	ForDisplay bool
}

type SimpleCompGenFnType = func(ctx context.Context, point SimpleCompPoint, compCtx CompContext, args []interface{}) (*CompReturn, error)

type SimpleCompPoint struct {
	Word string
	Pos  int
}

type ParsedWord struct {
	Offset      int
	Word        *syntax.Word
	PartialWord string
	Prefix      string
}

type CompPoint struct {
	StmtStr     string
	Words       []ParsedWord
	CompWord    int
	CompWordPos int
	Prefix      string
	Suffix      string
}

func (p *CompPoint) wordAsStr(w ParsedWord) string {
	if w.Word != nil {
		return p.StmtStr[w.Word.Pos().Offset():w.Word.End().Offset()]
	}
	return w.PartialWord
}

func (p *CompPoint) simpleExpandWord(w ParsedWord) string {
	ectx := shexec.SimpleExpandContext{}
	if w.Word != nil {
		return SimpleExpandWord(ectx, w.Word, p.StmtStr)
	}
	return SimpleExpandPartialWord(ectx, p.PartialWord, false)
}

func (p *CompPoint) compPrefix() string {
	pword := p.Words[p.CompWord]
	if p.CompWordPos == 0 {
		return ""
	}
	wordStr := p.wordAsStr(pword)
	if p.CompWordPos == len(wordStr) {
		return p.simpleExpandWord(pword)
	}
	// TODO we can do better, if p.Word is not nil, we can look for which WordPart
	//      our pos is in.  we can then do a normal word expand on the previous parts
	//      and a partial on just the current part.  this is an uncommon case though
	//      and has very little upside (even bash does not expand multipart words correctly)
	partialWordStr := wordStr[:p.CompWordPos]
	return SimpleExpandPartialWord(shexec.SimpleExpandContext{}, partialWordStr, false)
}

func (p *CompPoint) dump() {
	if p.Prefix != "" {
		fmt.Printf("prefix: %s\n", p.Prefix)
	}
	fmt.Printf("cpos: %d %d\n", p.CompWord, p.CompWordPos)
	for idx, w := range p.Words {
		fmt.Printf("w[%d]: ", idx)
		if w.Prefix != "" {
			fmt.Printf("{%s}", w.Prefix)
		}
		if idx == p.CompWord {
			fmt.Printf("%s\n", strWithCursor(p.wordAsStr(w), p.CompWordPos))
		} else {
			fmt.Printf("%s\n", p.wordAsStr(w))
		}
	}
	if p.Suffix != "" {
		fmt.Printf("suffix: %s\n", p.Suffix)
	}
	fmt.Printf("\n")
}

// directories will have a trailing "/"
type CompEntry struct {
	Word      string
	IsMetaCmd bool
}

type CompReturn struct {
	Entries []CompEntry
	HasMore bool
}

var SimpleCompGenFns map[string]SimpleCompGenFnType

func strWithCursor(str string, pos int) string {
	if pos < 0 {
		return "[*]_" + str
	}
	if pos >= len(str) {
		if pos > len(str) {
			return str + "_[*]"
		}
		return str + "[*]"
	} else {
		return str[:pos] + "[*]" + str[pos:]
	}
}

func isWhitespace(str string) bool {
	return strings.TrimSpace(str) == ""
}

func splitInitialWhitespace(str string) (string, string) {
	for pos, ch := range str { // rune iteration :/
		if !unicode.IsSpace(ch) {
			return str[:pos], str[pos:]
		}
	}
	return str, ""
}

func ParseCompPoint(fullCmdStr string, pos int) (*CompPoint, error) {
	// fmt.Printf("---\n")
	// fmt.Printf("cmd: %s\n", strWithCursor(fullCmdStr, pos))

	// first, find the stmt that the pos appears in
	cmdReader := strings.NewReader(fullCmdStr)
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	var foundStmt *syntax.Stmt
	var lastStmt *syntax.Stmt
	var restStartPos int
	parser.Stmts(cmdReader, func(stmt *syntax.Stmt) bool { // ignore parse errors (since stmtStr will be the unparsed part)
		restStartPos = int(stmt.End().Offset())
		lastStmt = stmt
		if uint(pos) >= stmt.Pos().Offset() && uint(pos) < stmt.End().Offset() {
			foundStmt = stmt
			return false
		}
		// fmt.Printf("stmt: [[%s]] %d:%d (%d)\n", fullCmdStr[stmt.Pos().Offset():stmt.End().Offset()], stmt.Pos().Offset(), stmt.End().Offset(), stmt.Semicolon.Offset())
		return true
	})
	restStr := fullCmdStr[restStartPos:]
	if foundStmt == nil && lastStmt != nil && isWhitespace(restStr) && lastStmt.Semicolon.Offset() == 0 {
		foundStmt = lastStmt
	}
	var rtnPoint CompPoint
	var stmtStr string
	var stmtPos int
	if foundStmt != nil {
		stmtPos = pos - int(foundStmt.Pos().Offset())
		rtnPoint.Prefix = fullCmdStr[:foundStmt.Pos().Offset()]
		if isWhitespace(fullCmdStr[foundStmt.End().Offset():]) {
			stmtStr = fullCmdStr[foundStmt.Pos().Offset():]
			rtnPoint.Suffix = ""
		} else {
			stmtStr = fullCmdStr[foundStmt.Pos().Offset():foundStmt.End().Offset()]
			rtnPoint.Suffix = fullCmdStr[foundStmt.End().Offset():]
		}
	} else {
		stmtStr = restStr
		stmtPos = pos - restStartPos
		rtnPoint.Prefix = fullCmdStr[:restStartPos]
		rtnPoint.Suffix = fullCmdStr[restStartPos+len(stmtStr):]
	}
	if stmtPos > len(stmtStr) {
		// this should not happen and will cause a jump in completed strings
		stmtPos = len(stmtStr)
	}
	// fmt.Printf("found: ((%s))%s((%s))\n", rtnPoint.Prefix, strWithCursor(stmtStr, stmtPos), rtnPoint.Suffix)

	// now, find the word that the pos appears in within the stmt above
	rtnPoint.StmtStr = stmtStr
	stmtReader := strings.NewReader(stmtStr)
	lastWordPos := 0
	parser.Words(stmtReader, func(w *syntax.Word) bool {
		var pword ParsedWord
		pword.Offset = lastWordPos
		if int(w.Pos().Offset()) > lastWordPos {
			pword.Prefix = stmtStr[lastWordPos:w.Pos().Offset()]
		}
		pword.Word = w
		rtnPoint.Words = append(rtnPoint.Words, pword)
		lastWordPos = int(w.End().Offset())
		return true
	})
	if lastWordPos < len(stmtStr) {
		pword := ParsedWord{Offset: lastWordPos}
		pword.Prefix, pword.PartialWord = splitInitialWhitespace(stmtStr[lastWordPos:])
		rtnPoint.Words = append(rtnPoint.Words, pword)
	}
	if len(rtnPoint.Words) == 0 {
		rtnPoint.Words = append(rtnPoint.Words, ParsedWord{})
	}
	for idx, w := range rtnPoint.Words {
		wordLen := len(rtnPoint.wordAsStr(w))
		if stmtPos > w.Offset && stmtPos <= w.Offset+len(w.Prefix)+wordLen {
			rtnPoint.CompWord = idx
			rtnPoint.CompWordPos = stmtPos - w.Offset - len(w.Prefix)
			if rtnPoint.CompWordPos < 0 {
				splitCompWord(&rtnPoint)
			}
		}
	}
	rtnPoint.dump()
	return &rtnPoint, nil
}

func splitCompWord(p *CompPoint) {
	w := p.Words[p.CompWord]
	prefixPos := p.CompWordPos + len(w.Prefix)

	w1 := ParsedWord{Offset: w.Offset, Prefix: w.Prefix[:prefixPos]}
	w2 := ParsedWord{Offset: w.Offset + prefixPos, Prefix: w.Prefix[prefixPos:], Word: w.Word, PartialWord: w.PartialWord}
	p.CompWord = p.CompWord // the same (w1)
	p.CompWordPos = 0       // will be at 0 since w1 has a word length of 0
	var newWords []ParsedWord
	if p.CompWord > 0 {
		newWords = append(newWords, p.Words[0:p.CompWord]...)
	}
	newWords = append(newWords, w1, w2)
	newWords = append(newWords, p.Words[p.CompWord+1:]...)
	p.Words = newWords
}

func DoCompGen(ctx context.Context, point CompPoint, rptr sstore.RemotePtrType, state *packet.ShellState) (*CompReturn, error) {
	return nil, nil
}
