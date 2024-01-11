// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package statediff

import (
	"fmt"
	"strings"
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

func testLineDiff(t *testing.T, str1 string, str2 string, splitString string) {
	diffBytes := MakeLineDiff(str1, str2, splitString)
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
	testLineDiff(t, Str1, Str2, "\n")
	testLineDiff(t, Str2, Str3, "\n")
	testLineDiff(t, Str1, Str3, "\n")
	testLineDiff(t, Str3, Str1, "\n")
	testLineDiff(t, Str3, Str4, "\n")
}

func TestLineDiff0(t *testing.T) {
	var str1Arr []string = []string{"a", "b", "c", "d", "e"}
	var str2Arr []string = []string{"a", "e"}
	str1 := strings.Join(str1Arr, "\x00")
	str2 := strings.Join(str2Arr, "\x00")
	diffBytes := MakeLineDiff(str1, str2, "\x00")
	fmt.Printf("diff-len: %d\n", len(diffBytes))
	out, err := ApplyLineDiff(str1, diffBytes)
	if err != nil {
		t.Errorf("error in diff: %v", err)
		return
	}
	if out != str2 {
		t.Errorf("bad diff output")
	}
	diffBytes = MakeLineDiff(str2, str1, "\x00")
	fmt.Printf("diff-len: %d\n", len(diffBytes))
	out, err = ApplyLineDiff(str2, diffBytes)
	if err != nil {
		t.Errorf("error in diff: %v", err)
		return
	}
	if out != str1 {
		t.Errorf("bad diff output")
	}

	diffBytes = MakeLineDiff(str1, str1, "\x00")
	if len(diffBytes) != 0 {
		t.Errorf("bad diff output (len should be 0)")
	}
	var diffVar LineDiffType
	diffVar.Decode(diffBytes)
	if len(diffVar.Lines) != 0 || len(diffVar.NewData) != 0 || diffVar.Version != LineDiffVersion {
		t.Errorf("bad diff output (for decoding nil)")
	}
}

func TestLineDiffVersion0(t *testing.T) {
	var str1Arr []string = []string{"a", "b", "c", "d", "e"}
	var str2Arr []string = []string{"a", "e"}
	str1 := strings.Join(str1Arr, "\n")
	str2 := strings.Join(str2Arr, "\n")

	var diff LineDiffType
	diff.Version = 0
	diff.SplitString = "\n"
	diff.Lines = []SingleLineEntry{{LineVal: 1, Run: 1}, {LineVal: 5, Run: 1}}
	encDiff0 := diff.Encode_v0()

	var decDiff LineDiffType
	err := decDiff.Decode(encDiff0)
	if err != nil {
		t.Errorf("error decoding diff: %v\n", err)
	}
	if decDiff.Version != 0 {
		t.Errorf("bad version")
	}
	if decDiff.SplitString != "\n" {
		t.Errorf("bad split string")
	}
	out, err := ApplyLineDiff(str1, encDiff0)
	if err != nil {
		t.Errorf("error in diff: %v", err)
		return
	}
	if out != str2 {
		t.Errorf("bad diff output")
	}
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
