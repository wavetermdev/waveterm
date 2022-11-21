package shparse

import (
	"bytes"
	"fmt"

	"github.com/scripthaus-dev/sh2-server/pkg/utilfn"
)

//
// cmds := cmd (sep cmd)*
// sep := ';' | '&' | '&&' | '||' | '|' | '\n'
// cmd := simple-cmd | compound-command redirect-list?
// compound-command := brace-group | subshell | for-clause | case-clause | if-clause | while-clause | until-clause
// brace-group := '{' cmds '}'
// subshell := '(' cmds ')'
// simple-command := cmd-prefix cmd-word (io-redirect)*
// cmd-prefix := (io-redirect | assignment)*
// cmd-suffix := (io-redirect | word)*
// cmd-name := word
// cmd-word := word
// io-redirect := (io-number? io-file) | (io-number? io-here)
// io-file := ('<' | '<&' | '>' | '>&' | '>>' | '>|' ) filename
// io-here := ('<<' | '<<-') here_end
// here-end := word
// if-clause := 'if' compound-list 'then' compound-list else-part 'fi'
// else-part :=   'elif' compound-list 'then' compound-list
//              | 'elif' compount-list 'then' compound-list else-part
//              | 'else' compound-list
// compound-list := linebreak term sep?
//
//
//
// A correctly-formed brace expansion must contain unquoted opening and closing braces, and at least one unquoted comma or a valid sequence expression
// Any incorrectly formed brace expansion is left unchanged.
//
// ambiguity between $((...)) and $((ls); ls)
// ambiguity between foo=([0]=hell) and foo=([abc)
// tokenization https://pubs.opengroup.org/onlinepubs/7908799/xcu/chap2.html#tag_001_003

// can-extend: WordTypeLit, WordTypeSimpleVar, WordTypeVarBrace, WordTypeDQ, WordTypeDDQ, WordTypeSQ, WordTypeDSQ
const (
	WordTypeRaw       = "raw"
	WordTypeLit       = "lit"  // (can-extend)
	WordTypeOp        = "op"   // single: & ; | ( ) < > \n  multi(2): && || ;; << >> <& >& <> >| ((  multi(3): <<-    ('((' requires special processing)
	WordTypeKey       = "key"  // if then else elif fi do done case esac while until for in { } ! (( [[
	WordTypeGroup     = "grp"  // contains other words e.g. "hello"foo'bar'$x (has-subs)
	WordTypeSimpleVar = "svar" // simplevar $ (can-extend)

	WordTypeDQ       = "dq"   // "    (quote-context) (can-extend) (has-subs)
	WordTypeDDQ      = "ddq"  // $"   (quote-context) (can-extend) (has-subs)
	WordTypeVarBrace = "varb" // ${   (quote-context) (can-extend) (internals not parsed)
	WordTypeDP       = "dp"   // $(   (quote-context) (has-subs)
	WordTypeBQ       = "bq"   // `    (quote-context) (has-subs)

	WordTypeSQ  = "sq"  // '     (can-extend)
	WordTypeDSQ = "dsq" // $'    (can-extend)
	WordTypeDPP = "dpp" // $((   (internals not parsed)
	WordTypePP  = "pp"  // ((    (internals not parsed)
	WordTypeDB  = "db"  // $[    (internals not parsed)
)

const (
	CmdTypeNone   = "none"   // holds control structures: '(' ')' 'for' 'while' etc.
	CmdTypeSimple = "simple" // holds real commands
)

const (
	CompTypeCommand    = "command"
	CompTypeArg        = "command-arg"
	CompTypeInvalid    = "invalid"
	CompTypeVar        = "var"
	CompTypeAssignment = "assignment"
	CompTypeBasic      = "basic"
)

type WordType struct {
	Type     string
	Offset   int
	QC       QuoteContext
	Raw      []rune
	Complete bool
	Prefix   []rune
	Subs     []*WordType
}

type CmdType struct {
	Type            string
	AssignmentWords []*WordType
	Words           []*WordType
	NoneComplete    bool // set to true when last-word is a "separator"
}

type QuoteContext []string

var wordMetaMap map[string]wordMeta

