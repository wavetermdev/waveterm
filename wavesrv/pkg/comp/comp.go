// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// scripthaus completion
package comp

import (
	"bytes"
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/waveshell/pkg/simpleexpand"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/shparse"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"mvdan.cc/sh/v3/syntax"
)

const MaxCompQuoteLen = 5000

const (
	// local to simplecomp
	CGTypeCommand  = "command"
	CGTypeFile     = "file"
	CGTypeDir      = "directory"
	CGTypeVariable = "variable"

	// implemented in cmdrunner
	CGTypeMeta        = "metacmd"
	CGTypeCommandMeta = "command+meta"

	CGTypeRemote         = "remote"
	CGTypeRemoteInstance = "remoteinstance"
	CGTypeGlobalCmd      = "globalcmd"
)

const (
	QuoteTypeLiteral = ""
	QuoteTypeDQ      = "\""
	QuoteTypeANSI    = "$'"
	QuoteTypeSQ      = "'"
)

type CompContext struct {
	RemotePtr  *sstore.RemotePtrType
	Cwd        string
	ForDisplay bool
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

// directories will have a trailing "/"
type CompEntry struct {
	Word      string
	IsMetaCmd bool
}

type CompReturn struct {
	CompType string
	Entries  []CompEntry
	HasMore  bool
}

var noEscChars []bool
var specialEsc []string

func init() {
	noEscChars = make([]bool, 256)
	for ch := 0; ch < 256; ch++ {
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			ch == '-' || ch == '.' || ch == '/' || ch == ':' || ch == '=' {
			noEscChars[byte(ch)] = true
		}
	}
	specialEsc = make([]string, 256)
	specialEsc[0x7] = "\\a"
	specialEsc[0x8] = "\\b"
	specialEsc[0x9] = "\\t"
	specialEsc[0xa] = "\\n"
	specialEsc[0xb] = "\\v"
	specialEsc[0xc] = "\\f"
	specialEsc[0xd] = "\\r"
	specialEsc[0x1b] = "\\E"
}

func compQuoteDQString(s string, close bool) string {
	var buf bytes.Buffer
	buf.WriteByte('"')
	for _, ch := range s {
		if ch == '"' || ch == '\\' || ch == '$' || ch == '`' {
			buf.WriteByte('\\')
			buf.WriteRune(ch)
			continue
		}
		buf.WriteRune(ch)
	}
	if close {
		buf.WriteByte('"')
	}
	return buf.String()
}

func hasGlob(s string) bool {
	var lastExtGlob bool
	for _, ch := range s {
		if ch == '*' || ch == '?' || ch == '[' || ch == '{' {
			return true
		}
		if ch == '+' || ch == '@' || ch == '!' {
			lastExtGlob = true
			continue
		}
		if lastExtGlob && ch == '(' {
			return true
		}
		lastExtGlob = false
	}
	return false
}

func writeUtf8Literal(buf *bytes.Buffer, ch rune) {
	var runeArr [utf8.UTFMax]byte
	buf.WriteString("$'")
	barr := runeArr[:]
	byteLen := utf8.EncodeRune(barr, ch)
	for i := 0; i < byteLen; i++ {
		buf.WriteString("\\x")
		buf.WriteByte(utilfn.HexDigits[barr[i]/16])
		buf.WriteByte(utilfn.HexDigits[barr[i]%16])
	}
	buf.WriteByte('\'')
}

func compQuoteLiteralString(s string) string {
	var buf bytes.Buffer
	for idx, ch := range s {
		if ch == 0 {
			break
		}
		if idx == 0 && ch == '~' {
			buf.WriteRune(ch)
			continue
		}
		if ch > unicode.MaxASCII {
			writeUtf8Literal(&buf, ch)
			continue
		}
		var bch = byte(ch)
		if noEscChars[bch] {
			buf.WriteRune(ch)
			continue
		}
		if specialEsc[bch] != "" {
			buf.WriteString(specialEsc[bch])
			continue
		}
		if !unicode.IsPrint(ch) {
			writeUtf8Literal(&buf, ch)
			continue
		}
		buf.WriteByte('\\')
		buf.WriteByte(bch)
	}
	return buf.String()
}

func compQuoteSQString(s string) string {
	var buf bytes.Buffer
	for _, ch := range s {
		if ch == 0 {
			break
		}
		if ch == '\'' {
			buf.WriteString("'\\''")
			continue
		}
		var bch byte
		if ch <= unicode.MaxASCII {
			bch = byte(ch)
		}
		if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
			buf.WriteByte('\'')
			if bch != 0 && specialEsc[bch] != "" {
				buf.WriteString(specialEsc[bch])
			} else {
				writeUtf8Literal(&buf, ch)
			}
			buf.WriteByte('\'')
			continue
		}
		buf.WriteByte(bch)
	}
	return buf.String()
}

