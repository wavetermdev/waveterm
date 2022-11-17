package shparse

import (
	"bytes"
	"fmt"
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

func (w *wordType) writeString(s string) {
	for _, ch := range s {
		w.writeRune(ch)
	}
}

func (w *wordType) writeRune(ch rune) {
	if w.Type == WordTypeLit {
		w.Raw = append(w.Raw, ch)
		return
	}
	if w.Type == WordTypeDQ || w.Type == WordTypeDDQ || w.Type == WordTypeSimpleVar || w.Type == WordTypeVarBrace || w.Type == WordTypeSQ || w.Type == WordTypeDSQ {
		w.Raw = append(w.Raw[0:len(w.Raw)-1], ch, w.Raw[len(w.Raw)-1])
		return
	}
	panic(fmt.Sprintf("cannot extend type %q", w.Type))
}

func (w *wordType) cloneRaw() {
	if len(w.Raw) == 0 {
		return
	}
	buf := make([]rune, 0, len(w.Raw))
	w.Raw = append(buf, w.Raw...)
}

type extendContext struct {
	QC        quoteContext
	Rtn       []*wordType
	CurWord   *wordType
	Intention string
}

func makeExtendContext(qc quoteContext, w *wordType, intention string) *extendContext {
	rtn := &extendContext{QC: qc, Intention: intention}
	if w != nil {
		w.cloneRaw()
		rtn.Rtn = []*wordType{w}
		rtn.CurWord = w
	}
	return rtn
}

func (ec *extendContext) appendWord(w *wordType) {
	ec.Rtn = append(ec.Rtn, w)
	ec.CurWord = w
}

func (ec *extendContext) extend(ch rune) {
	if ch == 0 {
		return
	}
	if ec.CurWord == nil {
		ec.CurWord = &wordType{Type: WordTypeLit, QC: ec.QC}
		ec.Rtn = append(ec.Rtn, ec.CurWord)
	}
	switch ec.CurWord.Type {
	case WordTypeSimpleVar:

	case WordTypeDQ, WordTypeDDQ:

	case WordTypeVarBrace:

	case WordTypeSQ:
		ec.extendSQ(ch)

	case WordTypeDSQ:

	case WordTypeLit:

	default:

	}
}

func getSpecialEscape(ch rune) string {
	if ch > unicode.MaxASCII {
		return ""
	}
	return specialEsc[byte(ch)]
}

func (ec *extendContext) extendSQ(ch rune) {
	if ch == 0 {
		return
	}
	if ch == '\'' {
		litWord := &wordType{Type: WordTypeLit, QC: ec.QC}
		litWord.Raw = []rune{'\\', '\''}
		ec.appendWord(litWord)
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		dsqWord := &wordType{Type: WordTypeDSQ, QC: ec.QC}
		dsqWord.Raw = []rune{'$', '\'', '\''}
		ec.appendWord(dsqWord)
		sesc := getSpecialEscape(ch)
		if sesc != "" {
			dsqWord.writeString(sesc)
			return
		} else {
			utf8Lit := getUtf8Literal(ch)
			dsqWord.writeString(utf8Lit)
		}
	}
	ec.CurWord.writeRune(ch)
}
