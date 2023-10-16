package shparse

import (
	"bytes"
	"fmt"

	"mvdan.cc/sh/v3/expand"
)

const MaxExpandLen = 64 * 1024

type ExpandInfo struct {
	HasTilde   bool // only ~ as the first character when SimpleExpandContext.HomeDir is set
	HasVar     bool // $x, $$, ${...}
	HasGlob    bool // *, ?, [, {
	HasExtGlob bool // ?(...) ... ?*+@!
	HasHistory bool // ! (anywhere)
	HasSpecial bool // subshell, arith
}

type ExpandContext struct {
	HomeDir string
}

func expandSQ(buf *bytes.Buffer, rawLit []rune) {
	// no info specials
	buf.WriteString(string(rawLit))
}

// TODO implement our own ANSI single quote formatter
func expandANSISQ(buf *bytes.Buffer, rawLit []rune) {
	// no info specials
	str, _, _ := expand.Format(nil, string(rawLit), nil)
	buf.WriteString(str)
}

func expandLiteral(buf *bytes.Buffer, info *ExpandInfo, rawLit []rune) {
	var lastBackSlash bool
	var lastExtGlob bool
	var lastDollar bool
	for _, ch := range rawLit {
		if ch == 0 {
			break
		}
		if lastBackSlash {
			lastBackSlash = false
			if ch == '\n' {
				// special case, backslash *and* newline are ignored
				continue
			}
			buf.WriteRune(ch)
			continue
		}
		if ch == '\\' {
			lastBackSlash = true
			lastExtGlob = false
			lastDollar = false
			continue
		}
		if ch == '*' || ch == '?' || ch == '[' || ch == '{' {
			info.HasGlob = true
		}
		if ch == '`' {
			info.HasSpecial = true
		}
		if ch == '!' {
			info.HasHistory = true
		}
		if lastExtGlob && ch == '(' {
			info.HasExtGlob = true
		}
		if lastDollar && (ch != ' ' && ch != '"' && ch != '\'' && ch != '(' || ch != '[') {
			info.HasVar = true
		}
		if lastDollar && (ch == '(' || ch == '[') {
			info.HasSpecial = true
		}
		lastExtGlob = (ch == '?' || ch == '*' || ch == '+' || ch == '@' || ch == '!')
		lastDollar = (ch == '$')
		buf.WriteRune(ch)
	}
	if lastBackSlash {
		buf.WriteByte('\\')
	}
}

// will also work for partial double quoted strings
func expandDQLiteral(buf *bytes.Buffer, info *ExpandInfo, rawVal []rune) {
	var lastBackSlash bool
	var lastDollar bool
	for _, ch := range rawVal {
		if ch == 0 {
			break
		}
		if lastBackSlash {
			lastBackSlash = false
			if ch == '"' || ch == '\\' || ch == '$' || ch == '`' {
				buf.WriteRune(ch)
				continue
			}
			buf.WriteRune('\\')
			buf.WriteRune(ch)
			continue
		}
		if ch == '\\' {
			lastBackSlash = true
			lastDollar = false
			continue
		}

		// similar to expandLiteral, but no globbing
		if ch == '`' {
			info.HasSpecial = true
		}
		if ch == '!' {
			info.HasHistory = true
		}
		if lastDollar && (ch != ' ' && ch != '"' && ch != '\'' && ch != '(' || ch != '[') {
			info.HasVar = true
		}
		if lastDollar && (ch == '(' || ch == '[') {
			info.HasSpecial = true
		}
		lastDollar = (ch == '$')
		buf.WriteRune(ch)
	}
	// in a valid parsed DQ string, you cannot have a trailing backslash (because \" would not end the string)
	// still putting the case here though in case we ever deal with incomplete strings (e.g. completion)
	if lastBackSlash {
		buf.WriteByte('\\')
	}
}

func simpleExpandSubs(buf *bytes.Buffer, info *ExpandInfo, ectx ExpandContext, word *WordType, pos int) {
	fmt.Printf("expand subs: %v\n", word)
	parts := word.Subs
	startPos := word.contentStartPos()
	for _, part := range parts {
		remainingLen := pos - startPos
		if remainingLen <= 0 {
			break
		}
		simpleExpandWord(buf, info, ectx, part, remainingLen)
		startPos += len(part.Raw)
	}
}

func canExpand(ectx ExpandContext, wtype string) bool {
	return wtype == WordTypeLit || wtype == WordTypeSQ || wtype == WordTypeDSQ ||
		wtype == WordTypeDQ || wtype == WordTypeDDQ || wtype == WordTypeGroup
}

func simpleExpandWord(buf *bytes.Buffer, info *ExpandInfo, ectx ExpandContext, word *WordType, pos int) {
	if canExpand(ectx, word.Type) {
		if pos >= word.contentEndPos() {
			pos = word.contentEndPos()
		}
		if pos <= word.contentStartPos() {
			return
		}
	} else {
		if pos >= len(word.Raw) {
			pos = len(word.Raw)
		}
		if pos <= 0 {
			return
		}
	}

	switch word.Type {
	case WordTypeLit:
		if word.QC.cur() == WordTypeDQ {
			expandDQLiteral(buf, info, word.Raw[:pos])
			return
		}
		expandLiteral(buf, info, word.Raw[:pos])

	case WordTypeSQ:
		expandSQ(buf, word.Raw[word.contentStartPos():pos])
		return

	case WordTypeDSQ:
		expandANSISQ(buf, word.Raw[word.contentStartPos():pos])
		return

	case WordTypeDQ, WordTypeDDQ:
		simpleExpandSubs(buf, info, ectx, word, pos)
		return

	case WordTypeGroup:
		simpleExpandSubs(buf, info, ectx, word, pos)
		return

	// not expanded
	case WordTypeSimpleVar:
		info.HasVar = true
		buf.WriteString(string(word.Raw[:pos]))
		return

	// not expanded
	case WordTypeVarBrace:
		info.HasVar = true
		buf.WriteString(string(word.Raw[:pos]))
		return

	default:
		info.HasSpecial = true
		buf.WriteString(string(word.Raw[:pos]))
		return
	}
}

func SimpleExpandPrefix(ectx ExpandContext, word *WordType, pos int) (string, ExpandInfo) {
	var buf bytes.Buffer
	var info ExpandInfo
	simpleExpandWord(&buf, &info, ectx, word, pos)
	return buf.String(), info
}

func SimpleExpand(ectx ExpandContext, word *WordType) (string, ExpandInfo) {
	return SimpleExpandPrefix(ectx, word, len(word.Raw))
}

// returns varname (no '$') and ok (whether this is a valid varname expansion)
func SimpleVarNamePrefix(ectx ExpandContext, word *WordType, pos int) (string, bool) {
	if word.Type != WordTypeSimpleVar && word.Type != WordTypeVarBrace {
		return "", false
	}
	if word.Type == WordTypeSimpleVar {
		if pos == 0 {
			return "", false
		}
		if pos == 1 {
			return "", true
		}
		if pos > len(word.Raw) {
			pos = len(word.Raw)
		}
		return string(word.Raw[1:pos]), true
	}

	// word.Type == WordTypeVarBrace
	// knock '${' off the front, then see if the rest is a valid var name.
	if pos == 0 || pos == 1 {
		return "", false
	}
	if pos == 2 {
		return "", true
	}
	if pos > word.contentEndPos() {
		pos = word.contentEndPos()
	}
	rawVarName := word.Raw[2:pos]
	if isSimpleVarName(rawVarName) {
		return string(rawVarName), true
	}
	return "", false
}
