package shparse

import (
	"bytes"
	"unicode"
	"unicode/utf8"

	"github.com/scripthaus-dev/sh2-server/pkg/utilfn"
)

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

func getUtf8Literal(ch rune) string {
	var buf bytes.Buffer
	var runeArr [utf8.UTFMax]byte
	barr := runeArr[:]
	byteLen := utf8.EncodeRune(barr, ch)
	for i := 0; i < byteLen; i++ {
		buf.WriteString("\\x")
		buf.WriteByte(utilfn.HexDigits[barr[i]/16])
		buf.WriteByte(utilfn.HexDigits[barr[i]%16])
	}
	return buf.String()
}

func (w *WordType) writeString(s string) {
	for _, ch := range s {
		w.writeRune(ch)
	}
}

func (w *WordType) writeRune(ch rune) {
	wmeta := wordMetaMap[w.Type]
	if w.Complete && wmeta.SuffixLen == 1 {
		w.Raw = append(w.Raw[0:len(w.Raw)-1], ch, w.Raw[len(w.Raw)-1])
		return
	}
	if w.Complete && wmeta.SuffixLen == 2 {
		w.Raw = append(w.Raw[0:len(w.Raw)-2], ch, w.Raw[len(w.Raw)-2], w.Raw[len(w.Raw)-1])
		return
	}
	// not complete or SuffixLen == 0 (2+ is not supported)
	w.Raw = append(w.Raw, ch)
	return
}

type extendContext struct {
	Input     []*WordType
	InputPos  int
	QC        QuoteContext
	Rtn       []*WordType
	CurWord   *WordType
	Intention string
}

func makeExtendContext(qc QuoteContext, word *WordType) *extendContext {
	rtn := &extendContext{QC: qc}
	if word == nil {
		rtn.Intention = WordTypeLit
		return rtn
	} else {
		rtn.Intention = word.Type
		rtn.Rtn = []*WordType{word}
		rtn.CurWord = word
		return rtn
	}
}

func (ec *extendContext) appendWord(w *WordType) {
	ec.Rtn = append(ec.Rtn, w)
	ec.CurWord = w
}

func (ec *extendContext) ensureCurWord() {
	if ec.CurWord == nil || ec.CurWord.Type != ec.Intention {
		ec.CurWord = MakeEmptyWord(ec.Intention, ec.QC, 0, true)
		ec.Rtn = append(ec.Rtn, ec.CurWord)
	}
}

// grp, dq, ddq
func extendWithSubs(buf *bytes.Buffer, word *WordType, wordPos int, extStr string) {

}

// lit, svar, varb, sq, dsq
func extendLeafCh(buf *bytes.Buffer, wordOpen *bool, wtype string, qc QuoteContext, ch rune) {
	switch wtype {
	case WordTypeSimpleVar, WordTypeVarBrace:
		extendVar(buf, ch)

	case WordTypeLit:
		if qc.cur() == WordTypeDQ {
			extendDQLit(buf, wordOpen, ch)
		} else {
			extendLit(buf, ch)
		}

	case WordTypeSQ:
		extendSQ(buf, wordOpen, ch)

	case WordTypeDSQ:
		extendDSQ(buf, wordOpen, ch)

	default:
		return
	}
}

// lit, svar, varb sq, dsq
func extendLeaf(buf *bytes.Buffer, wordOpen *bool, word *WordType, wordPos int, extStr string) {
	for _, ch := range extStr {
		extendLeafCh(buf, wordOpen, word.Type, word.QC, ch)
	}
}

