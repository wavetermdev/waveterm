package shparse

import (
	"bytes"
	"unicode"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/utilfn"
)

var noEscChars []bool
var specialEsc []string

func init() {
	noEscChars = make([]bool, 256)
	for ch := 0; ch < 256; ch++ {
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			ch == '-' || ch == '.' || ch == '/' || ch == ':' || ch == '=' || ch == '_' {
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
func extendWithSubs(word *WordType, wordPos int, extStr string, complete bool) utilfn.StrWithPos {
	wmeta := wordMetaMap[word.Type]
	if word.Type == WordTypeGroup {
		atEnd := (wordPos == len(word.Raw))
		subWord := findCompletionWordAtPos(word.Subs, wordPos, true)
		if subWord == nil {
			strPos := Extend(MakeEmptyWord(WordTypeLit, word.QC, 0, true), 0, extStr, atEnd)
			strPos = strPos.Prepend(string(word.Raw[0:wordPos]))
			strPos = strPos.Append(string(word.Raw[wordPos:]))
			return strPos
		} else {
			subComplete := complete && atEnd
			strPos := Extend(subWord, wordPos-subWord.Offset, extStr, subComplete)
			strPos = strPos.Prepend(string(word.Raw[0:subWord.Offset]))
			strPos = strPos.Append(string(word.Raw[subWord.Offset+len(subWord.Raw):]))
			return strPos
		}
	} else if word.Type == WordTypeDQ || word.Type == WordTypeDDQ {
		if wordPos < word.contentStartPos() {
			wordPos = word.contentStartPos()
		}
		atEnd := (wordPos >= len(word.Raw)-wmeta.SuffixLen)
		subWord := findCompletionWordAtPos(word.Subs, wordPos-wmeta.PrefixLen, true)
		quoteBalance := !atEnd
		if subWord == nil {
			realOffset := wordPos
			strPos, wordOpen := extendInternal(MakeEmptyWord(WordTypeLit, word.QC.push(WordTypeDQ), 0, true), 0, extStr, false, quoteBalance)
			strPos = strPos.Prepend(string(word.Raw[0:realOffset]))
			var requiredSuffix string
			if wordOpen {
				requiredSuffix = wmeta.getSuffix()
			}
			if atEnd {
				if complete {
					return utilfn.StrWithPos{Str: strPos.Str + requiredSuffix + " ", Pos: strPos.Pos + len(requiredSuffix) + 1}
				} else {
					if word.Complete && requiredSuffix != "" {
						return strPos.Append(requiredSuffix)
					}
					return strPos
				}
			}
			strPos = strPos.Append(string(word.Raw[wordPos:]))
			return strPos
		} else {
			realOffset := subWord.Offset + wmeta.PrefixLen
			strPos, wordOpen := extendInternal(subWord, wordPos-realOffset, extStr, false, quoteBalance)
			strPos = strPos.Prepend(string(word.Raw[0:realOffset]))
			var requiredSuffix string
			if wordOpen {
				requiredSuffix = wmeta.getSuffix()
			}
			if atEnd {
				if complete {
					return utilfn.StrWithPos{Str: strPos.Str + requiredSuffix + " ", Pos: strPos.Pos + len(requiredSuffix) + 1}
				} else {
					if word.Complete && requiredSuffix != "" {
						return strPos.Append(requiredSuffix)
					}
					return strPos
				}
			}
			strPos = strPos.Append(string(word.Raw[realOffset+len(subWord.Raw):]))
			return strPos
		}
	} else {
		return utilfn.StrWithPos{Str: string(word.Raw), Pos: wordPos}
	}
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

func getWordOpenStr(wtype string, qc QuoteContext) string {
	if wtype == WordTypeLit {
		if qc.cur() == WordTypeDQ {
			return "\""
		} else {
			return ""
		}
	}
	wmeta := wordMetaMap[wtype]
	return wmeta.getPrefix()
}

// lit, svar, varb sq, dsq
func extendLeaf(buf *bytes.Buffer, wordOpen *bool, word *WordType, wordPos int, extStr string) {
	for _, ch := range extStr {
		extendLeafCh(buf, wordOpen, word.Type, word.QC, ch)
	}
}

// lit, grp, svar, dq, ddq, varb, sq, dsq
// returns (strwithpos, dq-closed)
func extendInternal(word *WordType, wordPos int, extStr string, complete bool, requiresQuoteBalance bool) (utilfn.StrWithPos, bool) {
	if extStr == "" {
		return utilfn.StrWithPos{Str: string(word.Raw), Pos: wordPos}, true
	}
	if word.canHaveSubs() {
		return extendWithSubs(word, wordPos, extStr, complete), true
	}
	var buf bytes.Buffer
	isEOW := wordPos >= word.contentEndPos()
	if isEOW {
		wordPos = word.contentEndPos()
	}
	if wordPos < word.contentStartPos() {
		wordPos = word.contentStartPos()
	}
	if wordPos > 0 {
		buf.WriteString(string(word.Raw[0:word.contentStartPos()])) // write the prefix
	}
	if wordPos > word.contentStartPos() {
		buf.WriteString(string(word.Raw[word.contentStartPos():wordPos]))
	}
	wordOpen := true
	extendLeaf(&buf, &wordOpen, word, wordPos, extStr)
	if isEOW {
		// end-of-word, write the suffix (and optional ' ').  return the end of the string
		wmeta := wordMetaMap[word.Type]
		rtnPos := utf8.RuneCount(buf.Bytes())
		buf.WriteString(wmeta.getSuffix())
		if !wordOpen && requiresQuoteBalance {
			buf.WriteString(getWordOpenStr(word.Type, word.QC))
			wordOpen = true
		}
		if complete {
			buf.WriteRune(' ')
			return utilfn.StrWithPos{Str: buf.String(), Pos: utf8.RuneCount(buf.Bytes())}, wordOpen
		} else {
			return utilfn.StrWithPos{Str: buf.String(), Pos: rtnPos}, wordOpen
		}
	}
	// completion in the middle of a word (no ' ')
	rtnPos := utf8.RuneCount(buf.Bytes())
	if !wordOpen {
		// always required since there is a suffix
		buf.WriteString(getWordOpenStr(word.Type, word.QC))
		wordOpen = true
	}
	buf.WriteString(string(word.Raw[wordPos:])) // write the suffix
	return utilfn.StrWithPos{Str: buf.String(), Pos: rtnPos}, wordOpen
}

// lit, grp, svar, dq, ddq, varb, sq, dsq
func Extend(word *WordType, wordPos int, extStr string, complete bool) utilfn.StrWithPos {
	rtn, _ := extendInternal(word, wordPos, extStr, complete, false)
	return rtn
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

func writeSpecial(buf *bytes.Buffer, ch rune, wrap bool) {
	if wrap {
		buf.WriteRune('$')
		buf.WriteRune('\'')
	}
	sesc := getSpecialEscape(ch)
	if sesc != "" {
		buf.WriteString(sesc)
	} else {
		utf8Lit := getUtf8Literal(ch)
		buf.WriteString(utf8Lit)
	}
	if wrap {
		buf.WriteRune('\'')
	}
}

func extendLit(buf *bytes.Buffer, ch rune) {
	if ch == 0 {
		return
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		writeSpecial(buf, ch, true)
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
	if !*wordOpen {
		buf.WriteRune('$')
		buf.WriteRune('\'')
		*wordOpen = true
	}
	if ch > unicode.MaxASCII || !unicode.IsPrint(ch) {
		writeSpecial(buf, ch, false)
		return
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
		writeSpecial(buf, ch, true)
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
		writeSpecial(buf, ch, true)
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
