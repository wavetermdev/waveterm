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

func (w *WordType) cloneRaw() {
	if len(w.Raw) == 0 {
		return
	}
	buf := make([]rune, 0, len(w.Raw))
	w.Raw = append(buf, w.Raw...)
}

type extendContext struct {
	QC        QuoteContext
	Rtn       []*WordType
	CurWord   *WordType
	Intention string
}

func makeExtendContext(qc QuoteContext, w *WordType) *extendContext {
	rtn := &extendContext{QC: qc, Intention: WordTypeLit}
	if w != nil {
		w.cloneRaw()
		rtn.Rtn = []*WordType{w}
		rtn.CurWord = w
		rtn.Intention = w.Type
	}
	return rtn
}

func (ec *extendContext) appendWord(w *WordType) {
	ec.Rtn = append(ec.Rtn, w)
	ec.CurWord = w
}

func (ec *extendContext) ensureCurWord() {
	if ec.CurWord == nil || ec.CurWord.Type != ec.Intention {
		ec.CurWord = MakeEmptyWord(ec.Intention, ec.QC, 0)
		ec.Rtn = append(ec.Rtn, ec.CurWord)
	}
}

func (ec *extendContext) extend(ch rune) {
	if ch == 0 {
		return
	}
	switch ec.Intention {

	case WordTypeSimpleVar, WordTypeVarBrace:
		ec.extendVar(ch)

	case WordTypeDQ, WordTypeDDQ:
		ec.extendDQ(ch)

	case WordTypeSQ:
		ec.extendSQ(ch)

	case WordTypeDSQ:
		ec.extendDSQ(ch)

	case WordTypeLit:
		ec.extendLit(ch)

	default:
		return
	}
}

func getSpecialEscape(ch rune) string {
	if ch > unicode.MaxASCII {
		return ""
	}
	return specialEsc[byte(ch)]
}

func isVarNameChar(ch rune) bool {
	return ch == '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
}

func (ec *extendContext) extendVar(ch rune) {
	if ch == 0 {
		return
	}
	if !isVarNameChar(ch) {
		return
	}
	ec.ensureCurWord()
	ec.CurWord.writeRune(ch)
}

func (ec *extendContext) extendLit(ch rune) {
	if ch == 0 {
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		dsqWord := MakeEmptyWord(WordTypeDSQ, ec.QC, 0)
		ec.appendWord(dsqWord)
		sesc := getSpecialEscape(ch)
		if sesc != "" {
			dsqWord.writeString(sesc)
			return
		} else {
			utf8Lit := getUtf8Literal(ch)
			dsqWord.writeString(utf8Lit)
		}
		return
	}
	var bch = byte(ch)
	ec.ensureCurWord()
	if noEscChars[bch] {
		ec.CurWord.writeRune(ch)
		return
	}
	ec.CurWord.writeRune('\\')
	ec.CurWord.writeRune(ch)
	return
}

func (ec *extendContext) extendDSQ(ch rune) {
	if ch == 0 {
		return
	}
	ec.ensureCurWord()
	if ch == '\'' {
		ec.CurWord.writeRune('\\')
		ec.CurWord.writeRune(ch)
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		sesc := getSpecialEscape(ch)
		if sesc != "" {
			ec.CurWord.writeString(sesc)
		} else {
			utf8Lit := getUtf8Literal(ch)
			ec.CurWord.writeString(utf8Lit)
		}
		return
	}
	ec.CurWord.writeRune(ch)
	return
}

func (ec *extendContext) extendSQ(ch rune) {
	if ch == 0 {
		return
	}
	if ch == '\'' {
		litWord := &WordType{Type: WordTypeLit, QC: ec.QC}
		litWord.Raw = []rune{'\\', '\''}
		ec.appendWord(litWord)
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		dsqWord := MakeEmptyWord(WordTypeDSQ, ec.QC, 0)
		ec.appendWord(dsqWord)
		sesc := getSpecialEscape(ch)
		if sesc != "" {
			dsqWord.writeString(sesc)
		} else {
			utf8Lit := getUtf8Literal(ch)
			dsqWord.writeString(utf8Lit)
		}
		return
	}
	ec.ensureCurWord()
	ec.CurWord.writeRune(ch)
	return
}

func (ec *extendContext) extendDQ(ch rune) {
	if ch == 0 {
		return
	}
	if ch == '"' || ch == '\\' || ch == '$' || ch == '`' {
		ec.ensureCurWord()
		ec.CurWord.writeRune('\\')
		ec.CurWord.writeRune(ch)
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		dsqWord := MakeEmptyWord(WordTypeDSQ, ec.QC, 0)
		ec.appendWord(dsqWord)
		sesc := getSpecialEscape(ch)
		if sesc != "" {
			dsqWord.writeString(sesc)
		} else {
			utf8Lit := getUtf8Literal(ch)
			dsqWord.writeString(utf8Lit)
		}
		return
	}
	ec.CurWord.writeRune(ch)
	return
}
