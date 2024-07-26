// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmdrunner

import (
	"testing"
)

func testRSC(t *testing.T, cmd string, expected bool) {
	rtn := IsReturnStateCommand(cmd)
	if rtn != expected {
		t.Errorf("cmd [%s], rtn=%v, expected=%v", cmd, rtn, expected)
	}
}

func TestIsReturnStateCommand(t *testing.T) {
	testRSC(t, "FOO=1", true)
	testRSC(t, "FOO=1 X=2", true)
	testRSC(t, "ls", false)
	testRSC(t, "export X", true)
	testRSC(t, "export X=1", true)
	testRSC(t, "declare -x FOO=1", true)
	testRSC(t, "source ./test", true)
	testRSC(t, "unset FOO BAR", true)
	testRSC(t, "FOO=1; ls", true)
	testRSC(t, ". ./test", true)
	testRSC(t, "{ FOO=6; }", true)
	testRSC(t, "cd foo && ls -l", true)
	testRSC(t, "ls -l && ./foo || git checkout main", true)
	testRSC(t, "./foo || ./bar", false)
	testRSC(t, ". foo.sh", true)
	testRSC(t, "cd work; conda activate myenv", true)
	testRSC(t, "asdf foo", true)
}
