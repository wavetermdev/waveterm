package shparse

import (
	"fmt"
	"unicode"
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
// $var
// ${var}
// ${var op word?}
// op := '-' | '=' | '?' | '+' | ':-' | ':=' | ':?' | ':+' | '%' | '%%' | '#' | '##'
// ${ '#' var }
//
// $(command)
// `command`
// $(( arith ))
//
// " ... "
// ' ... '
// $' ... '
// $" ... '

// "  => $, ", `, \
// '  => '
// (process quotes)
// mark as escaped
// split into commands (use ';' as separator)
// parse special operators
// perform expansions (vars, globs, commands)
// split command into name and arguments

// A correctly-formed brace expansion must contain unquoted opening and closing braces, and at least one unquoted comma or a valid sequence expression
// Any incorrectly formed brace expansion is left unchanged.

// word: char *word; flags
// bash aliases are lexical

// [[, ((, $(( <- DQ

// $ -> expansion
// $(...)
// (...)
// $((...))
// ((...))
// ${...}
// {...}
// X=(...)

// ambiguity between $((...)) and $((ls); ls)
// ambiguity between foo=([0]=hell) and foo=([abc)

// tokenization https://pubs.opengroup.org/onlinepubs/7908799/xcu/chap2.html#tag_001_003

const (
	WordTypeRaw       = "raw"
	WordTypeLit       = "lit"  // (can-extend)
	WordTypeOp        = "op"   // single: & ; | ( ) < > \n  multi(2): && || ;; << >> <& >& <> >| ((  multi(3): <<-    ('((' requires special processing)
	WordTypeKey       = "key"  // if then else elif fi do done case esac while until for in { } ! (( [[
	WordTypeGroup     = "grp"  // contains other words e.g. "hello"foo'bar'$x
	WordTypeSimpleVar = "svar" // simplevar $ (can-extend)

	WordTypeDQ       = "dq"   // "    (quote-context) (can-extend)
	WordTypeDDQ      = "ddq"  // $"   (quote-context) (can-extend)
	WordTypeVarBrace = "varb" // ${   (quote-context) (can-extend)
	WordTypeDP       = "dp"   // $(   (quote-context)
	WordTypeBQ       = "bq"   // `    (quote-context)

	WordTypeSQ  = "sq"  // '     (can-extend)
	WordTypeDSQ = "dsq" // $'    (can-extend)
	WordTypeDPP = "dpp" // $((   (internals not parsed)
	WordTypePP  = "pp"  // ((    (internals not parsed)
	WordTypeDB  = "db"  // $[    (internals not parsed)
)

type quoteContext []string

func (qc quoteContext) push(q string) quoteContext {
	rtn := make([]string, 0, len(qc)+1)
	rtn = append(rtn, qc...)
	rtn = append(rtn, q)
	return rtn
}

func (qc quoteContext) cur() string {
	if len(qc) == 0 {
		return ""
	}
	return qc[len(qc)-1]
}

type parseContext struct {
	Input []rune
	Pos   int
	QC    quoteContext
}

type wordType struct {
	Type     string
	Offset   int
	QC       quoteContext
	Raw      []rune
	Complete bool
	Val      string // only for Op and Key (does *not* store string values of quoted expressions or expansions)
	Prefix   []rune
	Subs     []*wordType
}

func (c *parseContext) clone(pos int, newQuote string) *parseContext {
	rtn := parseContext{Input: c.Input[pos:], QC: c.QC}
	if newQuote != "" {
		rtn.QC = rtn.QC.push(newQuote)
	}
	return &rtn
}

func (c *parseContext) at(offset int) rune {
	pos := c.Pos + offset
	if pos < 0 || pos >= len(c.Input) {
		return 0
	}
	return c.Input[pos]
}

func (c *parseContext) eof() bool {
	return c.Pos >= len(c.Input)
}

func (c *parseContext) cur() rune {
	return c.at(0)
}

func (c *parseContext) match(ch rune) bool {
	return c.at(0) == ch
}

func (c *parseContext) match2(ch rune, ch2 rune) bool {
	return c.at(0) == ch && c.at(1) == ch2
}

func (c *parseContext) match3(ch rune, ch2 rune, ch3 rune) bool {
	return c.at(0) == ch && c.at(1) == ch2 && c.at(2) == ch3
}

func (c *parseContext) makeWord(t string, length int, complete bool) *wordType {
	rtn := &wordType{Type: t}
	rtn.Offset = c.Pos
	rtn.QC = c.QC
	rtn.Raw = c.Input[c.Pos : c.Pos+length]
	rtn.Complete = complete
	c.Pos += length
	return rtn
}

// returns (found, newOffset)
// shell_meta_chars "()<>;&|"
// possible to maybe add ;;& &>> &> |& ;&
func (c *parseContext) parseOp(offset int) (bool, int) {
	ch := c.at(offset)
	if ch == '(' || ch == ')' || ch == '<' || ch == '>' || ch == ';' || ch == '&' || ch == '|' {
		ch2 := c.at(offset + 1)
		if ch2 == 0 {
			return true, offset + 1
		}
		r2 := string([]rune{ch, ch2})
		if r2 == "<<" {
			ch3 := c.at(offset + 2)
			if ch3 == '-' || ch3 == '<' {
				return true, offset + 3 // "<<-" or "<<<"
			}
			return true, offset + 2 // "<<"
		}
		if r2 == ">>" || r2 == "&&" || r2 == "||" || r2 == ";;" || r2 == "<<" || r2 == "<&" || r2 == ">&" || r2 == "<>" || r2 == ">|" {
			// we don't return '((' here (requires special processing)
			return true, offset + 2
		}
		return true, offset + 1
	}
	return false, 0
}

// returns (new-offset, complete)
func (c *parseContext) skipToChar(offset int, endCh rune, allowEsc bool) (int, bool) {
	for {
		ch := c.at(offset)
		if ch == 0 {
			return offset, false
		}
		if allowEsc && ch == '\\' {
			if c.at(offset+1) == 0 {
				return offset + 1, false
			}
			offset += 2
			continue
		}
		if ch == endCh {
			return offset + 1, true
		}
		offset++
	}
}

// returns (new-offset, complete)
func (c *parseContext) skipToChar2(offset int, endCh rune, endCh2 rune, allowEsc bool) (int, bool) {
	for {
		ch := c.at(offset)
		ch2 := c.at(offset + 1)
		if ch == 0 {
			return offset, false
		}
		if ch2 == 0 {
			return offset + 1, false
		}
		if allowEsc && ch == '\\' {
			offset += 2
			continue
		}
		if ch == endCh && ch2 == endCh2 {
			return offset + 2, true
		}
		offset++
	}
}

func (c *parseContext) parseStrSQ() *wordType {
	if !c.match('\'') {
		return nil
	}
	newOffset, complete := c.skipToChar(1, '\'', false)
	w := c.makeWord(WordTypeSQ, newOffset, complete)
	return w
}

func (c *parseContext) parseStrDQ() *wordType {
	if !c.match('"') {
		return nil
	}
	newContext := c.clone(c.Pos+1, WordTypeDQ)
	subWords, eofExit := newContext.tokenizeDQ()
	newOffset := newContext.Pos + 1
	w := c.makeWord(WordTypeDQ, newOffset, !eofExit)
	w.Subs = subWords
	return w
}

func (c *parseContext) parseStrDDQ() *wordType {
	if !c.match2('$', '"') {
		return nil
	}
	newContext := c.clone(c.Pos+2, WordTypeDDQ)
	subWords, eofExit := newContext.tokenizeDQ()
	newOffset := newContext.Pos + 2
	w := c.makeWord(WordTypeDDQ, newOffset, !eofExit)
	w.Subs = subWords
	return w
}

func (c *parseContext) parseStrBQ() *wordType {
	if !c.match('`') {
		return nil
	}
	newContext := c.clone(c.Pos+1, WordTypeBQ)
	subWords, eofExit := newContext.tokenizeRaw()
	newOffset := newContext.Pos + 1
	w := c.makeWord(WordTypeBQ, newOffset, !eofExit)
	w.Subs = subWords
	return w
}

func (c *parseContext) parseStrANSI() *wordType {
	if !c.match2('$', '\'') {
		return nil
	}
	newOffset, complete := c.skipToChar(2, '\'', true)
	w := c.makeWord(WordTypeDSQ, newOffset, complete)
	return w
}

func (c *parseContext) parseArith(mustComplete bool) *wordType {
	if !c.match2('(', '(') {
		return nil
	}
	newOffset, complete := c.skipToChar2(2, ')', ')', false)
	if mustComplete && !complete {
		return nil
	}
	w := c.makeWord(WordTypePP, newOffset, complete)
	return w
}

func (c *parseContext) parseExpansion() *wordType {
	if !c.match('$') {
		return nil
	}
	if c.match3('$', '(', '(') {
		newOffset, complete := c.skipToChar2(3, ')', ')', false)
		w := c.makeWord(WordTypeDPP, newOffset, complete)
		return w
	}
	if c.match2('$', '(') {
		// subshell
		newContext := c.clone(c.Pos+2, WordTypeDP)
		subWords, eofExit := newContext.tokenizeRaw()
		newOffset := newContext.Pos + 2
		w := c.makeWord(WordTypeDP, newOffset, !eofExit)
		w.Subs = subWords
		return w
	}
	if c.match2('$', '[') {
		// deprecated arith expansion
		newOffset, complete := c.skipToChar(2, ']', false)
		w := c.makeWord(WordTypeDB, newOffset, complete)
		return w
	}
	if c.match2('$', '{') {
		// variable expansion
		newContext := c.clone(c.Pos+2, WordTypeVarBrace)
		_, eofExit := newContext.tokenizeVarBrace()
		newOffset := newContext.Pos + 2
		w := c.makeWord(WordTypeVarBrace, newOffset, !eofExit)
		return w
	}
	ch2 := c.at(1)
	if ch2 == 0 || unicode.IsSpace(ch2) {
		// no expansion
		return nil
	}
	newOffset := c.parseSimpleVarName(1)
	if newOffset > 1 {
		// simple variable name
		w := c.makeWord(WordTypeSimpleVar, newOffset, true)
		return w
	}
	if ch2 == '*' || ch2 == '@' || ch2 == '#' || ch2 == '?' || ch2 == '-' || ch2 == '$' || ch2 == '!' || (ch2 >= '0' && ch2 <= '9') {
		// single character variable name, e.g. $@, $_, $1, etc.
		w := c.makeWord(WordTypeSimpleVar, 2, true)
		return w
	}
	return nil
}

// returns newOffset
func (c *parseContext) parseSimpleVarName(offset int) int {
	first := true
	for {
		ch := c.at(offset)
		if ch == 0 {
			return offset
		}
		if (ch == '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) || (!first && ch >= '0' && ch <= '9') {
			first = false
			offset++
			continue
		}
		return offset
	}
}

func makeSpaceStr(slen int) string {
	if slen == 0 {
		return ""
	}
	if slen == 1 {
		return " "
	}
	rtn := make([]byte, slen)
	for i := 0; i < slen; i++ {
		rtn[i] = ' '
	}
	return string(rtn)
}

func (w *wordType) String() string {
	notCompleteFlag := " "
	if !w.Complete {
		notCompleteFlag = "*"
	}
	return fmt.Sprintf("%4s[%3d]%s %s%q", w.Type, w.Offset, notCompleteFlag, makeSpaceStr(len(w.Prefix)), string(w.FullRawString()))
}

func dumpWords(words []*wordType, indentStr string) {
	for _, word := range words {
		fmt.Printf("%s%s\n", indentStr, word.String())
		if len(word.Subs) > 0 {
			dumpWords(word.Subs, indentStr+"  ")
		}
	}
}