// same order as https://www.gnu.org/software/bash/manual/html_node/Reserved-Words.html
var bashReservedWords = []string{
	"if", "then", "elif", "else", "fi", "time",
	"for", "in", "until", "while", "do", "done",
	"case", "esac", "coproc", "select", "function",
	"{", "}", "[[", "]]", "!",
}

// special reserved words: "for", "in", "case", "select", "function", "[[", and "]]"

var bashNoneRW = []string{
	"if", "then",
	"elif", "else", "fi", "time",
	"until", "while", "do", "done",
	"esac", "coproc",
	"{", "}", "!",
}

type wordMeta struct {
	Type         string
	EmptyWord    []rune
	PrefixLen    int
	SuffixLen    int
	CanExtend    bool
	QuoteContext bool
}

func makeWordMeta(wtype string, emptyWord string, prefixLen int, suffixLen int, canExtend bool, quoteContext bool) {
	if len(emptyWord) != prefixLen+suffixLen {
		panic(fmt.Sprintf("invalid empty word %s %d %d", emptyWord, prefixLen, suffixLen))
	}
	wordMetaMap[wtype] = wordMeta{wtype, []rune(emptyWord), prefixLen, suffixLen, canExtend, quoteContext}
}

func init() {
	wordMetaMap = make(map[string]wordMeta)
	makeWordMeta(WordTypeRaw, "", 0, 0, false, false)
	makeWordMeta(WordTypeLit, "", 0, 0, true, false)
	makeWordMeta(WordTypeOp, "", 0, 0, false, false)
	makeWordMeta(WordTypeKey, "", 0, 0, false, false)
	makeWordMeta(WordTypeGroup, "", 0, 0, false, false)
	makeWordMeta(WordTypeSimpleVar, "$", 1, 0, true, false)
	makeWordMeta(WordTypeVarBrace, "${}", 2, 1, true, true)
	makeWordMeta(WordTypeDQ, `""`, 1, 1, true, true)
	makeWordMeta(WordTypeDDQ, `$""`, 2, 1, true, true)
	makeWordMeta(WordTypeDP, "$()", 2, 1, false, false)
	makeWordMeta(WordTypeBQ, "``", 1, 1, false, false)
	makeWordMeta(WordTypeSQ, "''", 1, 1, true, false)
	makeWordMeta(WordTypeDSQ, "$''", 2, 1, true, false)
	makeWordMeta(WordTypeDPP, "$(())", 3, 2, false, false)
	makeWordMeta(WordTypePP, "(())", 2, 2, false, false)
	makeWordMeta(WordTypeDB, "$[]", 2, 1, false, false)
}

func MakeEmptyWord(wtype string, qc QuoteContext, offset int) *WordType {
	meta := wordMetaMap[wtype]
	if meta.Type == "" {
		meta = wordMetaMap[WordTypeRaw]
	}
	rtn := &WordType{Type: meta.Type, QC: qc, Offset: offset, Complete: true}
	if len(meta.EmptyWord) > 0 {
		rtn.Raw = append([]rune(nil), meta.EmptyWord...)
	}
	return rtn
}

func (qc QuoteContext) push(q string) QuoteContext {
	rtn := make([]string, 0, len(qc)+1)
	rtn = append(rtn, qc...)
	rtn = append(rtn, q)
	return rtn
}

func (qc QuoteContext) cur() string {
	if len(qc) == 0 {
		return ""
	}
	return qc[len(qc)-1]
}

func (qc QuoteContext) clone() QuoteContext {
	if len(qc) == 0 {
		return nil
	}
	return append([]string(nil), qc...)
}

func makeRepeatStr(ch byte, slen int) string {
	if slen == 0 {
		return ""
	}
	rtn := make([]byte, slen)
	for i := 0; i < slen; i++ {
		rtn[i] = ch
	}
	return string(rtn)
}

func (w *WordType) isBlank() bool {
	return w.Type == WordTypeLit && len(w.Raw) == 0
}

func (w *WordType) contentEndPos() int {
	if !w.Complete {
		return len(w.Raw)
	}
	wmeta := wordMetaMap[w.Type]
	return len(w.Raw) - wmeta.SuffixLen
}

func (w *WordType) contentStartPos() int {
	wmeta := wordMetaMap[w.Type]
	return wmeta.PrefixLen
}

