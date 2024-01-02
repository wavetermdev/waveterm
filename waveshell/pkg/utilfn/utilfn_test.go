// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"fmt"
	"math"
	"testing"
)

const Str1 = `
hello
line #2
more
stuff
apple
`

const Str2 = `
line #2
apple
grapes
banana
`

const Str3 = `
more
stuff
banana
coconut
`

func testDiff(t *testing.T, str1 string, str2 string) {
	diffBytes := MakeDiff(str1, str2)
	fmt.Printf("diff-len: %d\n", len(diffBytes))
	out, err := ApplyDiff(str1, diffBytes)
	if err != nil {
		t.Errorf("error in diff: %v", err)
		return
	}
	if out != str2 {
		t.Errorf("bad diff output")
	}
}

func TestDiff(t *testing.T) {
	testDiff(t, Str1, Str2)
	testDiff(t, Str2, Str3)
	testDiff(t, Str1, Str3)
	testDiff(t, Str3, Str1)
}

func testArithmetic(t *testing.T, fn func() (int, error), shouldError bool, expected int) {
	retVal, err := fn()
	if err != nil {
		if !shouldError {
			t.Errorf("unexpected error")
		}
		return
	}
	if shouldError {
		t.Errorf("expected error")
		return
	}
	if retVal != expected {
		t.Errorf("wrong return value")
	}
}

func testAddInt(t *testing.T, shouldError bool, expected int, a int, b int) {
	testArithmetic(t, func() (int, error) { return AddInt(a, b) }, shouldError, expected)
}

func TestAddInt(t *testing.T) {
	testAddInt(t, false, 3, 1, 2)
	testAddInt(t, true, 0, 1, math.MaxInt)
	testAddInt(t, true, 0, math.MinInt, -1)
	testAddInt(t, false, math.MaxInt-1, math.MaxInt, -1)
	testAddInt(t, false, math.MinInt+1, math.MinInt, 1)
	testAddInt(t, false, math.MaxInt, math.MaxInt, 0)
	testAddInt(t, true, 0, math.MinInt, -1)
}

func testAddIntSlice(t *testing.T, shouldError bool, expected int, vals ...int) {
	testArithmetic(t, func() (int, error) { return AddIntSlice(vals...) }, shouldError, expected)
}

func TestAddIntSlice(t *testing.T) {
	testAddIntSlice(t, false, 0)
	testAddIntSlice(t, false, 1, 1)
	testAddIntSlice(t, false, 3, 1, 2)
	testAddIntSlice(t, false, 6, 1, 2, 3)
	testAddIntSlice(t, true, 0, 1, math.MaxInt)
	testAddIntSlice(t, true, 0, 1, 2, math.MaxInt)
	testAddIntSlice(t, true, 0, math.MaxInt, 2, 1)
	testAddIntSlice(t, false, math.MaxInt, 0, 0, math.MaxInt)
	testAddIntSlice(t, true, 0, math.MinInt, -1)
	testAddIntSlice(t, false, math.MaxInt, math.MaxInt-3, 1, 2)
	testAddIntSlice(t, true, 0, math.MaxInt-2, 1, 2)
	testAddIntSlice(t, false, math.MinInt, math.MinInt+3, -1, -2)
	testAddIntSlice(t, true, 0, math.MinInt+2, -1, -2)
}

func testNullEncodeStr(t *testing.T, str string, expected string) {
	encoded := NullEncodeStr(str)
	decoded, err := NullDecodeStr(encoded)
	if err != nil {
		t.Errorf("error in null encoding: %v", err)
	} else if decoded != str {
		t.Errorf("bad null encoding")
	}
	if string(encoded) != expected {
		t.Errorf("bad null encoding, %q != %q", str, expected)
	}
}

func TestNullEncodeStr(t *testing.T) {
	testNullEncodeStr(t, "", "")
	testNullEncodeStr(t, "hello", "hello")
	testNullEncodeStr(t, "hello\x00", "hello\\0")
	testNullEncodeStr(t, "abc|def", "abc\\sdef")
	testNullEncodeStr(t, "a|b\x00c\\d", "a\\sb\\0c\\\\d")
	testNullEncodeStr(t, "v==v", "v\\e\\ev")
}

func testEncodeStringArray(t *testing.T, strs []string) {
	encoded := EncodeStringArray(strs)
	decoded, err := DecodeStringArray(encoded)
	if err != nil {
		t.Errorf("error in string array encoding: %v", err)
	} else if !StrsEqual(strs, decoded) {
		t.Errorf("bad string array encoding: %#v != %#v", strs, decoded)
	}
}

func TestEncodeStringArray(t *testing.T) {
	testEncodeStringArray(t, nil)
	testEncodeStringArray(t, []string{})
	testEncodeStringArray(t, []string{"hello"})
	testEncodeStringArray(t, []string{"hello", "world=bar"})
	testEncodeStringArray(t, []string{"hello", "wor\x00ld", "fo|\\o", "N\\\x00|||ul==l"})
}

func testEncodeStringMap(t *testing.T, m map[string]string) {
	encoded := EncodeStringMap(m)
	decoded, err := DecodeStringMap(encoded)
	if err != nil {
		t.Errorf("error in string map encoding: %v", err)
	} else if !StrMapsEqual(m, decoded) {
		t.Errorf("bad string map encoding: %#v != %#v", m, decoded)
	}
}

func TestEncodeStringMap(t *testing.T) {
	testEncodeStringMap(t, nil)
	testEncodeStringMap(t, map[string]string{})
	testEncodeStringMap(t, map[string]string{"hello": "world"})
	testEncodeStringMap(t, map[string]string{"hello": "world", "foo": "bar"})
	testEncodeStringMap(t, map[string]string{"hello": "world", "fo=o": "b=ar", "a|b": "c\\d"})
	testEncodeStringMap(t, map[string]string{"hello\x00|": "w\x00orld", "foo": "bar", "a|b": "c\\d", "v==v": "v\\e\\ev"})
}
