// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellexec

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

// TestTmuxE2E_QuotingFixOverRealSSH is the tmux-shaped end-to-end regression
// test for the bug that motivated this fix: `wsh run -- tmux attach -t
// <session>` (and similarly, any multi-word tmux subcommand) sent over SSH.
// It drives a REAL tmux server (on a throwaway socket under t.TempDir(), not
// /tmp, so a test run never depends on or pollutes shared system state) via
// a REAL SSH exec channel, and proves the old flattening construction
// mangles a multi-word tmux argument while the new serializer preserves it.
func TestTmuxE2E_QuotingFixOverRealSSH(t *testing.T) {
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux not available")
	}

	sockPath := filepath.Join(t.TempDir(), "tmux.sock")
	sessionName := "cc-pp-gatefix"

	newSession := exec.Command(tmuxPath, "-S", sockPath, "new-session", "-d", "-s", sessionName, "-x", "80", "-y", "24")
	if out, err := newSession.CombinedOutput(); err != nil {
		t.Fatalf("failed to start detached tmux session: %v, output: %s", err, out)
	}
	defer exec.Command(tmuxPath, "-S", sockPath, "kill-server").Run()

	capture := func() string {
		out, err := exec.Command(tmuxPath, "-S", sockPath, "capture-pane", "-t", sessionName, "-p").Output()
		if err != nil {
			t.Fatalf("capture-pane failed: %v", err)
		}
		return string(out)
	}

	// session.Run only waits for the SSH exec (tmux send-keys itself) to
	// return, not for the shell INSIDE the tmux pane to process the injected
	// keystrokes - that gap is what needs polling, not a fixed sleep, since
	// its duration isn't bounded by anything the SSH call can observe.
	waitForPane := func(deadline time.Duration, ready func(string) bool) string {
		end := time.Now().Add(deadline)
		var last string
		for {
			last = capture()
			if ready(last) {
				return last
			}
			if time.Now().After(end) {
				t.Fatalf("timed out waiting for tmux pane state: %q", last)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}

	// A settle sentinel, not a marker/"not found" text match, is the
	// deterministic completion fence: the pane's shell processes lines in
	// order, so once the sentinel echoes, whatever the prior command was
	// going to print (clean output or a "command not found" error) has
	// already happened. Sent directly via exec.Command (structured argv,
	// bypassing SSH entirely) since the sentinel's own correctness isn't
	// what's under test here.
	settleCounter := 0
	waitForSettled := func(deadline time.Duration) string {
		settleCounter++
		sentinel := fmt.Sprintf("settled-%d", settleCounter)
		sendSentinel := exec.Command(tmuxPath, "-S", sockPath, "send-keys", "-t", sessionName, "echo "+sentinel, "Enter")
		if err := sendSentinel.Run(); err != nil {
			t.Fatalf("failed to send settle sentinel: %v", err)
		}
		// Match the sentinel as its own output line specifically - it also
		// appears as a substring of the unexecuted, merely-echoed input line
		// ("echo settled-N"), which would otherwise satisfy a plain Contains
		// before the command has actually run.
		return waitForPane(deadline, func(s string) bool {
			return strings.Contains(s, "\n"+sentinel+"\n")
		})
	}

	addr, closeFn := startTestSSHServer(t)
	defer closeFn()
	client := dialTestSSH(t, addr)
	defer client.Close()

	runOverSSH := func(cmdCombined string) {
		session, err := client.NewSession()
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}
		defer session.Close()
		if err := session.Run(cmdCombined); err != nil {
			t.Fatalf("session.Run(%q) failed: %v", cmdCombined, err)
		}
	}

	// This is the exact multi-word-argument shape that broke over SSH: the
	// literal keys to type ("echo tmux-e2e-marker-old") must survive as ONE
	// send-keys argument, not get split into separate positional args.
	marker := "tmux-e2e-marker"
	argv := []string{tmuxPath, "-S", sockPath, "send-keys", "-t", sessionName, "echo " + marker + "-old", "Enter"}

	oldCmdCombined := strings.Join(argv, " ") // the original unquoted flatten
	runOverSSH(oldCmdCombined)
	oldPane := waitForSettled(2 * time.Second)
	if strings.Contains(oldPane, marker+"-old\n") && !strings.Contains(oldPane, "not found") {
		t.Fatalf("expected the old unquoted construction to mangle the tmux send-keys argument, but the pane shows a clean echo: %q", oldPane)
	}

	// Clear the pane for a clean before/after comparison.
	exec.Command(tmuxPath, "-S", sockPath, "send-keys", "-t", sessionName, "clear", "Enter").Run()
	waitForSettled(1 * time.Second)

	argv[6] = "echo " + marker + "-new"
	newCmdCombined := shellutil.SerializeCommandForShell(shellutil.ShellType_unknown, argv)
	runOverSSH(newCmdCombined)
	newPane := waitForSettled(2 * time.Second)
	if !strings.Contains(newPane, marker+"-new") {
		t.Fatalf("expected the new construction's send-keys to echo the marker cleanly, got pane content: %q", newPane)
	}
	if strings.Contains(newPane, "not found") {
		t.Fatalf("new construction produced a shell error in the tmux pane: %q", newPane)
	}
}
