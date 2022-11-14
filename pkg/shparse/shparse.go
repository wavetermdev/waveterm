package shparse

import (
	"fmt"
	"strings"
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

const (
	WordTypeRaw      = "raw"
	WordTypeLit      = "lit"
	WordTypeOp       = "op"       // single: & ; | ( ) < > \n  multi(2): && || ;; << >> <& >& <> >| ((  multi(3): <<-
	WordTypeKey      = "key"      // if then else elif fi do done case esac while until for in { } ! (( [[
	WordTypeDQ       = "dq"       // "
	WordTypeSQ       = "sq"       // '
	WordTypeBQ       = "bq"       // `
	WordTypeDSQ      = "dsq"      // $'
	WordTypeDDQ      = "ddq"      // $"
	WordTypeVar      = "var"      // $
	WordTypeVarBrace = "varbrace" // ${
	WordTypeDP       = "dp"       // $(
	WordTypeDPP      = "dpp"      // $((
	WordTypeP        = "p"        // (
	WordTypeDB       = "db"       // $[
	WordTypeDBB      = "dbb"      // $[[
)

type parseContext struct {
	Input []rune
	Pos   int
}

type wordType struct {
	Offset   int
	End      int
	Type     string
	Complete bool
	Val      string // only for Op and Key (does *not* store string values of quoted expressions or expansions)
	Prefix   []rune
	Subs     []*wordType
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

func (c *parseContext) newOp(length int) *wordType {
	rtn := &wordType{Offset: c.Pos}
	rtn.Type = WordTypeOp
	rtn.Complete = true
	rtn.Val = string(c.Input[c.Pos : c.Pos+length])
	c.Pos += length
	rtn.End = c.Pos
	return rtn
}

func (c *parseContext) parseOp() *wordType {
	ch := c.cur()
	if ch == '&' || ch == ';' || ch == '|' || ch == '\n' || ch == '<' || ch == '>' || ch == '!' || ch == '(' {
		ch2 := c.at(1)
		if ch2 == 0 {
			return c.newOp(1)
		}
		r2 := string([]rune{ch, ch2})
		if r2 == "<<" {
			ch3 := c.at(2)
			if ch3 == '-' {
				return c.newOp(3) // "<<-"
			}
			return c.newOp(2) // "<<"
		}
		if r2 == "&&" || r2 == "||" || r2 == ";;" || r2 == "<<" || r2 == ">>" || r2 == "<&" || r2 == ">&" || r2 == "<>" || r2 == ">|" {
			return c.newOp(2)
		}
		return c.newOp(1)
	}
	return nil
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

func (c *parseContext) parseStrSQ() *wordType {
	if !c.match('\'') {
		return nil
	}
	w := &wordType{
		Offset: c.Pos,
		Type:   WordTypeDQ,
	}
	w.End, w.Complete = c.skipToChar(1, '\'', false)
	c.Pos = w.End
	return w
}

func (c *parseContext) parseStrDQ() *wordType {
	if !c.match('"') {
		return nil
	}
	w := &wordType{
		Offset: c.Pos,
		Type:   WordTypeDQ,
	}
	w.End, w.Complete = c.skipToChar(1, '"', true)
	c.Pos = w.End
	return w
}

func (c *parseContext) parseStrBQ() *wordType {
	if c.match('`') {
		return nil
	}
	w := &wordType{
		Offset: c.Pos,
		Type:   WordTypeBQ,
	}
	w.End, w.Complete = c.skipToChar(1, '`', true)
	c.Pos = w.End
	return w
}

func (c *parseContext) parseStrANSI() *wordType {
	if !c.match2('$', '\'') {
		return nil
	}
	w := &wordType{
		Offset: c.Pos,
		Type:   WordTypeDSQ,
	}
	w.End, w.Complete = c.skipToChar(1, '\'', true)
	c.Pos = w.End
	return w
}

func (c *parseContext) parseStrDDQ() *wordType {
	if !c.match2('$', '"') {
		return nil
	}
	w := &wordType{
		Offset: c.Pos,
		Type:   WordTypeDDQ,
	}
	w.End, w.Complete = c.skipToChar(1, '"', true)
	c.Pos = w.End
	return w
}

func (c *parseContext) parseVar() *wordType {
	if !c.match('$') {
		return nil
	}
	return nil
}

func (c *parseContext) parseQuotes() []*wordType {
	var rtn []*wordType
	var litWord *wordType
	for {
		var quoteWord *wordType
		ch := c.cur()
		fmt.Printf("ch: %d %q\n", c.Pos, string([]rune{ch}))
		startPos := c.Pos
		if ch == 0 {
			break
		}
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
		}
		if quoteWord != nil {
			if litWord != nil {
				litWord.End = startPos
				rtn = append(rtn, litWord)
				litWord = nil
			}
			rtn = append(rtn, quoteWord)
			continue
		}
		if litWord == nil {
			litWord = &wordType{Offset: c.Pos, Type: WordTypeLit, Complete: true}
		}
		if ch == '\\' && c.at(1) != 0 {
			c.Pos += 2
			continue
		}
		c.Pos++
	}
	if litWord != nil {
		litWord.End = c.Pos
		rtn = append(rtn, litWord)
	}
	return rtn
}

func (c *parseContext) RawString(w *wordType) string {
	return fmt.Sprintf("%s[%q]", w.Type, string(c.Input[w.Offset:w.End]))
}

func (c *parseContext) dumpWords(words []*wordType) {
	var strs []string
	for _, word := range words {
		strs = append(strs, c.RawString(word))
	}
	output := strings.Join(strs, " ")
	fmt.Printf("%s\n", output)
}