func (w *WordType) uncompletable() bool {
	switch w.Type {
	case WordTypeRaw, WordTypeOp, WordTypeKey, WordTypeDPP, WordTypePP, WordTypeDB, WordTypeBQ, WordTypeDP:
		return true

	default:
		return false
	}
}

func (w *WordType) stringWithPos(pos int) string {
	notCompleteFlag := " "
	if !w.Complete {
		notCompleteFlag = "*"
	}
	str := string(w.Raw)
	if pos != -1 {
		str = utilfn.StrWithPos{Str: str, Pos: pos}.String()
	}
	return fmt.Sprintf("%-4s[%3d]%s %s%q", w.Type, w.Offset, notCompleteFlag, makeRepeatStr('_', len(w.Prefix)), str)
}

func (w *WordType) String() string {
	notCompleteFlag := " "
	if !w.Complete {
		notCompleteFlag = "*"
	}
	return fmt.Sprintf("%-4s[%3d]%s %s%q", w.Type, w.Offset, notCompleteFlag, makeRepeatStr('_', len(w.Prefix)), string(w.Raw))
}

// offset = -1 for don't show
func dumpWords(words []*WordType, indentStr string, offset int) {
	wrotePos := false
	for _, word := range words {
		posInWord := false
		if !wrotePos && offset != -1 && offset <= word.Offset {
			fmt.Printf("%s*   [%3d] [*]\n", indentStr, offset)
			wrotePos = true
		}
		if !wrotePos && offset != -1 && offset < word.Offset+len(word.Raw) {
			fmt.Printf("%s%s\n", indentStr, word.stringWithPos(offset-word.Offset))
			wrotePos = true
			posInWord = true
		} else {
			fmt.Printf("%s%s\n", indentStr, word.String())
		}
		if len(word.Subs) > 0 {
			if posInWord {
				wmeta := wordMetaMap[word.Type]
				dumpWords(word.Subs, indentStr+"  ", offset-word.Offset-wmeta.PrefixLen)
			} else {
				dumpWords(word.Subs, indentStr+"  ", -1)
			}
		}
	}
}

func dumpCommands(cmds []*CmdType, indentStr string, pos int) {
	for _, cmd := range cmds {
		fmt.Printf("%sCMD: %s [%d] pos:%d\n", indentStr, cmd.Type, len(cmd.Words), pos)
		dumpWords(cmd.AssignmentWords, indentStr+" *", pos)
		dumpWords(cmd.Words, indentStr+"  ", pos)
	}
}

func wordsToStr(words []*WordType) string {
	var buf bytes.Buffer
	for _, word := range words {
		if len(word.Prefix) > 0 {
			buf.WriteString(string(word.Prefix))
		}
		buf.WriteString(string(word.Raw))
	}
	return buf.String()
}

// recognizes reserved words in first position
func convertToAnyReservedWord(w *WordType) bool {
	if w == nil || w.Type != WordTypeLit {
		return false
	}
	rawVal := string(w.Raw)
	for _, rw := range bashReservedWords {
		if rawVal == rw {
			w.Type = WordTypeKey
			return true
		}
	}
	return false
}

// recognizes the specific reserved-word given only ('in' and 'do' in 'for', 'case', and 'select' commands)
func convertToReservedWord(w *WordType, reservedWord string) {
	if w == nil || w.Type != WordTypeLit {
		return
	}
	if string(w.Raw) == reservedWord {
		w.Type = WordTypeKey
	}
}

func isNoneReservedWord(w *WordType) bool {
	if w.Type != WordTypeKey {
		return false
	}
	rawVal := string(w.Raw)
	for _, rw := range bashNoneRW {
		if rawVal == rw {
			return true
		}
	}
	return false
}

type parseCmdState struct {
	Input    []*WordType
	InputPos int

	Rtn []*CmdType
	Cur *CmdType
}

func (state *parseCmdState) isEof() bool {
	return state.InputPos >= len(state.Input)
}

func (state *parseCmdState) curWord() *WordType {
	if state.isEof() {
		return nil
	}
	return state.Input[state.InputPos]
}

func (state *parseCmdState) lastCmd() *CmdType {
	if len(state.Rtn) == 0 {
		return nil
	}
	return state.Rtn[len(state.Rtn)-1]
}

