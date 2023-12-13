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

const unexpectedError = "unexpected error"
const expectedError = "expected error"
const wrongRetVal = "wrong return value"

func testAddInt(t *testing.T, a int, b int, shouldError bool, expected int) {
	retVal, err := AddInt(a, b)
	if err != nil {
		if !shouldError {
			t.Errorf(unexpectedError)
		}
		return
	}
	if shouldError {
		t.Errorf(expectedError)
		return
	}
	if retVal != expected {
		t.Errorf(wrongRetVal)
	}
}

func TestAddInt(t *testing.T) {
	testAddInt(t, 1, 2, false, 3)
	testAddInt(t, 1, math.MaxInt, true, 0)
}

func testAddIntSlice(t *testing.T, shouldError bool, expected int, vals ...int) {
	retVal, err := AddIntSlice(vals...)
	if err != nil {
		if !shouldError {
			t.Errorf(unexpectedError)
		}
		return
	}
	if shouldError {
		t.Errorf(expectedError)
		return
	}
	if retVal != expected {
		t.Errorf(wrongRetVal)
	}
}

func TestAddIntSlice(t *testing.T) {
	testAddIntSlice(t, false, 0)
	testAddIntSlice(t, false, 1, 1)
	testAddIntSlice(t, false, 3, 1, 2)
	testAddIntSlice(t, false, 6, 1, 2, 3)
	testAddIntSlice(t, true, 0, 1, math.MaxInt)
	testAddIntSlice(t, true, 0, 1, 2, math.MaxInt)
	testAddIntSlice(t, true, 0, math.MaxInt, 2, 1)
}
