// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package statediff

import (
	"fmt"
	"testing"

	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

const Str1 = `
hello
line #2
apple
grapes
banana
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

const Str4 = `
more
stuff
banana2
coconut
`

func testLineDiff(t *testing.T, str1 string, str2 string) {
	diffBytes := MakeLineDiff(str1, str2)
	fmt.Printf("diff-len: %d\n", len(diffBytes))
	out, err := ApplyLineDiff(str1, diffBytes)
	if err != nil {
		t.Errorf("error in diff: %v", err)
		return
	}
	if out != str2 {
		t.Errorf("bad diff output")
	}
	var dt LineDiffType
	err = dt.Decode(diffBytes)
	if err != nil {
		t.Errorf("error decoding diff: %v\n", err)
	}
}

func TestLineDiff(t *testing.T) {
	testLineDiff(t, Str1, Str2)
	testLineDiff(t, Str2, Str3)
	testLineDiff(t, Str1, Str3)
	testLineDiff(t, Str3, Str1)
	testLineDiff(t, Str3, Str4)
}

func TestMapDiff(t *testing.T) {
	m1 := map[string][]byte{"a": []byte("5"), "b": []byte("hello"), "c": []byte("mike")}
	m2 := map[string][]byte{"a": []byte("5"), "b": []byte("goodbye"), "d": []byte("more")}
	diffBytes := MakeMapDiff(m1, m2)
	fmt.Printf("mapdifflen: %d\n", len(diffBytes))
	var diff MapDiffType
	diff.Decode(diffBytes)
	diff.Dump()
	mcheck, err := ApplyMapDiff(m1, diffBytes)
	if err != nil {
		t.Fatalf("error applying map diff: %v", err)
	}
	if !utilfn.ByteMapsEqual(m2, mcheck) {
		t.Errorf("maps not equal")
	}
	fmt.Printf("%v\n", mcheck)
}
