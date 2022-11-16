package shparse

import (
	"bytes"
	"fmt"
	"unicode"
)

// from bash source
//
// shell_meta_chars "()<>;&|"
//

type tokenizeOutputState struct {
	Rtn         []*wordType
	CurWord     *wordType
	SavedPrefix []rune
}

// does not set CurWord
func (state *tokenizeOutputState) appendStandaloneWord(word *wordType) {
	state.delimitCurWord()
	if len(state.SavedPrefix) > 0 {
		word.Prefix = state.SavedPrefix
		state.SavedPrefix = nil
	}
	state.Rtn = append(state.Rtn, word)
}

func (state *tokenizeOutputState) appendWord(word *wordType) {
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
	groupWord := &wordType{
		Type:     WordTypeGroup,
		Offset:   state.CurWord.Offset,
		QC:       state.CurWord.QC,
		Complete: true,
		Prefix:   state.CurWord.Prefix,
	}
	state.CurWord.Prefix = nil
	groupWord.Subs = []*wordType{state.CurWord}
	state.CurWord = groupWord
}

func ungroupWord(w *wordType) []*wordType {
	if w.Type != WordTypeGroup {
		return []*wordType{w}
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

func (c *parseContext) tokenizeVarBrace() ([]*wordType, bool) {
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
		var quoteWord *wordType
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

func (c *parseContext) tokenizeDQ() ([]*wordType, bool) {
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
func (c *parseContext) tokenizeRaw() ([]*wordType, bool) {
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
			opWord.Val = opVal
			state.appendStandaloneWord(opWord)
			continue
		}
		var quoteWord *wordType
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

func Tokenize(cmd string) []*wordType {
	c := &parseContext{Input: []rune(cmd)}
	rtn, _ := c.tokenizeRaw()
	return rtn
}

func (w *wordType) FullRawString() []rune {
	if w.Type == WordTypeGroup {
		var rtn []rune
		for _, sw := range w.Subs {
			rtn = append(rtn, sw.FullRawString()...)
		}
		return rtn
	}
	return w.Raw
}

func wordsToStr(words []*wordType) string {
	var buf bytes.Buffer
	for _, word := range words {
		if len(word.Prefix) > 0 {
			buf.WriteString(string(word.Prefix))
		}
		buf.WriteString(string(word.FullRawString()))
	}
	return buf.String()
}
