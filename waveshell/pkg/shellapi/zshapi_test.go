package shellapi

import (
	"fmt"
	"log"
	"testing"
	"time"
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

func TestZshSafeDeclName(t *testing.T) {
	if !isZshSafeNameStr("foo") {
		t.Errorf("foo should be safe")
	}
	if isZshSafeNameStr("foo bar") {
		t.Errorf("foo bar should not be safe")
	}
	if !isZshSafeNameStr("foo_bar") {
		t.Errorf("foo_bar should be safe")
	}
	if !isZshSafeNameStr("été") {
		t.Errorf("été should be be safe")
	}
	if isZshSafeNameStr("hello\x01z") {
		t.Errorf("should not be safe")
	}
}

func testValidate(t *testing.T, shell string, cmd string, expectErr bool) {
	var sapi ShellApi
	if shell == "bash" {
		sapi = bashShellApi{}
	} else if shell == "zsh" {
		sapi = zshShellApi{}
	} else {
		t.Errorf("unknown shell %q", shell)
		return
	}
	tstart := time.Now()
	err := sapi.ValidateCommandSyntax(cmd)
	log.Printf("shell:%s dur:%v err: %v\n", shell, time.Since(tstart), err)
	if expectErr && err == nil {
		t.Errorf("cmd %q, expected error", cmd)
	}
	if !expectErr && err != nil {
		t.Errorf("cmd %q, unexpected error: %v", cmd, err)
	}
}

func TestValidate(t *testing.T) {
	testValidate(t, "zsh", "echo foo", false)
	testValidate(t, "zsh", "foo >& &", true)
	testValidate(t, "zsh", "cd .", false)
	testValidate(t, "zsh", "echo foo | grep foo", false)
	testValidate(t, "zsh", "x; echo \"hello", true)
	testValidate(t, "bash", "echo foo", false)
	testValidate(t, "bash", "foo >& &", true)
	testValidate(t, "bash", "cd .; echo \"", true)
}
