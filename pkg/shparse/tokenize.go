package shparse

import (
	"fmt"
	"unicode"
)

// from bash source
//
// shell_meta_chars "()<>;&|"
//

type tokenizeOutputState struct {
	Rtn         []*WordType
	CurWord     *WordType
	SavedPrefix []rune
}

// does not set CurWord
func (state *tokenizeOutputState) appendStandaloneWord(word *WordType) {
	state.delimitCurWord()
	if len(state.SavedPrefix) > 0 {
		word.Prefix = state.SavedPrefix
		state.SavedPrefix = nil
	}
	state.Rtn = append(state.Rtn, word)
}

func (state *tokenizeOutputState) appendWord(word *WordType) {
	if len(state.SavedPrefix) > 0 {
		word.Prefix = state.SavedPrefix
		state.SavedPrefix = nil
	}
	if state.CurWord == nil {
		state.CurWord = word
		return
	}
	state.ensureGroupWord()
	state.CurWord.Subs = append(state.CurWord.Subs, word)
}

func (state *tokenizeOutputState) ensureGroupWord() {
	if state.CurWord == nil {
		panic("invalid state, cannot make group word when CurWord is nil")
	}
	if state.CurWord.Type == WordTypeGroup {
		return
	}
	// moves the prefix from CurWord to the new group word
	groupWord := &WordType{
		Type:     WordTypeGroup,
		Offset:   state.CurWord.Offset,
		QC:       state.CurWord.QC,
		Complete: true,
		Prefix:   state.CurWord.Prefix,
	}
	state.CurWord.Prefix = nil
	groupWord.Subs = []*WordType{state.CurWord}
	state.CurWord = groupWord
}

func ungroupWord(w *WordType) []*WordType {
	if w.Type != WordTypeGroup {
		return []*WordType{w}
	}
	rtn := w.Subs
	if len(w.Prefix) > 0 && len(rtn) > 0 {
		newPrefix := append([]rune{}, w.Prefix...)
		newPrefix = append(newPrefix, rtn[0].Prefix...)
		rtn[0].Prefix = newPrefix
	}
	return rtn
}

func (state *tokenizeOutputState) ensureLitCurWord(pc *parseContext) {
	if state.CurWord == nil {
		state.CurWord = pc.makeWord(WordTypeLit, 0, true)
		state.CurWord.Prefix = state.SavedPrefix
		state.SavedPrefix = nil
		return
	}
	if state.CurWord.Type == WordTypeLit {
		return
	}
	state.ensureGroupWord()
	lastWord := state.CurWord.Subs[len(state.CurWord.Subs)-1]
	if lastWord.Type != WordTypeLit {
		if len(state.SavedPrefix) > 0 {
			panic("invalid state, there can be no saved prefix")
		}
		litWord := pc.makeWord(WordTypeLit, 0, true)
		state.CurWord.Subs = append(state.CurWord.Subs, litWord)
	}
}

func (state *tokenizeOutputState) delimitCurWord() {
	if state.CurWord != nil {
		state.Rtn = append(state.Rtn, state.CurWord)
		state.CurWord = nil
	}
}

func (state *tokenizeOutputState) delimitWithSpace(spaceCh rune) {
	state.delimitCurWord()
	state.SavedPrefix = append(state.SavedPrefix, spaceCh)
}

func (state *tokenizeOutputState) appendLiteral(pc *parseContext, ch rune) {
	state.ensureLitCurWord(pc)
	if state.CurWord.Type == WordTypeLit {
		state.CurWord.Raw = append(state.CurWord.Raw, ch)
	} else if state.CurWord.Type == WordTypeGroup {
		lastWord := state.CurWord.Subs[len(state.CurWord.Subs)-1]
		if lastWord.Type != WordTypeLit {
			panic(fmt.Sprintf("invalid curword type (group) %q", state.CurWord.Type))
		}
		lastWord.Raw = append(lastWord.Raw, ch)
	} else {
		panic(fmt.Sprintf("invalid curword type %q", state.CurWord.Type))
	}
}

func (state *tokenizeOutputState) finish(pc *parseContext) {
	state.delimitCurWord()
	if len(state.SavedPrefix) > 0 {
		state.ensureLitCurWord(pc)
		state.delimitCurWord()
	}
}

func (c *parseContext) tokenizeVarBrace() ([]*WordType, bool) {
	state := &tokenizeOutputState{}
	eofExit := false
	for {
		ch := c.cur()
		if ch == 0 {
			eofExit = true
			break
		}
		if ch == '}' {
			c.Pos++
			break
		}
		var quoteWord *WordType
		if ch == '\'' {
			quoteWord = c.parseStrSQ()
		}
		if quoteWord == nil && ch == '"' {
			quoteWord = c.parseStrDQ()
		}
		isNextBrace := c.at(1) == '}'
		if quoteWord == nil && ch == '$' && !isNextBrace {
			quoteWord = c.parseStrANSI()
			if quoteWord == nil {
				quoteWord = c.parseStrDDQ()
			}
			if quoteWord == nil {
				quoteWord = c.parseExpansion()
			}
		}
		if quoteWord != nil {
			state.appendWord(quoteWord)
			continue
		}
		if ch == '\\' && c.at(1) != 0 {
			state.appendLiteral(c, ch)
			state.appendLiteral(c, c.at(1))
			c.Pos += 2
			continue
		}
		state.appendLiteral(c, ch)
		c.Pos++
	}
	return state.Rtn, eofExit
}

