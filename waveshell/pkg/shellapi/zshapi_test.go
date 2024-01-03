package shellapi

import (
	"fmt"
	"testing"
)

func testSingleDecl(declStr string) {
	decl, err := parseZshDeclLine(declStr)
	if err != nil {
		fmt.Printf("error: %v\n", err)
	}
	fmt.Printf("decl %#v\n", decl)
}

func TestParseZshDecl(t *testing.T) {
	declStr := `export -T PATH path=( /usr/local/bin /usr/bin /bin /usr/sbin /sbin )`
	testSingleDecl(declStr)
	declStr = `typeset -i10 SAVEHIST=1000`
	testSingleDecl(declStr)
	declStr = `typeset -a signals=( EXIT HUP INT QUIT ILL TRAP ABRT EMT FPE KILL BUS SEGV )`
	testSingleDecl(declStr)
	declStr = `typeset -aT RC rc=(80 25) 'x'`
	testSingleDecl(declStr)
	declStr = `typeset -g -A foo=( [bar]=baz [quux]=quuux )`
	testSingleDecl(declStr)
	declStr = `typeset -x -g -aT FOO foo=( 1 2 3 )`
	testSingleDecl(declStr)
}
