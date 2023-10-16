package statediff

import (
	"fmt"
	"testing"
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

func strMapsEqual(m1 map[string]string, m2 map[string]string) bool {
	if len(m1) != len(m2) {
		return false
	}
	for key, val := range m1 {
		val2, ok := m2[key]
		if !ok || val != val2 {
			return false
		}
	}
	for key, val := range m2 {
		val2, ok := m1[key]
		if !ok || val != val2 {
			return false
		}
	}
	return true
}

func TestMapDiff(t *testing.T) {
	m1 := map[string]string{"a": "5", "b": "hello", "c": "mike"}
	m2 := map[string]string{"a": "5", "b": "goodbye", "d": "more"}
	diffBytes := MakeMapDiff(m1, m2)
	fmt.Printf("mapdifflen: %d\n", len(diffBytes))
	var diff MapDiffType
	diff.Decode(diffBytes)
	diff.Dump()
	mcheck, err := ApplyMapDiff(m1, diffBytes)
	if err != nil {
		t.Fatalf("error applying map diff: %v", err)
	}
	if !strMapsEqual(m2, mcheck) {
		t.Errorf("maps not equal")
	}
	fmt.Printf("%v\n", mcheck)
}