func (state *parseCmdState) makeNoneCmd(sep bool) {
	if state.Cur == nil || state.Cur.Type != CmdTypeNone {
		state.Cur = &CmdType{Type: CmdTypeNone}
		state.Rtn = append(state.Rtn, state.Cur)
	}
	state.Cur.Words = append(state.Cur.Words, state.curWord())
	if sep {
		state.Cur.NoneComplete = true
		state.Cur = nil
	}
	state.InputPos++
}

func (state *parseCmdState) handleKeyword(word *WordType) bool {
	if word.Type != WordTypeKey {
		return false
	}
	if isNoneReservedWord(word) {
		state.makeNoneCmd(true)
		return true
	}
	rw := string(word.Raw)
	if rw == "[[" {
		// just ignore everything between [[ and ]]
		for !state.isEof() {
			curWord := state.curWord()
			if curWord.Type == WordTypeLit && string(curWord.Raw) == "]]" {
				convertToReservedWord(curWord, "]]")
				state.makeNoneCmd(false)
				break
			}
			state.makeNoneCmd(false)
		}
		return true
	}
	if rw == "case" {
		// ignore everything between "case" and "esac"
		for !state.isEof() {
			curWord := state.curWord()
			if curWord.Type == WordTypeKey && string(curWord.Raw) == "esac" {
				state.makeNoneCmd(false)
				break
			}
			state.makeNoneCmd(false)
		}
		return true
	}
	if rw == "for" || rw == "select" {
		// ignore until a "do"
		for !state.isEof() {
			curWord := state.curWord()
			if curWord.Type == WordTypeKey && string(curWord.Raw) == "do" {
				state.makeNoneCmd(true)
				break
			}
			state.makeNoneCmd(false)
		}
		return true
	}
	if rw == "in" {
		// the "for" and "case" clauses should skip "in".  so encountering an "in" here is a syntax error.
		// just treat it as a none and allow a new command after.
		state.makeNoneCmd(false)
		return true
	}
	if rw == "function" {
		// ignore until '{'
		for !state.isEof() {
			curWord := state.curWord()
			if curWord.Type == WordTypeKey && string(curWord.Raw) == "{" {
				state.makeNoneCmd(true)
				break
			}
			state.makeNoneCmd(false)
		}
		return true
	}
	state.makeNoneCmd(true)
	return true
}

func isCmdSeparatorOp(word *WordType) bool {
	if word.Type != WordTypeOp {
		return false
	}
	opVal := string(word.Raw)
	return opVal == ";" || opVal == "\n" || opVal == "&" || opVal == "|" || opVal == "|&" || opVal == "&&" || opVal == "||" || opVal == "(" || opVal == ")"
}

func (state *parseCmdState) handleOp(word *WordType) bool {
	opVal := string(word.Raw)
	// sequential separators
	if opVal == ";" || opVal == "\n" {
		state.makeNoneCmd(true)
		return true
	}
	// separator
	if opVal == "&" {
		state.makeNoneCmd(true)
		return true
	}
	// pipelines
	if opVal == "|" || opVal == "|&" {
		state.makeNoneCmd(true)
		return true
	}
	// lists
	if opVal == "&&" || opVal == "||" {
		state.makeNoneCmd(true)
		return true
	}
	// subshell
	if opVal == "(" || opVal == ")" {
		state.makeNoneCmd(true)
		return true
	}
	return false
}

func wordSliceBoundedIdx(words []*WordType, idx int) *WordType {
	if idx >= len(words) {
		return nil
	}
	return words[idx]
}

// note that a newline "op" can appear in the third position of "for" or "case".  the "in" keyword is still converted because of wordNum == 0
func identifyReservedWords(words []*WordType) {
	wordNum := 0
	lastReserved := false
	for idx, word := range words {
		if wordNum == 0 || lastReserved {
			convertToAnyReservedWord(word)
		}
		if word.Type == WordTypeKey {
			rwVal := string(word.Raw)
			switch rwVal {
			case "for":
				lastReserved = false
				third := wordSliceBoundedIdx(words, idx+2)
				convertToReservedWord(third, "in")
				convertToReservedWord(third, "do")

			case "case":
				lastReserved = false
				third := wordSliceBoundedIdx(words, idx+2)
				convertToReservedWord(third, "in")

			case "in":
				lastReserved = false

			default:
				lastReserved = true
			}
			continue
		}
		lastReserved = false
		if isCmdSeparatorOp(word) {
			wordNum = 0
			continue
		}
		wordNum++
	}
}

