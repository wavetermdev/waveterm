package shparse

import (
	"fmt"
	"testing"

	"github.com/scripthaus-dev/sh2-server/pkg/utilfn"
)

// $(ls f[*]); ./x
// ls f               => raw["ls f"] -> lit["ls f"] -> lit["ls"] lit["f"]
// w; ls foo;         => raw["w; ls foo;"]
// ls&"ls"            => raw["ls&ls"] => lit["ls&"] dq["ls"] => lit["ls"] key["&"] dq["ls"]
// ls $x; echo `ls f  => raw["ls $x; echo `ls f"]
// > echo $foo{x,y}

func testParse(t *testing.T, s string) {
	words := Tokenize(s)

	fmt.Printf("parse <<\n%s\n>>\n", s)
	dumpWords(words, "  ", 8)
	outStr := wordsToStr(words)
	if outStr != s {
		t.Errorf("tokenization output does not match input: %q => %q", s, outStr)
	}
	fmt.Printf("------\n\n")
}

func Test1(t *testing.T) {
	testParse(t, "ls")
	testParse(t, "ls 'foo'")
	testParse(t, `ls "hello" $'\''`)
	testParse(t, `ls "foo`)
	testParse(t, `echo $11 $xyz $ `)
	testParse(t, `echo $(ls ${x:"hello"} foo`)
	testParse(t, `ls ${x:"hello"} $[2+2] $((5 * 10)) $(ls; ls&)`)
	testParse(t, `ls;ls&./foo > out 2> "out2"`)
	testParse(t, `(( x = 5)); ls& cd ~/work/"hello again"`)
	testParse(t, `echo "hello"abc$(ls)$x${y:foo}`)
	testParse(t, `echo $(ls; ./x "foo")`)
	testParse(t, `echo $(ls; (cd foo; ls); (cd bar; ls))xyz`)
	testParse(t, `echo "$x ${y:-foo}"`)
	testParse(t, `command="$(echo "$input" | sed -e "s/^[ \t]*\([^ \t]*\)[ \t]*.*$/\1/g")"`)
	testParse(t, `echo $(ls $)`)
	testParse(t, `echo ${x:-hello\}"}"} 2nd`)
	testParse(t, `echo "$(ls "foo") more $x"`)
	testParse(t, "echo `ls $x \"hello $x\" \\`ls\\`; ./foo`")
	testParse(t, `echo $"hello $x $(ls)"`)
	testParse(t, "echo 'hello'\nls\n")
	testParse(t, "echo 'hello'abc$'\a'")
}

func lastWord(words []*WordType) *WordType {
	if len(words) == 0 {
		return nil
	}
	return words[len(words)-1]
}

func testExtend(t *testing.T, startStr string, extendStr string, expectedStr string) {
	words := Tokenize(startStr)
	ec := makeExtendContext(nil, lastWord(words))
	for _, ch := range extendStr {
		ec.extend(ch)
	}
	ec.ensureCurWord()
	output := wordsToStr(ec.Rtn)
	fmt.Printf("[%s] + [%s] => [%s]\n", startStr, extendStr, output)
	if output != expectedStr {
		t.Errorf("extension does not match: [%s] + [%s] => [%s] expected [%s]\n", startStr, extendStr, output, expectedStr)
	}
}

func Test2(t *testing.T) {
	testExtend(t, `'he'`, "llo", `'hello'`)
	testExtend(t, `'he'`, "'", `'he'\'''`)
	testExtend(t, `'he'`, "'\x01", `'he'\'$'\x01'''`)
	testExtend(t, `he`, "llo", `hello`)
	testExtend(t, `he`, "l*l'\x01\x07o", `hel\*l\'$'\x01'$'\a'o`)
	testExtend(t, `$x`, "fo|o", `$xfoo`)
	testExtend(t, `${x`, "fo|o", `${xfoo`)
	testExtend(t, `$'f`, "oo", `$'foo`)
	testExtend(t, `$'f`, "'\x01\x07o", `$'f\'\x01\ao`)
	testExtend(t, `"f"`, "oo", `"foo"`)
	testExtend(t, `"mi"`, "ke's \"hello\"", `"mike's \"hello\""`)
	testExtend(t, `"t"`, "t\x01\x07", `"tt"$'\x01'$'\a'""`)
}

func testParseCommands(t *testing.T, str string) {
	fmt.Printf("parse: %q\n", str)
	words := Tokenize(str)
	cmds := ParseCommands(words)
	dumpCommands(cmds, "  ", -1)
	fmt.Printf("\n")
}

func TestCmd(t *testing.T) {
	testParseCommands(t, "ls foo")
	testParseCommands(t, "function foo () { echo hello; }")
	testParseCommands(t, "ls foo && ls bar; ./run $x hello | xargs foo; ")
	testParseCommands(t, "if [[ 2 > 1 ]]; then echo hello\nelse echo world; echo next; done")
	testParseCommands(t, "case lots of stuff; i don\\'t know how to parse; esac; ls foo")
	testParseCommands(t, "(ls & ./x \n   \n); for x in $vars 3; do { echo $x; ls foo ; } done")
	testParseCommands(t, `ls f"oo" "${x:"hello$y"}"`)
	testParseCommands(t, `x="foo $y" z=10 ls`)
}