// lit, grp, svar, dq, ddq, varb, sq, dsq
func Extend(word *WordType, wordPos int, extStr string, complete bool) utilfn.StrWithPos {
	if extStr == "" {
		return utilfn.StrWithPos{Str: string(word.Raw), Pos: wordPos}
	}
	var buf bytes.Buffer
	isEOW := wordPos >= word.contentEndPos()
	if isEOW {
		wordPos = word.contentEndPos()
	}
	if wordPos > 0 && wordPos < word.contentStartPos() {
		wordPos = word.contentStartPos()
	}
	wordOpen := false
	if wordPos >= word.contentStartPos() {
		wordOpen = true
	}
	buf.WriteString(string(word.Raw[0:wordPos])) // write the prefix
	if word.canHaveSubs() {
		extendWithSubs(&buf, word, wordPos, extStr)
	} else {
		extendLeaf(&buf, &wordOpen, word, wordPos, extStr)
	}
	if isEOW {
		// end-of-word, write the suffix (and optional ' ').  return the end of the string
		wmeta := wordMetaMap[word.Type]
		buf.WriteString(wmeta.getSuffix())
		var rtnPos int
		if complete {
			buf.WriteRune(' ')
			rtnPos = utf8.RuneCount(buf.Bytes())
		} else {
			rtnPos = utf8.RuneCount(buf.Bytes()) - wmeta.SuffixLen
		}
		return utilfn.StrWithPos{Str: buf.String(), Pos: rtnPos}
	}
	// completion in the middle of a word (no ' ')
	rtnPos := utf8.RuneCount(buf.Bytes())
	buf.WriteString(string(word.Raw[wordPos:])) // write the suffix
	return utilfn.StrWithPos{Str: buf.String(), Pos: rtnPos}
}

func (ec *extendContext) extend(ch rune) {
	if ch == 0 {
		return
	}
	return
}

func isVarNameChar(ch rune) bool {
	return ch == '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
}

func extendVar(buf *bytes.Buffer, ch rune) {
	if ch == 0 {
		return
	}
	if !isVarNameChar(ch) {
		return
	}
	buf.WriteRune(ch)
}

func getSpecialEscape(ch rune) string {
	if ch > unicode.MaxASCII {
		return ""
	}
	return specialEsc[byte(ch)]
}

func writeSpecial(buf *bytes.Buffer, ch rune) {
	sesc := getSpecialEscape(ch)
	if sesc != "" {
		buf.WriteString(sesc)
	} else {
		utf8Lit := getUtf8Literal(ch)
		buf.WriteString(utf8Lit)
	}
}

func extendLit(buf *bytes.Buffer, ch rune) {
	if ch == 0 {
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		writeSpecial(buf, ch)
		return
	}
	var bch = byte(ch)
	if noEscChars[bch] {
		buf.WriteRune(ch)
		return
	}
	buf.WriteRune('\\')
	buf.WriteRune(ch)
	return
}

func extendDSQ(buf *bytes.Buffer, wordOpen *bool, ch rune) {
	if ch == 0 {
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		if *wordOpen {
			buf.WriteRune('\'')
			*wordOpen = false
		}
		writeSpecial(buf, ch)
		return
	}
	if *wordOpen {
		buf.WriteRune('$')
		buf.WriteRune('\'')
		*wordOpen = true
	}
	if ch == '\'' {
		buf.WriteRune('\\')
		buf.WriteRune(ch)
		return
	}
	buf.WriteRune(ch)
	return
}

func extendSQ(buf *bytes.Buffer, wordOpen *bool, ch rune) {
	if ch == 0 {
		return
	}
	if ch == '\'' {
		if *wordOpen {
			buf.WriteRune('\'')
			*wordOpen = false
		}
		buf.WriteRune('\\')
		buf.WriteRune('\'')
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		if *wordOpen {
			buf.WriteRune('\'')
			*wordOpen = false
		}
		writeSpecial(buf, ch)
		return
	}
	if !*wordOpen {
		buf.WriteRune('\'')
		*wordOpen = true
	}
	buf.WriteRune(ch)
	return
}

func extendDQLit(buf *bytes.Buffer, wordOpen *bool, ch rune) {
	if ch == 0 {
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		if *wordOpen {
			buf.WriteRune('"')
			*wordOpen = false
		}
		writeSpecial(buf, ch)
		return
	}
	if !*wordOpen {
		buf.WriteRune('"')
		*wordOpen = true
	}
	if ch == '"' || ch == '\\' || ch == '$' || ch == '`' {
		buf.WriteRune('\\')
		buf.WriteRune(ch)
		return
	}
	buf.WriteRune(ch)
	return
}