type CompletionPos struct {
	RawPos      int // the raw position of cursor
	SuperOffset int // adjust all offsets in Cmd and CmdWord by SuperOffset

	CompType string   // see CompType* constants
	Cmd      *CmdType // nil if between commands or a special completion (otherwise will be a SimpleCommand)
	// index into cmd.Words (only set when Cmd is not nil, otherwise we look at CompCommand)
	//   0 means command-word
	//   negative means assignment-words.
	//   can be past the end of Words (means start new word).
	CmdWordPos     int
	CompWord       *WordType // set to the word we are completing (nil if we are starting a new word)
	CompWordOffset int       // offset into compword (only if CmdWord is not nil)

}

func compTypeFromPos(cmdWordPos int) string {
	if cmdWordPos == 0 {
		return CompTypeCommand
	}
	if cmdWordPos < 0 {
		return CompTypeAssignment
	}
	return CompTypeArg
}

func (cmd *CmdType) findCompletionPos_simple(pos int, superOffset int) CompletionPos {
	if cmd.Type != CmdTypeSimple {
		panic("findCompletetionPos_simple only works for CmdTypeSimple")
	}
	rtn := CompletionPos{RawPos: pos, SuperOffset: superOffset, Cmd: cmd}
	for idx, word := range cmd.AssignmentWords {
		startOffset := word.Offset
		endOffset := word.Offset + len(word.Raw)
		if pos <= startOffset {
			// starting a new word at this position (before the current assignment word)
			rtn.CmdWordPos = idx - len(cmd.AssignmentWords)
			rtn.CompType = CompTypeAssignment
			return rtn
		}
		if pos <= endOffset {
			// completing an assignment word
			rtn.CmdWordPos = idx - len(cmd.AssignmentWords)
			rtn.CompWord = word
			rtn.CompWordOffset = pos - word.Offset
			rtn.CompType = CompTypeAssignment
			return rtn
		}
	}
	var foundWord *WordType
	var foundWordIdx int
	for idx, word := range cmd.Words {
		startOffset := word.Offset
		endOffset := word.Offset + len(word.Raw)
		if pos <= startOffset {
			// starting a new word at this position
			rtn.CmdWordPos = idx
			rtn.CompType = compTypeFromPos(idx)
			return rtn
		}
		if pos == endOffset && word.Type == WordTypeOp {
			// operators are special, they can allow a full-word completion at endpos
			continue
		}
		if pos <= endOffset {
			foundWord = word
			foundWordIdx = idx
			break
		}
	}
	if foundWord != nil {
		rtn.CmdWordPos = foundWordIdx
		rtn.CompWord = foundWord
		rtn.CompWordOffset = pos - foundWord.Offset
		if foundWord.uncompletable() {
			// invalid completion point
			rtn.CompType = CompTypeInvalid
			return rtn
		}
		rtn.CompType = compTypeFromPos(foundWordIdx)
		return rtn
	}
	// past the end, so we're starting a new word in Cmd
	rtn.CmdWordPos = len(cmd.Words)
	rtn.CompType = CompTypeArg
	return rtn
}

func (cmd *CmdType) findWordAtPos_none(pos int) *WordType {
	if cmd.Type != CmdTypeNone {
		panic("findWordAtPos_none only works for CmdTypeNone")
	}
	for _, word := range cmd.Words {
		startOffset := word.Offset
		endOffset := word.Offset + len(word.Raw)
		if pos <= startOffset {
			return nil
		}
		if pos <= endOffset {
			if pos == endOffset && word.Type == WordTypeOp {
				// operators are special, they can allow a full-word completion at endpos
				continue
			}
			return word
		}
	}
	return nil
}

func findWordAtPos(words []*WordType, pos int) *WordType {
	for _, word := range words {
		if pos > word.Offset && pos < word.Offset+len(word.Raw) {
			return word
		}
	}
	return nil
}