func compQuoteString(s string, quoteType string, close bool) string {
	if quoteType != QuoteTypeANSI && quoteType != QuoteTypeLiteral {
		for _, ch := range s {
			if ch > unicode.MaxASCII || !unicode.IsPrint(ch) || ch == '!' {
				quoteType = QuoteTypeANSI
				break
			}
			if ch == '\'' {
				if quoteType == QuoteTypeSQ {
					quoteType = QuoteTypeANSI
					break
				}
			}
		}
	}
	if quoteType == QuoteTypeANSI {
		rtn := strconv.QuoteToASCII(s)
		rtn = "$'" + strings.ReplaceAll(rtn[1:len(rtn)-1], "'", "\\'")
		if close {
			rtn = rtn + "'"
		}
		return rtn
	}
	if quoteType == QuoteTypeLiteral {
		return compQuoteLiteralString(s)
	}
	if quoteType == QuoteTypeSQ {
		rtn := utilfn.ShellQuote(s, false, MaxCompQuoteLen)
		if len(rtn) > 0 && rtn[0] != '\'' {
			rtn = "'" + rtn + "'"
		}
		if !close {
			rtn = rtn[0 : len(rtn)-1]
		}
		return rtn
	}
	// QuoteTypeDQ
	return compQuoteDQString(s, close)
}

func (p *CompPoint) wordAsStr(w ParsedWord) string {
	if w.Word != nil {
		return p.StmtStr[w.Word.Pos().Offset():w.Word.End().Offset()]
	}
	return w.PartialWord
}

func (p *CompPoint) simpleExpandWord(w ParsedWord) (string, simpleexpand.SimpleExpandInfo) {
	ectx := simpleexpand.SimpleExpandContext{}
	if w.Word != nil {
		return simpleexpand.SimpleExpandWord(ectx, w.Word, p.StmtStr)
	}
	return simpleexpand.SimpleExpandPartialWord(ectx, w.PartialWord, false)
}

func getQuoteTypePref(str string) string {
	if strings.HasPrefix(str, QuoteTypeANSI) {
		return QuoteTypeANSI
	}
	if strings.HasPrefix(str, QuoteTypeDQ) {
		return QuoteTypeDQ
	}
	if strings.HasPrefix(str, QuoteTypeSQ) {
		return QuoteTypeSQ
	}
	return QuoteTypeLiteral
}

func (p *CompPoint) getCompPrefix() (string, simpleexpand.SimpleExpandInfo) {
	if p.CompWordPos == 0 {
		return "", simpleexpand.SimpleExpandInfo{}
	}
	pword := p.Words[p.CompWord]
	wordStr := p.wordAsStr(pword)
	if p.CompWordPos == len(wordStr) {
		return p.simpleExpandWord(pword)
	}
	// TODO we can do better, if p.Word is not nil, we can look for which WordPart
	//      our pos is in.  we can then do a normal word expand on the previous parts
	//      and a partial on just the current part.  this is an uncommon case though
	//      and has very little upside (even bash does not expand multipart words correctly)
	partialWordStr := wordStr[:p.CompWordPos]
	return simpleexpand.SimpleExpandPartialWord(simpleexpand.SimpleExpandContext{}, partialWordStr, false)
}

func (p *CompPoint) extendWord(newWord string, newWordComplete bool) utilfn.StrWithPos {
	pword := p.Words[p.CompWord]
	wordStr := p.wordAsStr(pword)
	quotePref := getQuoteTypePref(wordStr)
	needsClose := newWordComplete && (len(wordStr) == p.CompWordPos)
	wordSuffix := wordStr[p.CompWordPos:]
	newQuotedStr := compQuoteString(newWord, quotePref, needsClose)
	if needsClose && wordSuffix == "" && !strings.HasSuffix(newWord, "/") {
		newQuotedStr = newQuotedStr + " "
	}
	newPos := len(newQuotedStr)
	return utilfn.StrWithPos{Str: newQuotedStr + wordSuffix, Pos: newPos}
}