func testCompPos(t *testing.T, cmdStr string, hasCommand bool, cmdWordPos int, hasWord bool, compInvalid bool, compCommand bool) {
	cmdSP := utilfn.ParseToSP(cmdStr)
	words := Tokenize(cmdSP.Str)
	cmds := ParseCommands(words)
	cpos := FindCompletionPos(cmds, cmdSP.Pos, 0)
	fmt.Printf("testCompPos [%d] %q => %v\n", cmdSP.Pos, cmdStr, cpos)
	if cpos.CmdWord != nil {
		fmt.Printf("  found-word: %d %s\n", cpos.CmdWordOffset, cpos.CmdWord.stringWithPos(cpos.CmdWordOffset))
	}
	if cpos.Cmd != nil {
		fmt.Printf("  found-cmd: ")
		dumpCommands([]*CmdType{cpos.Cmd}, "  ", cpos.RawPos)
	}
	dumpCommands(cmds, "  ", cmdSP.Pos)
	fmt.Printf("\n")
	if cpos.RawPos+cpos.SuperOffset != cmdSP.Pos {
		t.Errorf("testCompPos %q => bad rawpos:%d superoffset:%d expected:%d", cmdStr, cpos.RawPos, cpos.SuperOffset, cmdSP.Pos)
	}
	if (cpos.Cmd != nil) != hasCommand {
		t.Errorf("testCompPos %q => bad has-command exp:%v", cmdStr, hasCommand)
	}
	if (cpos.CmdWord != nil) != hasWord {
		t.Errorf("testCompPos %q => bad has-word exp:%v", cmdStr, hasWord)
	}
	if cpos.CmdWordPos != cmdWordPos {
		t.Errorf("testCompPos %q => bad cmd-word-pos got:%d exp:%d", cmdStr, cpos.CmdWordPos, cmdWordPos)
	}
	if cpos.CompInvalid != compInvalid {
		t.Errorf("testCompPos %q => bad comp-invalid exp:%v", cmdStr, compInvalid)
	}
	if cpos.CompCommand != compCommand {
		t.Errorf("testCompPos %q => bad comp-command exp:%v", cmdStr, compCommand)
	}
}

func TestCompPos(t *testing.T) {
	testCompPos(t, "ls [*]foo", true, 1, false, false, false)
	testCompPos(t, "ls foo  [*];", true, 2, false, false, false)
	testCompPos(t, "ls foo  ;[*]", false, 0, false, false, true)
	testCompPos(t, "ls foo >[*]> ./bar", true, 2, true, true, false)
	testCompPos(t, "l[*]s", true, 0, true, false, false)
	testCompPos(t, "ls[*]", true, 0, true, false, false)
	testCompPos(t, "x=10 { (ls ./f[*] more); ls }", true, 1, true, false, false)
	testCompPos(t, "for x in 1[*] 2 3; do ", false, 0, true, false, false)
	testCompPos(t, "for[*] x in 1 2 3;", false, 0, true, true, false)

	testCompPos(t, "ls \"abc $(ls -l t[*])\" && foo", true, 2, true, false, false)

	testCompPos(t, "ls ${abc:$(ls -l [*])}", true, 1, true, false, false)

	testCompPos(t, `ls abc"$(ls $"echo $(ls ./[*]x) foo)" `, true, 1, true, false, false)
}

func testExpand(t *testing.T, str string, pos int, expStr string, expInfo *ExpandInfo) {
	ectx := ExpandContext{HomeDir: "/Users/mike"}
	words := Tokenize(str)
	if len(words) == 0 {
		t.Errorf("could not tokenize any words from %q", str)
		return
	}
	word := words[0]
	output, info := SimpleExpandPrefix(ectx, word, pos)
	if output != expStr {
		t.Errorf("error expanding %q, output:%q exp:%q", str, output, expStr)
	} else {
		fmt.Printf("expand: %q (%d) => %q\n", str, pos, output)
	}
	if expInfo != nil {
		if info != *expInfo {
			t.Errorf("error expanding %q, info:%v exp:%v", str, info, expInfo)
		}
	}
}

func TestExpand(t *testing.T) {
	testExpand(t, "hello", 3, "hel", nil)
	testExpand(t, "he\\$xabc", 6, "he$xa", nil)
	testExpand(t, "he${x}abc", 6, "he$xa", nil)
	testExpand(t, "'hello\"mike'", 8, "hello\"m", nil)
	testExpand(t, `$'abc\x01def`, 10, "abc\x01d", nil)
	testExpand(t, `$((2 + 2))`, 6, "$((2 +", &ExpandInfo{HasSpecial: true})
	testExpand(t, `abc"def"`, 6, "abcde", nil)
}