// recursively descend down the word, parse commands and find a sub completion point if any.
// return nil if there is no sub completion point in this word
func findCompletionPosInWord(word *WordType, pos int, superOffset int) *CompletionPos {
	if word.Type == WordTypeGroup || word.Type == WordTypeDQ || word.Type == WordTypeDDQ {
		// need to descend further
		wmeta := wordMetaMap[word.Type]
		if pos <= wmeta.PrefixLen {
			return nil
		}
		endPos := len(word.Raw)
		if word.Complete {
			endPos = endPos - wmeta.SuffixLen
		}
		if pos >= endPos {
			return nil
		}
		subWord := findWordAtPos(word.Subs, pos-wmeta.PrefixLen)
		if subWord == nil {
			return nil
		}
		fullOffset := subWord.Offset + wmeta.PrefixLen
		return findCompletionPosInWord(subWord, pos-fullOffset, superOffset+fullOffset)
	}
	if word.Type == WordTypeDP || word.Type == WordTypeBQ {
		wmeta := wordMetaMap[word.Type]
		if pos < wmeta.PrefixLen {
			return nil
		}
		if word.Complete && pos > len(word.Raw)-wmeta.SuffixLen {
			return nil
		}
		subCmds := ParseCommands(word.Subs)
		newPos := FindCompletionPos(subCmds, pos-wmeta.PrefixLen, superOffset+wmeta.PrefixLen)
		return &newPos
	}
	return nil
}

// returns the context for completion
// if we are completing in a simple-command, the returns the Cmd.  the Cmd can be used for specialized completion (command name, arg position, etc.)
// if we are completing in a word, returns the Word.  Word might be a group-word or DQ word, so it may need additional resolution (done in extend)
// otherwise we are going to create a new word to insert at offset (so the context does not matter)
func findCompletionPosCmds(cmds []*CmdType, pos int, superOffset int) CompletionPos {
	rtn := CompletionPos{RawPos: pos, SuperOffset: superOffset}
	if len(cmds) == 0 {
		// set CompCommand because we're starting a new command
		rtn.CompType = CompTypeCommand
		return rtn
	}
	for _, cmd := range cmds {
		endOffset := cmd.endOffset()
		if pos > endOffset || (cmd.Type == CmdTypeNone && pos == endOffset) {
			continue
		}
		startOffset := cmd.offset()
		if cmd.Type == CmdTypeSimple {
			if pos <= startOffset {
				rtn.CompType = CompTypeCommand
				return rtn
			}
			return cmd.findCompletionPos_simple(pos, superOffset)
		} else {
			// not in a simple-command
			// if we're before the none-command, just start a new command
			if pos <= startOffset {
				rtn.CompType = CompTypeCommand
				return rtn
			}
			word := cmd.findWordAtPos_none(pos)
			if word == nil {
				// just revert to a file completion
				rtn.CompType = CompTypeBasic
				return rtn
			}
			rtn.CompWord = word
			rtn.CompWordOffset = pos - word.Offset
			if word.uncompletable() {
				// ok, we're inside of a word in CmdTypeNone.  if we're in an uncompletable word, return CompInvalid
				rtn.CompType = CompTypeInvalid
				return rtn
			}
			// revert to file completion
			rtn.CompType = CompTypeBasic
			return rtn
		}
	}
	// past the end
	lastCmd := cmds[len(cmds)-1]
	if lastCmd.Type == CmdTypeSimple {
		// just extend last command
		rtn.Cmd = lastCmd
		rtn.CmdWordPos = len(lastCmd.Words)
		rtn.CompType = CompTypeArg
		return rtn
	}
	// use lastCmd.NoneComplete to see if last command ended on a "separator".  use that to set CompCommand
	if lastCmd.NoneComplete {
		rtn.CompType = CompTypeCommand
	} else {
		rtn.CompType = CompTypeBasic
	}
	return rtn
}

func FindCompletionPos(cmds []*CmdType, pos int, superOffset int) CompletionPos {
	cpos := findCompletionPosCmds(cmds, pos, superOffset)
	if cpos.CompWord == nil {
		return cpos
	}
	subPos := findCompletionPosInWord(cpos.CompWord, cpos.CompWordOffset, superOffset+cpos.CompWord.Offset)
	if subPos == nil {
		return cpos
	} else {
		return *subPos
	}
}

