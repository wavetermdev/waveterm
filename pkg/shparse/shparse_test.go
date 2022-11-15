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
}
