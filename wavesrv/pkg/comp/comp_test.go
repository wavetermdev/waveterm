// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package comp

import (
	"fmt"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/utilfn"
)

func parseToSP(s string) utilfn.StrWithPos {
	idx := strings.Index(s, "[*]")
	if idx == -1 {
		return utilfn.StrWithPos{Str: s}
	}
	return utilfn.StrWithPos{Str: s[0:idx] + s[idx+3:], Pos: idx}
}

func testParse(cmdStr string, pos int) {
	fmt.Printf("cmd: %s\n", utilfn.StrWithPos{Str: cmdStr, Pos: pos})
	p := ParseCompPoint(utilfn.StrWithPos{Str: cmdStr, Pos: pos})
	p.dump()
}

func _Test1(t *testing.T) {
	testParse("ls ", 3)
	testParse("ls    ", 4)
	testParse("ls       -l foo", 4)
	testParse("ls foo; cd h", 12)
	testParse("ls foo; cd h;", 13)
	testParse("ls & foo; cd h", 12)
	testParse("ls \"he", 6)
	testParse("ls;", 3)
	testParse("ls;", 2)
	testParse("ls; cd x; ls", 8)
	testParse("cd \"foo ", 8)
	testParse("ls; { ls f", 10)
	testParse("ls; { ls -l; ls f", 17)
	testParse("ls $(ls f", 9)
}

func testMiniExtend(t *testing.T, p *CompPoint, newWord string, complete bool, expectedStr string) {
	newSP := p.extendWord(newWord, complete)
	expectedSP := parseToSP(expectedStr)
	if newSP != expectedSP {
		t.Fatalf("not equal: [%s] != [%s]", newSP, expectedSP)
	} else {
		fmt.Printf("extend: %s\n", newSP)
	}
}

func Test2(t *testing.T) {
	p := ParseCompPoint(parseToSP("ls f[*]"))
	testMiniExtend(t, p, "foo", false, "foo[*]")
	testMiniExtend(t, p, "foo", true, "foo [*]")
	testMiniExtend(t, p, "foo bar", true, "'foo bar' [*]")
	testMiniExtend(t, p, "foo'bar", true, `$'foo\'bar' [*]`)

	p = ParseCompPoint(parseToSP("ls f[*]more"))
	testMiniExtend(t, p, "foo", false, "foo[*]more")
	testMiniExtend(t, p, "foo bar", false, `'foo bar[*]more`)
	testMiniExtend(t, p, "foo bar", true, `'foo bar[*]more`)
	testMiniExtend(t, p, "foo's", true, `$'foo\'s[*]more`)
}

func testParseRT(t *testing.T, origSP utilfn.StrWithPos) {
	p := ParseCompPoint(origSP)
	newSP := utilfn.StrWithPos{Str: p.getOrigStr(), Pos: p.getOrigPos()}
	if origSP != newSP {
		t.Fatalf("not equal: [%s] != [%s]", origSP, newSP)
	}
}

func Test3(t *testing.T) {
	testParseRT(t, parseToSP("ls f[*]"))
	testParseRT(t, parseToSP("ls f[*]; more $FOO"))
	testParseRT(t, parseToSP("hello; ls [*]f"))
	testParseRT(t, parseToSP("ls -l; ./foo he[*]ll more; touch foo &"))
}

func testExtend(t *testing.T, origStr string, compStrs []string, expectedStr string) {
	origSP := parseToSP(origStr)
	expectedSP := parseToSP(expectedStr)
	p := ParseCompPoint(origSP)
	crtn := compsToCompReturn(compStrs, false)
	newSP := p.FullyExtend(crtn)
	if newSP != expectedSP {
		t.Fatalf("comp-fail: %s + %v => [%s] expected[%s]", origSP, compStrs, newSP, expectedSP)
	} else {
		fmt.Printf("comp: %s + %v => [%s]\n", origSP, compStrs, newSP)
	}
}

func Test4(t *testing.T) {
	testExtend(t, "ls f[*]", []string{"foo"}, "ls foo [*]")
	testExtend(t, "ls f[*]", []string{"foox", "fooy"}, "ls foo[*]")
	testExtend(t, "w; ls f[*]; touch x", []string{"foo"}, "w; ls foo [*]; touch x")
	testExtend(t, "w; ls f[*] more; touch x", []string{"foo"}, "w; ls foo [*] more; touch x")
	testExtend(t, "w; ls f[*]oo; touch x", []string{"foo"}, "w; ls foo[*]oo; touch x")
	testExtend(t, `ls "f[*]`, []string{"foo"}, `ls "foo" [*]`)
	testExtend(t, `ls 'f[*]`, []string{"foo"}, `ls 'foo' [*]`)
	testExtend(t, `ls $'f[*]`, []string{"foo"}, `ls $'foo' [*]`)
	testExtend(t, `ls f[*]`, []string{"foo/"}, `ls foo/[*]`)
	testExtend(t, `ls f[*]`, []string{"foo bar"}, `ls 'foo bar' [*]`)
	testExtend(t, `ls f[*]`, []string{"f\x01\x02"}, `ls $'f\x01\x02' [*]`)
	testExtend(t, `ls "foo [*]`, []string{"foo bar"}, `ls "foo bar" [*]`)
	testExtend(t, `ls f[*]`, []string{"foo's"}, `ls $'foo\'s' [*]`)
}
