package utilfn

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var HexDigits = []byte{'0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'}

func GetStrArr(v interface{}, field string) []string {
	if v == nil {
		return nil
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	fieldVal := m[field]
	if fieldVal == nil {
		return nil
	}
	iarr, ok := fieldVal.([]interface{})
	if !ok {
		return nil
	}
	var sarr []string
	for _, iv := range iarr {
		if sv, ok := iv.(string); ok {
			sarr = append(sarr, sv)
		}
	}
	return sarr
}

func GetBool(v interface{}, field string) bool {
	if v == nil {
		return false
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return false
	}
	fieldVal := m[field]
	if fieldVal == nil {
		return false
	}
	bval, ok := fieldVal.(bool)
	if !ok {
		return false
	}
	return bval
}

var needsQuoteRe = regexp.MustCompile(`[^\w@%:,./=+-]`)

// minimum maxlen=6
func ShellQuote(val string, forceQuote bool, maxLen int) string {
	if maxLen < 6 {
		maxLen = 6
	}
	rtn := val
	if needsQuoteRe.MatchString(val) {
		rtn = "'" + strings.ReplaceAll(val, "'", `'"'"'`) + "'"
	}
	if strings.HasPrefix(rtn, "\"") || strings.HasPrefix(rtn, "'") {
		if len(rtn) > maxLen {
			return rtn[0:maxLen-4] + "..." + rtn[0:1]
		}
		return rtn
	}
	if forceQuote {
		if len(rtn) > maxLen-2 {
			return "\"" + rtn[0:maxLen-5] + "...\""
		}
		return "\"" + rtn + "\""
	} else {
		if len(rtn) > maxLen {
			return rtn[0:maxLen-3] + "..."
		}
		return rtn
	}
}

func LongestPrefix(root string, strs []string) string {
	if len(strs) == 0 {
		return root
	}
	if len(strs) == 1 {
		comp := strs[0]
		if len(comp) >= len(root) && strings.HasPrefix(comp, root) {
			if strings.HasSuffix(comp, "/") {
				return strs[0]
			}
			return strs[0]
		}
	}
	lcp := strs[0]
	for i := 1; i < len(strs); i++ {
		s := strs[i]
		for j := 0; j < len(lcp); j++ {
			if j >= len(s) || lcp[j] != s[j] {
				lcp = lcp[0:j]
				break
			}
		}
	}
	if len(lcp) < len(root) || !strings.HasPrefix(lcp, root) {
		return root
	}
	return lcp
}

func ContainsStr(strs []string, test string) bool {
	for _, s := range strs {
		if s == test {
			return true
		}
	}
	return false
}

type StrWithPos struct {
	Str string
	Pos int // this is a 'rune' position (not a byte position)
}

func (sp StrWithPos) String() string {
	return strWithCursor(sp.Str, sp.Pos)
}

func ParseToSP(s string) StrWithPos {
	idx := strings.Index(s, "[*]")
	if idx == -1 {
		return StrWithPos{Str: s}
	}
	return StrWithPos{Str: s[0:idx] + s[idx+3:], Pos: utf8.RuneCountInString(s[0:idx])}
}

func strWithCursor(str string, pos int) string {
	if pos < 0 {
		return "[*]_" + str
	}
	if pos >= len(str) {
		if pos > len(str) {
			return str + "_[*]"
		}
		return str + "[*]"
	}

	var rtn []rune
	for _, ch := range str {
		if len(rtn) == pos {
			rtn = append(rtn, '[', '*', ']')
		}
		rtn = append(rtn, ch)
	}
	return string(rtn)
}
