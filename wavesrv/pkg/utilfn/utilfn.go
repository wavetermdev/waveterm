// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"math"
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

func EllipsisStr(s string, maxLen int) string {
	if maxLen < 4 {
		maxLen = 4
	}
	if len(s) > maxLen {
		return s[0:maxLen-3] + "..."
	}
	return s
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

func IsPrefix(strs []string, test string) bool {
	for _, s := range strs {
		if len(s) > len(test) && strings.HasPrefix(s, test) {
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

func (sp StrWithPos) Prepend(str string) StrWithPos {
	return StrWithPos{Str: str + sp.Str, Pos: utf8.RuneCountInString(str) + sp.Pos}
}

func (sp StrWithPos) Append(str string) StrWithPos {
	return StrWithPos{Str: sp.Str + str, Pos: sp.Pos}
}

// returns base64 hash of data
func Sha1Hash(data []byte) string {
	hvalRaw := sha1.Sum(data)
	hval := base64.StdEncoding.EncodeToString(hvalRaw[:])
	return hval
}

func ChunkSlice[T any](s []T, chunkSize int) [][]T {
	var rtn [][]T
	for len(rtn) > 0 {
		if len(s) <= chunkSize {
			rtn = append(rtn, s)
			break
		}
		rtn = append(rtn, s[:chunkSize])
		s = s[chunkSize:]
	}
	return rtn
}

var ErrOverflow = errors.New("integer overflow")

// Add two int values, returning an error if the result overflows.
func AddInt(left, right int) (int, error) {
	if right > 0 {
		if left > math.MaxInt-right {
			return 0, ErrOverflow
		}
	} else {
		if left < math.MinInt-right {
			return 0, ErrOverflow
		}
	}
	return left + right, nil
}

// Add a slice of ints, returning an error if the result overflows.
func AddIntSlice(vals ...int) (int, error) {
	var rtn int
	for _, v := range vals {
		var err error
		rtn, err = AddInt(rtn, v)
		if err != nil {
			return 0, err
		}
	}
	return rtn, nil
}