func ResetWordOffsets(words []*WordType, startIdx int) {
	pos := startIdx
	for _, word := range words {
		pos += len(word.Prefix)
		word.Offset = pos
		if len(word.Subs) > 0 {
			ResetWordOffsets(word.Subs, 0)
		}
		pos += len(word.Raw)
	}
}

func CommandsToWords(cmds []*CmdType) []*WordType {
	var rtn []*WordType
	for _, cmd := range cmds {
		rtn = append(rtn, cmd.Words...)
	}
	return rtn
}

func (c *CmdType) stripPrefix() []rune {
	if len(c.AssignmentWords) > 0 {
		w := c.AssignmentWords[0]
		prefix := w.Prefix
		if len(prefix) == 0 {
			return nil
		}
		newWord := *w
		newWord.Prefix = nil
		c.AssignmentWords[0] = &newWord
		return prefix
	}
	if len(c.Words) > 0 {
		w := c.Words[0]
		prefix := w.Prefix
		if len(prefix) == 0 {
			return nil
		}
		newWord := *w
		newWord.Prefix = nil
		c.Words[0] = &newWord
		return prefix
	}
	return nil
}

func (c *CmdType) isEmpty() bool {
	return len(c.AssignmentWords) == 0 && len(c.Words) == 0
}

func (c *CmdType) lastWord() *WordType {
	if len(c.Words) > 0 {
		return c.Words[len(c.Words)-1]
	}
	if len(c.AssignmentWords) > 0 {
		return c.AssignmentWords[len(c.AssignmentWords)-1]
	}
	return nil
}

func (c *CmdType) firstWord() *WordType {
	if len(c.AssignmentWords) > 0 {
		return c.AssignmentWords[0]
	}
	if len(c.Words) > 0 {
		return c.Words[0]
	}
	return nil
}

func (c *CmdType) offset() int {
	firstWord := c.firstWord()
	if firstWord == nil {
		return 0
	}
	return firstWord.Offset
}

func (c *CmdType) endOffset() int {
	lastWord := c.lastWord()
	if lastWord == nil {
		return 0
	}
	return lastWord.Offset + len(lastWord.Raw)
}

func indexInRunes(arr []rune, ch rune) int {
	for idx, r := range arr {
		if r == ch {
			return idx
		}
	}
	return -1
}

func isAssignmentWord(w *WordType) bool {
	if w.Type == WordTypeLit || w.Type == WordTypeGroup {
		eqIdx := indexInRunes(w.Raw, '=')
		if eqIdx == -1 {
			return false
		}
		prefix := w.Raw[0:eqIdx]
		return isSimpleVarName(prefix)
	}
	return false
}

// simple commands steal whitespace from subsequent commands
func cmdWhitespaceFixup(cmds []*CmdType) {
	for idx := 0; idx < len(cmds)-1; idx++ {
		cmd := cmds[idx]
		if cmd.Type != CmdTypeSimple || cmd.isEmpty() {
			continue
		}
		nextCmd := cmds[idx+1]
		nextPrefix := nextCmd.stripPrefix()
		if len(nextPrefix) > 0 {
			blankWord := &WordType{Type: WordTypeLit, QC: cmd.lastWord().QC, Offset: cmd.endOffset() + len(nextPrefix), Prefix: nextPrefix, Complete: true}
			cmd.Words = append(cmd.Words, blankWord)
		}
	}
}

func ParseCommands(words []*WordType) []*CmdType {
	identifyReservedWords(words)
	state := parseCmdState{Input: words}
	for {
		if state.isEof() {
			break
		}
		word := state.curWord()
		if word.Type == WordTypeKey {
			done := state.handleKeyword(word)
			if done {
				continue
			}
		}
		if word.Type == WordTypeOp {
			done := state.handleOp(word)
			if done {
				continue
			}
		}
		if state.Cur == nil || state.Cur.Type != CmdTypeSimple {
			state.Cur = &CmdType{Type: CmdTypeSimple}
			state.Rtn = append(state.Rtn, state.Cur)
		}
		if len(state.Cur.Words) == 0 && isAssignmentWord(word) {
			state.Cur.AssignmentWords = append(state.Cur.AssignmentWords, word)
		} else {
			state.Cur.Words = append(state.Cur.Words, word)
		}
		state.InputPos++
	}
	cmdWhitespaceFixup(state.Rtn)
	return state.Rtn
}