func (c *parseContext) tokenizeDQ() ([]*WordType, bool) {
	state := &tokenizeOutputState{}
	eofExit := false
	for {
		ch := c.cur()
		if ch == 0 {
			eofExit = true
			break
		}
		if ch == '"' {
			c.Pos++
			break
		}
		if ch == '$' && c.at(1) != 0 {
			quoteWord := c.parseStrANSI()
			if quoteWord == nil {
				quoteWord = c.parseStrDDQ()
			}
			if quoteWord == nil {
				quoteWord = c.parseExpansion()
			}
			if quoteWord != nil {
				state.appendWord(quoteWord)
				continue
			}
		}
		if ch == '\\' && c.at(1) != 0 {
			state.appendLiteral(c, ch)
			state.appendLiteral(c, c.at(1))
			c.Pos += 2
			continue
		}
		state.appendLiteral(c, ch)
		c.Pos++
	}
	state.finish(c)
	if len(state.Rtn) == 0 {
		return nil, eofExit
	}
	if len(state.Rtn) == 1 && state.Rtn[0].Type == WordTypeGroup {
		return ungroupWord(state.Rtn[0]), eofExit
	}
	return state.Rtn, eofExit
}

// returns (words, eofexit)
// backticks (WordTypeBQ) handle backslash in a special way, but that seems to mainly effect execution (not completion)
//     de_backslash => removes initial backslash in \`, \\, and \$ before execution
func (c *parseContext) tokenizeRaw() ([]*WordType, bool) {
	state := &tokenizeOutputState{}
	isExpSubShell := c.QC.cur() == WordTypeDP
	isInBQ := c.QC.cur() == WordTypeBQ
	parenLevel := 0
	eofExit := false
	for {
		ch := c.cur()
		if ch == 0 {
			eofExit = true
			break
		}
		if isExpSubShell && ch == ')' && parenLevel == 0 {
			c.Pos++
			break
		}
		if isInBQ && ch == '`' {
			c.Pos++
			break
		}
		// fmt.Printf("ch %d %q\n", c.Pos, string([]rune{ch}))
		foundOp, newOffset := c.parseOp(0)
		if foundOp {
			opVal := string(c.Input[c.Pos : c.Pos+newOffset])
			if opVal == "(" {
				arithWord := c.parseArith(true)
				if arithWord != nil {
					state.appendStandaloneWord(arithWord)
					continue
				} else {
					parenLevel++
				}
			}
			if opVal == ")" {
				parenLevel--
			}
			opWord := c.makeWord(WordTypeOp, newOffset, true)
			state.appendStandaloneWord(opWord)
			continue
		}
		var quoteWord *WordType
		if ch == '\'' {
			quoteWord = c.parseStrSQ()
		}
		if quoteWord == nil && ch == '"' {
			quoteWord = c.parseStrDQ()
		}
		if quoteWord == nil && ch == '`' {
			quoteWord = c.parseStrBQ()
		}
		isNextParen := isExpSubShell && c.at(1) == ')'
		if quoteWord == nil && ch == '$' && !isNextParen {
			quoteWord = c.parseStrANSI()
			if quoteWord == nil {
				quoteWord = c.parseStrDDQ()
			}
			if quoteWord == nil {
				quoteWord = c.parseExpansion()
			}
		}
		if quoteWord != nil {
			state.appendWord(quoteWord)
			continue
		}
		if ch == '\\' && c.at(1) != 0 {
			state.appendLiteral(c, ch)
			state.appendLiteral(c, c.at(1))
			c.Pos += 2
			continue
		}
		if ch == '\n' {
			newlineWord := c.makeWord(WordTypeOp, 1, true)
			state.appendStandaloneWord(newlineWord)
			continue
		}
		if unicode.IsSpace(ch) {
			state.delimitWithSpace(ch)
			c.Pos++
			continue
		}
		state.appendLiteral(c, ch)
		c.Pos++
	}
	state.finish(c)
	return state.Rtn, eofExit
}

type parseContext struct {
	Input []rune
	Pos   int
	QC    QuoteContext
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

func (c *parseContext) makeWord(t string, length int, complete bool) *WordType {
	rtn := &WordType{Type: t}
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

func (c *parseContext) parseStrSQ() *WordType {
	if !c.match('\'') {
		return nil
	}
	newOffset, complete := c.skipToChar(1, '\'', false)
	w := c.makeWord(WordTypeSQ, newOffset, complete)
	return w
}

func (c *parseContext) parseStrDQ() *WordType {
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

func (c *parseContext) parseStrDDQ() *WordType {
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

func (c *parseContext) parseStrBQ() *WordType {
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

func (c *parseContext) parseStrANSI() *WordType {
	if !c.match2('$', '\'') {
		return nil
	}
	newOffset, complete := c.skipToChar(2, '\'', true)
	w := c.makeWord(WordTypeDSQ, newOffset, complete)
	return w
}

func (c *parseContext) parseArith(mustComplete bool) *WordType {
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

func (c *parseContext) parseExpansion() *WordType {
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

func Tokenize(cmd string) []*WordType {
	c := &parseContext{Input: []rune(cmd)}
	rtn, _ := c.tokenizeRaw()
	return rtn
}
