// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"fmt"
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
