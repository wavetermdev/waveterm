// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"math"
	mathrand "math/rand"
	"os"
	"os/exec"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"text/template"
	"time"
	"unicode/utf8"
)

var HexDigits = []byte{'0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'}
var PTLoc *time.Location

func init() {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		loc = time.FixedZone("PT", -8*60*60)
	}
	PTLoc = loc
}

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

// converts an int, int64, or float64 to an int64
// nil or bad type returns 0
func ConvertInt(val any) int64 {
	if val == 0 {
		return 0
	}
	switch typedVal := val.(type) {
	case int:
		return int64(typedVal)
	case int64:
		return typedVal
	case float64:
		return int64(typedVal)
	default:
		return 0
	}
}

func ConvertMap(val any) map[string]any {
	if val == nil {
		return nil
	}
	m, ok := val.(map[string]any)
	if !ok {
		return nil
	}
	return m
}

var needsQuoteRe = regexp.MustCompile(`[^\w@%:,./=+-]`)

// minimum maxlen=6, pass -1 for no max length
func ShellQuote(val string, forceQuote bool, maxLen int) string {
	if maxLen != -1 && maxLen < 6 {
		maxLen = 6
	}
	rtn := val
	if needsQuoteRe.MatchString(val) {
		rtn = "'" + strings.ReplaceAll(val, "'", `'"'"'`) + "'"
	} else if forceQuote {
		rtn = "\"" + rtn + "\""
	}
	if maxLen == -1 || len(rtn) <= maxLen {
		return rtn
	}
	if strings.HasPrefix(rtn, "\"") || strings.HasPrefix(rtn, "'") {
		return rtn[0:maxLen-4] + "..." + rtn[len(rtn)-1:]
	}
	return rtn[0:maxLen-3] + "..."
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

func TruncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen < 4 {
		maxLen = 4
	}
	return s[:maxLen-3] + "..."
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

// sentinel value for StrWithPos.Pos to indicate no position
const NoStrPos = -1

type StrWithPos struct {
	Str string `json:"str"`
	Pos int    `json:"pos"` // this is a 'rune' position (not a byte position)
}

func (sp StrWithPos) String() string {
	return strWithCursor(sp.Str, sp.Pos)
}

func ParseToSP(s string) StrWithPos {
	idx := strings.Index(s, "[*]")
	if idx == -1 {
		return StrWithPos{Str: s, Pos: NoStrPos}
	}
	return StrWithPos{Str: s[0:idx] + s[idx+3:], Pos: utf8.RuneCountInString(s[0:idx])}
}

func strWithCursor(str string, pos int) string {
	if pos == NoStrPos {
		return str
	}
	if pos < 0 {
		// invalid position
		return "[*]_" + str
	}
	if pos > len(str) {
		// invalid position
		return str + "_[*]"
	}
	if pos == len(str) {
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

func StrsEqual(s1arr []string, s2arr []string) bool {
	if len(s1arr) != len(s2arr) {
		return false
	}
	for i, s1 := range s1arr {
		s2 := s2arr[i]
		if s1 != s2 {
			return false
		}
	}
	return true
}

func StrMapsEqual(m1 map[string]string, m2 map[string]string) bool {
	if len(m1) != len(m2) {
		return false
	}
	for key, val1 := range m1 {
		val2, found := m2[key]
		if !found || val1 != val2 {
			return false
		}
	}
	for key := range m2 {
		_, found := m1[key]
		if !found {
			return false
		}
	}
	return true
}

func ByteMapsEqual(m1 map[string][]byte, m2 map[string][]byte) bool {
	if len(m1) != len(m2) {
		return false
	}
	for key, val1 := range m1 {
		val2, found := m2[key]
		if !found || !bytes.Equal(val1, val2) {
			return false
		}
	}
	for key := range m2 {
		_, found := m1[key]
		if !found {
			return false
		}
	}
	return true
}

func GetOrderedStringerMapKeys[K interface {
	comparable
	fmt.Stringer
}, V any](m map[K]V) []K {
	keyStrMap := make(map[K]string)
	keys := make([]K, 0, len(m))
	for key := range m {
		keys = append(keys, key)
		keyStrMap[key] = key.String()
	}
	sort.Slice(keys, func(i, j int) bool {
		return keyStrMap[keys[i]] < keyStrMap[keys[j]]
	})
	return keys
}

func GetOrderedMapKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

const (
	nullEncodeEscByte     = '\\'
	nullEncodeSepByte     = '|'
	nullEncodeEqByte      = '='
	nullEncodeZeroByteEsc = '0'
	nullEncodeEscByteEsc  = '\\'
	nullEncodeSepByteEsc  = 's'
	nullEncodeEqByteEsc   = 'e'
)

func EncodeStringMap(m map[string]string) []byte {
	var buf bytes.Buffer
	for idx, key := range GetOrderedMapKeys(m) {
		val := m[key]
		buf.Write(NullEncodeStr(key))
		buf.WriteByte(nullEncodeEqByte)
		buf.Write(NullEncodeStr(val))
		if idx < len(m)-1 {
			buf.WriteByte(nullEncodeSepByte)
		}
	}
	return buf.Bytes()
}

func DecodeStringMap(barr []byte) (map[string]string, error) {
	if len(barr) == 0 {
		return nil, nil
	}
	var rtn = make(map[string]string)
	for _, b := range bytes.Split(barr, []byte{nullEncodeSepByte}) {
		keyVal := bytes.SplitN(b, []byte{nullEncodeEqByte}, 2)
		if len(keyVal) != 2 {
			return nil, fmt.Errorf("invalid null encoding: %s", string(b))
		}
		key, err := NullDecodeStr(keyVal[0])
		if err != nil {
			return nil, err
		}
		val, err := NullDecodeStr(keyVal[1])
		if err != nil {
			return nil, err
		}
		rtn[key] = val
	}
	return rtn, nil
}

func EncodeStringArray(arr []string) []byte {
	var buf bytes.Buffer
	for idx, s := range arr {
		buf.Write(NullEncodeStr(s))
		if idx < len(arr)-1 {
			buf.WriteByte(nullEncodeSepByte)
		}
	}
	return buf.Bytes()
}

func DecodeStringArray(barr []byte) ([]string, error) {
	if len(barr) == 0 {
		return nil, nil
	}
	var rtn []string
	for _, b := range bytes.Split(barr, []byte{nullEncodeSepByte}) {
		s, err := NullDecodeStr(b)
		if err != nil {
			return nil, err
		}
		rtn = append(rtn, s)
	}
	return rtn, nil
}

func EncodedStringArrayHasFirstVal(encoded []byte, firstKey string) bool {
	firstKeyBytes := NullEncodeStr(firstKey)
	if !bytes.HasPrefix(encoded, firstKeyBytes) {
		return false
	}
	if len(encoded) == len(firstKeyBytes) || encoded[len(firstKeyBytes)] == nullEncodeSepByte {
		return true
	}
	return false
}

// on encoding error returns ""
// this is used to perform logic on first value without decoding the entire array
func EncodedStringArrayGetFirstVal(encoded []byte) string {
	sepIdx := bytes.IndexByte(encoded, nullEncodeSepByte)
	if sepIdx == -1 {
		str, _ := NullDecodeStr(encoded)
		return str
	}
	str, _ := NullDecodeStr(encoded[0:sepIdx])
	return str
}

// encodes a string, removing null/zero bytes (and separators '|')
// a zero byte is encoded as "\0", a '\' is encoded as "\\", sep is encoded as "\s"
// allows for easy double splitting (first on \x00, and next on "|")
func NullEncodeStr(s string) []byte {
	strBytes := []byte(s)
	if bytes.IndexByte(strBytes, 0) == -1 &&
		bytes.IndexByte(strBytes, nullEncodeEscByte) == -1 &&
		bytes.IndexByte(strBytes, nullEncodeSepByte) == -1 &&
		bytes.IndexByte(strBytes, nullEncodeEqByte) == -1 {
		return strBytes
	}
	var rtn []byte
	for _, b := range strBytes {
		if b == 0 {
			rtn = append(rtn, nullEncodeEscByte, nullEncodeZeroByteEsc)
		} else if b == nullEncodeEscByte {
			rtn = append(rtn, nullEncodeEscByte, nullEncodeEscByteEsc)
		} else if b == nullEncodeSepByte {
			rtn = append(rtn, nullEncodeEscByte, nullEncodeSepByteEsc)
		} else if b == nullEncodeEqByte {
			rtn = append(rtn, nullEncodeEscByte, nullEncodeEqByteEsc)
		} else {
			rtn = append(rtn, b)
		}
	}
	return rtn
}

func NullDecodeStr(barr []byte) (string, error) {
	if bytes.IndexByte(barr, nullEncodeEscByte) == -1 {
		return string(barr), nil
	}
	var rtn []byte
	for i := 0; i < len(barr); i++ {
		curByte := barr[i]
		if curByte == nullEncodeEscByte {
			i++
			nextByte := barr[i]
			if nextByte == nullEncodeZeroByteEsc {
				rtn = append(rtn, 0)
			} else if nextByte == nullEncodeEscByteEsc {
				rtn = append(rtn, nullEncodeEscByte)
			} else if nextByte == nullEncodeSepByteEsc {
				rtn = append(rtn, nullEncodeSepByte)
			} else if nextByte == nullEncodeEqByteEsc {
				rtn = append(rtn, nullEncodeEqByte)
			} else {
				// invalid encoding
				return "", fmt.Errorf("invalid null encoding: %d", nextByte)
			}
		} else {
			rtn = append(rtn, curByte)
		}
	}
	return string(rtn), nil
}

func SortStringRunes(s string) string {
	runes := []rune(s)
	sort.Slice(runes, func(i, j int) bool {
		return runes[i] < runes[j]
	})
	return string(runes)
}

// will overwrite m1 with m2's values
func CombineMaps[V any](m1 map[string]V, m2 map[string]V) {
	for key, val := range m2 {
		m1[key] = val
	}
}

// returns hex escaped string (\xNN for each byte)
func ShellHexEscape(s string) string {
	var rtn []byte
	for _, ch := range []byte(s) {
		rtn = append(rtn, []byte(fmt.Sprintf("\\x%02x", ch))...)
	}
	return string(rtn)
}

func GetMapKeys[K comparable, V any](m map[K]V) []K {
	var rtn []K
	for key := range m {
		rtn = append(rtn, key)
	}
	return rtn
}

// combines string arrays and removes duplicates (returns a new array)
func CombineStrArrays(sarr1 []string, sarr2 []string) []string {
	var rtn []string
	m := make(map[string]struct{})
	for _, s := range sarr1 {
		if _, found := m[s]; found {
			continue
		}
		m[s] = struct{}{}
		rtn = append(rtn, s)
	}
	for _, s := range sarr2 {
		if _, found := m[s]; found {
			continue
		}
		m[s] = struct{}{}
		rtn = append(rtn, s)
	}
	return rtn
}

func StrSetIntersection(s1 []string, s2 []string) []string {
	set := make(map[string]bool)
	for _, s := range s1 {
		set[s] = true
	}
	var rtn []string
	for _, s := range s2 {
		if set[s] {
			rtn = append(rtn, s)
		}
	}
	return rtn
}

func QuickJson(v interface{}) string {
	barr, _ := json.Marshal(v)
	return string(barr)
}

func QuickParseJson[T any](s string) T {
	var v T
	_ = json.Unmarshal([]byte(s), &v)
	return v
}

func StrArrayToMap(sarr []string) map[string]bool {
	m := make(map[string]bool)
	for _, s := range sarr {
		m[s] = true
	}
	return m
}

func AppendNonZeroRandomBytes(b []byte, randLen int) []byte {
	if randLen <= 0 {
		return b
	}
	numAdded := 0
	for numAdded < randLen {
		rn := mathrand.Intn(256)
		if rn > 0 && rn < 256 { // exclude 0, also helps to suppress security warning to have a guard here
			b = append(b, byte(rn))
			numAdded++
		}
	}
	return b
}

// returns (isEOF, error)
func CopyWithEndBytes(outputBuf *bytes.Buffer, reader io.Reader, endBytes []byte) (bool, error) {
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			outputBuf.Write(buf[:n])
			obytes := outputBuf.Bytes()
			if bytes.HasSuffix(obytes, endBytes) {
				outputBuf.Truncate(len(obytes) - len(endBytes))
				return (err == io.EOF), nil
			}
		}
		if err == io.EOF {
			return true, nil
		}
		if err != nil {
			return false, err
		}
	}
}

// does *not* close outputCh on EOF or error
func CopyToChannel(outputCh chan<- []byte, reader io.Reader) error {
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			// copy so client can use []byte without it being overwritten
			bufCopy := make([]byte, n)
			copy(bufCopy, buf[:n])
			outputCh <- bufCopy
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func GetCmdExitCode(cmd *exec.Cmd, err error) int {
	if cmd == nil || cmd.ProcessState == nil {
		return GetExitCode(err)
	}
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok {
		return cmd.ProcessState.ExitCode()
	}
	signaled := status.Signaled()
	if signaled {
		signal := status.Signal()
		return 128 + int(signal)
	}
	exitStatus := status.ExitStatus()
	return exitStatus
}

func GetExitCode(err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	} else {
		return -1
	}
}

func GetFirstLine(s string) string {
	idx := strings.Index(s, "\n")
	if idx == -1 {
		return s
	}
	return s[0:idx]
}

func JsonMapToStruct(m map[string]any, v interface{}) error {
	barr, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return json.Unmarshal(barr, v)
}

func StructToJsonMap(v interface{}) (map[string]any, error) {
	barr, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	err = json.Unmarshal(barr, &m)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func IndentString(indent string, str string) string {
	splitArr := strings.Split(str, "\n")
	var rtn strings.Builder
	for _, line := range splitArr {
		if line == "" {
			rtn.WriteByte('\n')
			continue
		}
		rtn.WriteString(indent)
		rtn.WriteString(line)
		rtn.WriteByte('\n')
	}
	return rtn.String()
}

func SliceIdx[T comparable](arr []T, elem T) int {
	for idx, e := range arr {
		if e == elem {
			return idx
		}
	}
	return -1
}

// removes an element from a slice and modifies the original slice (the backing elements)
// if it removes the last element from the slice, it will return nil so we free the original slice's backing memory
func RemoveElemFromSlice[T comparable](arr []T, elem T) []T {
	idx := SliceIdx(arr, elem)
	if idx == -1 {
		return arr
	}
	if len(arr) == 1 {
		return nil
	}
	return append(arr[:idx], arr[idx+1:]...)
}

func AddElemToSliceUniq[T comparable](arr []T, elem T) []T {
	if SliceIdx(arr, elem) != -1 {
		return arr
	}
	return append(arr, elem)
}

func MoveSliceIdxToFront[T any](arr []T, idx int) []T {
	// create and return a new slice with idx moved to the front
	if idx == 0 || idx >= len(arr) {
		// make a copy still
		return append([]T(nil), arr...)
	}
	rtn := make([]T, 0, len(arr))
	rtn = append(rtn, arr[idx])
	rtn = append(rtn, arr[0:idx]...)
	rtn = append(rtn, arr[idx+1:]...)
	return rtn
}

// matches a delimited string with a pattern string
// the pattern string can contain "*" to match a single part, or "**" to match the rest of the string
// note that "**" may only appear at the end of the string
func StarMatchString(pattern string, s string, delimiter string) bool {
	patternParts := strings.Split(pattern, delimiter)
	stringParts := strings.Split(s, delimiter)
	pLen, sLen := len(patternParts), len(stringParts)

	for i := 0; i < pLen; i++ {
		if patternParts[i] == "**" {
			// '**' must be at the end to be valid
			return i == pLen-1
		}
		if i >= sLen {
			// If string is exhausted but pattern is not
			return false
		}
		if patternParts[i] != "*" && patternParts[i] != stringParts[i] {
			// If current parts don't match and pattern part is not '*'
			return false
		}
	}
	// Check if both pattern and string are fully matched
	return pLen == sLen
}

func MergeStrMaps[T any](m1 map[string]T, m2 map[string]T) map[string]T {
	rtn := make(map[string]T)
	for key, val := range m1 {
		rtn[key] = val
	}
	for key, val := range m2 {
		rtn[key] = val
	}
	return rtn
}

func AtomicRenameCopy(dstPath string, srcPath string, perms os.FileMode) error {
	// first copy the file to dstPath.new, then rename into place
	srcFd, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer srcFd.Close()
	tempName := dstPath + ".new"
	dstFd, err := os.Create(tempName)
	if err != nil {
		return err
	}
	_, err = io.Copy(dstFd, srcFd)
	if err != nil {
		dstFd.Close()
		return err
	}
	err = dstFd.Close()
	if err != nil {
		return err
	}
	err = os.Chmod(tempName, perms)
	if err != nil {
		return err
	}
	err = os.Rename(tempName, dstPath)
	if err != nil {
		return err
	}
	return nil
}

func AtoiNoErr(str string) int {
	val, err := strconv.Atoi(str)
	if err != nil {
		return 0
	}
	return val
}

func WriteTemplateToFile(fileName string, templateText string, vars map[string]string) error {
	outBuffer := &bytes.Buffer{}
	template.Must(template.New("").Parse(templateText)).Execute(outBuffer, vars)
	return os.WriteFile(fileName, outBuffer.Bytes(), 0644)
}

// every byte is 4-bits of randomness
func RandomHexString(numHexDigits int) (string, error) {
	numBytes := (numHexDigits + 1) / 2 // Calculate the number of bytes needed
	bytes := make([]byte, numBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	hexStr := hex.EncodeToString(bytes)
	return hexStr[:numHexDigits], nil // Return the exact number of hex digits
}

func GetJsonTag(field reflect.StructField) string {
	jsonTag := field.Tag.Get("json")
	if jsonTag == "" {
		return ""
	}
	commaIdx := strings.Index(jsonTag, ",")
	if commaIdx != -1 {
		jsonTag = jsonTag[:commaIdx]
	}
	return jsonTag
}

func WriteFileIfDifferent(fileName string, contents []byte) (bool, error) {
	oldContents, err := os.ReadFile(fileName)
	if err == nil && bytes.Equal(oldContents, contents) {
		return false, nil
	}
	err = os.WriteFile(fileName, contents, 0644)
	if err != nil {
		return false, err
	}
	return true, nil
}

func GetLineColFromOffset(barr []byte, offset int) (int, int) {
	line := 1
	col := 1
	for i := 0; i < offset && i < len(barr); i++ {
		if barr[i] == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return line, col
}

func FindStringInSlice(slice []string, val string) int {
	for idx, v := range slice {
		if v == val {
			return idx
		}
	}
	return -1
}

func FormatLsTime(t time.Time) string {
	now := time.Now()
	sixMonthsAgo := now.AddDate(0, -6, 0)

	if t.After(sixMonthsAgo) {
		// Recent files: "Nov 18 18:40"
		return t.Format("Jan _2 15:04")
	} else {
		// Older files: "Apr 12  2025"
		return t.Format("Jan _2  2006")
	}
}

/**
 * Helper function that will deref a pointer if not null
 * but returns a default value if it is null.
 */
func SafeDeref[T any](x *T) T {
	if x == nil {
		var safeOut T
		return safeOut
	}
	return *x
}

/**
 * Utility function for referencing a type with a pointer.
 * This is the same as dereferencing with &, but unlike &
 * you can directly use it on the ouput of a function
 * without needing to create an intermediate variable
 */
func Ptr[T any](x T) *T {
	return &x
}

/**
 * Utility function to convert know architecture patterns
 * to the patterns we use. It returns an error if the
 * provided name is unknown
 */
func FilterValidArch(arch string) (string, error) {
	formatted := strings.TrimSpace(strings.ToLower(arch))
	switch formatted {
	case "amd64":
		return "x64", nil
	case "x86_64":
		return "x64", nil
	case "x64":
		return "x64", nil
	case "arm64":
		return "arm64", nil
	}
	return "", fmt.Errorf("unknown architecture: %s", formatted)
}

func ConvertUUIDv4Tov7(uuidv4 string) (string, error) {
	// Parse the UUIDv4
	parts := strings.Split(uuidv4, "-")
	if len(parts) != 5 {
		return "", fmt.Errorf("invalid UUIDv4 format")
	}

	// Section 1 and 2: Fixed timestamp for Jan 1, 2024
	section1 := "01823a80" // High 32 bits of the timestamp
	section2 := "0000"     // Middle 16 bits of the timestamp

	// Section 3: Version (7) and the last 3 bytes of randomness from UUIDv4
	section3 := "7" + parts[2][1:] // Replace the first nibble with '7' for version

	// Section 4 and 5: Copy from the original UUIDv4
	section4 := parts[3]
	section5 := parts[4]

	// Combine sections to form UUIDv7
	uuidv7 := fmt.Sprintf("%s-%s-%s-%s-%s", section1, section2, section3, section4, section5)
	return uuidv7, nil
}

func TimeoutFromContext(ctx context.Context, defaultTimeout time.Duration) time.Duration {
	deadline, ok := ctx.Deadline()
	if !ok {
		return defaultTimeout
	}
	return time.Until(deadline)
}

func HasBinaryData(data []byte) bool {
	for _, b := range data {
		if b < 32 && b != '\n' && b != '\r' && b != '\t' && b != '\f' && b != '\b' {
			return true
		}
	}
	return false
}

func DumpGoRoutineStacks(w io.Writer) {
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true)
	w.Write(buf[:n])
}

func ConvertToWallClockPT(t time.Time) time.Time {
	year, month, day := t.Date()
	hour, min, sec := t.Clock()
	pstTime := time.Date(year, month, day, hour, min, sec, 0, PTLoc)
	return pstTime
}

func QuickHashString(s string) string {
	h := fnv.New64a()
	h.Write([]byte(s))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func SendWithCtxCheck[T any](ctx context.Context, ch chan<- T, val T) bool {
	select {
	case <-ctx.Done():
		return false
	case ch <- val:
		return true
	}
}

const (
	maxRetries = 5
	retryDelay = 10 * time.Millisecond
)

func GracefulClose(closer io.Closer, debugName, closerName string) bool {
	closed := false
	for retries := 0; retries < maxRetries; retries++ {
		if err := closer.Close(); err != nil {
			log.Printf("%s: error closing %s: %v, trying again in %dms\n", debugName, closerName, err, retryDelay.Milliseconds())
			time.Sleep(retryDelay)
			continue
		}
		closed = true
		break
	}
	if !closed {
		log.Printf("%s: unable to close %s after %d retries\n", debugName, closerName, maxRetries)
	}
	return closed
}

// DrainChannelSafe will drain a channel until it is empty or until a timeout is reached.
func DrainChannelSafe[T any](ch <-chan T, debugName string) {
	drainTimeoutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	go func() {
		defer cancel()
	outer:
		for {
			select {
			case <-drainTimeoutCtx.Done():
				log.Printf("[error] timeout draining channel: %s\n", debugName)
				break outer
			case _, ok := <-ch:
				if !ok {
					return
				}
			}
		}
	}()
}


func IsBinaryContent(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	sampleSize := min(8192, len(data))
	sample := data[:sampleSize]
	
	nullCount := 0
	for _, b := range sample {
		if b == 0 {
			nullCount++
		}
	}
	if float64(nullCount)/float64(len(sample)) > 0.01 {
		return true
	}
	
	if !utf8.Valid(sample) {
		return true
	}
	
	return false
}

func FormatRelativeTime(modTime time.Time) string {
	now := time.Now()
	diff := now.Sub(modTime)
	
	if diff < time.Minute {
		return "just now"
	}
	if diff < time.Hour {
		minutes := int(diff.Minutes())
		if minutes == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", minutes)
	}
	if diff < 24*time.Hour {
		hours := int(diff.Hours())
		if hours == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", hours)
	}
	if diff < 30*24*time.Hour {
		days := int(diff.Hours() / 24)
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)
	}
	if diff < 365*24*time.Hour {
		months := int(diff.Hours() / 24 / 30)
		if months == 1 {
			return "1 month ago"
		}
		return fmt.Sprintf("%d months ago", months)
	}
	years := int(diff.Hours() / 24 / 365)
	if years == 1 {
		return "1 year ago"
	}
	return fmt.Sprintf("%d years ago", years)
}
