package shparse

import (
	"fmt"
	"testing"
)

// $(ls f[*]); ./x
// ls f               => raw["ls f"] -> lit["ls f"] -> lit["ls"] lit["f"]
// w; ls foo;         => raw["w; ls foo;"]
// ls&"ls"            => raw["ls&ls"] => lit["ls&"] dq["ls"] => lit["ls"] key["&"] dq["ls"]
// ls $x; echo `ls f  => raw["ls $x; echo `ls f"]
// > echo $foo{x,y}

func testParse(t *testing.T, s string) {
	words := Tokenize(s)

	fmt.Printf("%s\n", s)
	dumpWords(words, "  ")
	fmt.Printf("\n")

	outStr := wordsToStr(words)
	if outStr != s {
		t.Errorf("tokenization output does not match input: %q => %q", s, outStr)
	}
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
	dumpCommands(cmds, "  ")
	fmt.Printf("\n")
}

func TestCmd(t *testing.T) {
	testParseCommands(t, "ls foo")
	testParseCommands(t, "ls foo && ls bar; ./run $x hello | xargs foo; ")
	testParseCommands(t, "if [[ 2 > 1 ]]; then echo hello\nelse echo world; echo next; done")
	testParseCommands(t, "case lots of stuff; i don\\'t know how to parse; esac; ls foo")
	testParseCommands(t, "(ls & ./x); for x in $vars 3; do { echo $x; ls foo; } done")
	testParseCommands(t, "function foo () { echo hello; }")
}