// returns (extension, complete)
func computeCompExtension(compPrefix string, crtn *CompReturn) (string, bool) {
	if crtn == nil || crtn.HasMore {
		return "", false
	}
	compStrs := crtn.GetCompStrs()
	lcp := utilfn.LongestPrefix(compPrefix, compStrs)
	if lcp == compPrefix || len(lcp) < len(compPrefix) || !strings.HasPrefix(lcp, compPrefix) {
		return "", false
	}
	return lcp[len(compPrefix):], (utilfn.ContainsStr(compStrs, lcp) && !utilfn.IsPrefix(compStrs, lcp))
}

func (p *CompPoint) FullyExtend(crtn *CompReturn) utilfn.StrWithPos {
	if crtn == nil || crtn.HasMore {
		return utilfn.StrWithPos{Str: p.getOrigStr(), Pos: p.getOrigPos()}
	}
	compStrs := crtn.GetCompStrs()
	compPrefix, _ := p.getCompPrefix()
	lcp := utilfn.LongestPrefix(compPrefix, compStrs)
	if lcp == compPrefix || len(lcp) < len(compPrefix) || !strings.HasPrefix(lcp, compPrefix) {
		return utilfn.StrWithPos{Str: p.getOrigStr(), Pos: p.getOrigPos()}
	}
	newStr := p.extendWord(lcp, utilfn.ContainsStr(compStrs, lcp))
	var buf bytes.Buffer
	buf.WriteString(p.Prefix)
	for idx, w := range p.Words {
		if idx == p.CompWord {
			buf.WriteString(w.Prefix)
			buf.WriteString(newStr.Str)
		} else {
			buf.WriteString(w.Prefix)
			buf.WriteString(p.wordAsStr(w))
		}
	}
	buf.WriteString(p.Suffix)
	compWord := p.Words[p.CompWord]
	newPos := len(p.Prefix) + compWord.Offset + len(compWord.Prefix) + newStr.Pos
	return utilfn.StrWithPos{Str: buf.String(), Pos: newPos}
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
			fmt.Printf("%s\n", utilfn.StrWithPos{Str: p.wordAsStr(w), Pos: p.CompWordPos})
		} else {
			fmt.Printf("%s\n", p.wordAsStr(w))
		}
	}
	if p.Suffix != "" {
		fmt.Printf("suffix: %s\n", p.Suffix)
	}
	fmt.Printf("\n")
}

var SimpleCompGenFns map[string]SimpleCompGenFnType

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

func ParseCompPoint(cmdStr utilfn.StrWithPos) *CompPoint {
	fullCmdStr := cmdStr.Str
	pos := cmdStr.Pos
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
	return &rtnPoint
}

func splitCompWord(p *CompPoint) {
	w := p.Words[p.CompWord]
	prefixPos := p.CompWordPos + len(w.Prefix)

	w1 := ParsedWord{Offset: w.Offset, Prefix: w.Prefix[:prefixPos]}
	w2 := ParsedWord{Offset: w.Offset + prefixPos, Prefix: w.Prefix[prefixPos:], Word: w.Word, PartialWord: w.PartialWord}
	// p.CompWord = p.CompWord // the same (w1)
	p.CompWordPos = 0 // will be at 0 since w1 has a word length of 0
	var newWords []ParsedWord
	if p.CompWord > 0 {
		newWords = append(newWords, p.Words[0:p.CompWord]...)
	}
	newWords = append(newWords, w1, w2)
	newWords = append(newWords, p.Words[p.CompWord+1:]...)
	p.Words = newWords
}

func getCompType(compPos shparse.CompletionPos) string {
	switch compPos.CompType {
	case shparse.CompTypeCommandMeta:
		return CGTypeCommandMeta

	case shparse.CompTypeCommand:
		return CGTypeCommandMeta

	case shparse.CompTypeVar:
		return CGTypeVariable

	case shparse.CompTypeArg, shparse.CompTypeBasic, shparse.CompTypeAssignment:
		return CGTypeFile

	default:
		return CGTypeFile
	}
}

func fixupVarPrefix(varPrefix string) string {
	if strings.HasPrefix(varPrefix, "${") {
		varPrefix = varPrefix[2:]
		if strings.HasSuffix(varPrefix, "}") {
			varPrefix = varPrefix[:len(varPrefix)-1]
		}
	} else if strings.HasPrefix(varPrefix, "$") {
		varPrefix = varPrefix[1:]
	}
	return varPrefix
}

