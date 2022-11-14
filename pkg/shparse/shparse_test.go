package shparse

import (
	"testing"
)

// $(ls f[*]); ./x
// ls f               => raw["ls f"] -> lit["ls f"] -> lit["ls"] lit["f"]p
// w; ls foo;         => raw["w; ls foo;"]
// ls&"ls"            => raw["ls&ls"] => lit["ls&"] dq["ls"] => lit["ls"] key["&"] dq["ls"]
// ls $x; echo `ls f  => raw["ls $x; echo `ls f"]
// > echo $foo{x,y}

func testParse(t *testing.T, s string) {
	c := &parseContext{Input: []rune(s)}
	words := c.parseQuotes()
	c.dumpWords(words)
}

func Test1(t *testing.T) {
	testParse(t, "ls")
	testParse(t, "ls 'foo'")
	testParse(t, `ls "hello" $'\''`)
}
