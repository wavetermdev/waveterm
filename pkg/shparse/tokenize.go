package shparse

import (
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

func (state *tokenizeOutputState) appendWord(word *wordType) {
	state.delimitCurWord()
	if len(state.SavedPrefix) > 0 {
		word.Prefix = state.SavedPrefix
		state.SavedPrefix = nil
	}
	state.Rtn = append(state.Rtn, word)
}

func (state *tokenizeOutputState) ensureCurWord(pc *parseContext) {
	if state.CurWord != nil {
		return
	}
	state.CurWord = &wordType{Type: WordTypeLit, Offset: pc.Pos, Complete: true, Prefix: state.SavedPrefix}
	state.SavedPrefix = nil
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

func (state *tokenizeOutputState) finish(pc *parseContext) {
	state.delimitCurWord()
	if len(state.SavedPrefix) > 0 {
		state.ensureCurWord(pc)
		state.delimitCurWord()
	}
}

func Tokenize(cmd string) []*wordType {
	c := &parseContext{Input: []rune(cmd)}
	state := &tokenizeOutputState{}
	for {
		ch := c.cur()
		if ch == 0 {
			break
		}
		// fmt.Printf("ch %d %q\n", c.Pos, string([]rune{ch}))
		foundOp, newOffset := c.parseOp(0)
		if foundOp {
			opWord := &wordType{Type: WordTypeOp, Offset: c.Pos, Raw: c.Input[c.Pos : c.Pos+newOffset], Complete: true}
			opWord.Val = string(opWord.Raw)
			c.Pos = c.Pos + newOffset
			state.appendWord(opWord)
			continue
		}
		var quoteWord *wordType
		switch ch {
		case '\'':
			quoteWord = c.parseStrSQ()

		case '"':
			quoteWord = c.parseStrDQ()

		case '$':
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
			state.ensureCurWord(c)
			state.CurWord.Raw = append(state.CurWord.Raw, ch, c.at(1))
			c.Pos += 2
			continue
		}
		if unicode.IsSpace(ch) {
			state.delimitWithSpace(ch)
			c.Pos++
			continue
		}
		state.ensureCurWord(c)
		state.CurWord.Raw = append(state.CurWord.Raw, ch)
		c.Pos++
	}
	state.finish(c)
	return state.Rtn
}