func DoCompGen(ctx context.Context, cmdStr utilfn.StrWithPos, compCtx CompContext) (*CompReturn, *utilfn.StrWithPos, error) {
	words := shparse.Tokenize(cmdStr.Str)
	cmds := shparse.ParseCommands(words)
	compPos := shparse.FindCompletionPos(cmds, cmdStr.Pos)
	if compPos.CompType == shparse.CompTypeInvalid {
		return nil, nil, nil
	}
	var compPrefix string
	if compPos.CompWord != nil {
		var info shparse.ExpandInfo
		compPrefix, info = shparse.SimpleExpandPrefix(shparse.ExpandContext{}, compPos.CompWord, compPos.CompWordOffset)
		if info.HasGlob || info.HasExtGlob || info.HasHistory || info.HasSpecial {
			return nil, nil, nil
		}
		if compPos.CompType != shparse.CompTypeVar && info.HasVar {
			return nil, nil, nil
		}
		if compPos.CompType == shparse.CompTypeVar {
			compPrefix = fixupVarPrefix(compPrefix)
		}
	}
	scType := getCompType(compPos)
	crtn, err := DoSimpleComp(ctx, scType, compPrefix, compCtx, nil)
	if err != nil {
		return nil, nil, err
	}
	if compCtx.ForDisplay {
		return crtn, nil, nil
	}
	extensionStr, extensionComplete := computeCompExtension(compPrefix, crtn)
	if extensionStr == "" {
		return crtn, nil, nil
	}
	rtnSP := compPos.Extend(cmdStr, extensionStr, extensionComplete)
	return crtn, &rtnSP, nil
}

func DoCompGenOld(ctx context.Context, sp utilfn.StrWithPos, compCtx CompContext) (*CompReturn, *utilfn.StrWithPos, error) {
	compPoint := ParseCompPoint(sp)
	compType := CGTypeFile
	if compPoint.CompWord == 0 {
		compType = CGTypeCommandMeta
	}
	// TODO lookup special types
	compPrefix, info := compPoint.getCompPrefix()
	if info.HasVar || info.HasGlob || info.HasExtGlob || info.HasHistory || info.HasSpecial {
		return nil, nil, nil
	}
	crtn, err := DoSimpleComp(ctx, compType, compPrefix, compCtx, nil)
	if err != nil {
		return nil, nil, err
	}
	if compCtx.ForDisplay {
		return crtn, nil, nil
	}
	rtnSP := compPoint.FullyExtend(crtn)
	return crtn, &rtnSP, nil
}

func SortCompReturnEntries(c *CompReturn) {
	sort.Slice(c.Entries, func(i int, j int) bool {
		e1 := c.Entries[i]
		e2 := c.Entries[j]
		if e1.Word < e2.Word {
			return true
		}
		if e1.Word == e2.Word && e1.IsMetaCmd && !e2.IsMetaCmd {
			return true
		}
		return false
	})
}

func CombineCompReturn(compType string, c1 *CompReturn, c2 *CompReturn) *CompReturn {
	if c1 == nil {
		return c2
	}
	if c2 == nil {
		return c1
	}
	var rtn CompReturn
	rtn.CompType = compType
	rtn.HasMore = c1.HasMore || c2.HasMore
	rtn.Entries = append([]CompEntry{}, c1.Entries...)
	rtn.Entries = append(rtn.Entries, c2.Entries...)
	SortCompReturnEntries(&rtn)
	return &rtn
}

func (c *CompReturn) GetCompStrs() []string {
	rtn := make([]string, len(c.Entries))
	for idx, entry := range c.Entries {
		rtn[idx] = entry.Word
	}
	return rtn
}

func (c *CompReturn) GetCompDisplayStrs() []string {
	rtn := make([]string, len(c.Entries))
	for idx, entry := range c.Entries {
		if entry.IsMetaCmd {
			rtn[idx] = "^" + entry.Word
		} else {
			rtn[idx] = entry.Word
		}
	}
	return rtn
}

func (p CompPoint) getOrigPos() int {
	pword := p.Words[p.CompWord]
	return len(p.Prefix) + pword.Offset + len(pword.Prefix) + p.CompWordPos
}

func (p CompPoint) getOrigStr() string {
	return p.Prefix + p.StmtStr + p.Suffix
}
