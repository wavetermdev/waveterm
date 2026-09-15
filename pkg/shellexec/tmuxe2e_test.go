// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellexec

import (
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
	time.Sleep(300 * time.Millisecond)
	oldPane := capture()
	if strings.Contains(oldPane, marker+"-old\n") && !strings.Contains(oldPane, "not found") {
		t.Fatalf("expected the old unquoted construction to mangle the tmux send-keys argument, but the pane shows a clean echo: %q", oldPane)
	}

	// Clear the pane for a clean before/after comparison.
	exec.Command(tmuxPath, "-S", sockPath, "send-keys", "-t", sessionName, "clear", "Enter").Run()
	time.Sleep(200 * time.Millisecond)

	argv[6] = "echo " + marker + "-new"
	newCmdCombined := shellutil.SerializeCommandForShell(shellutil.ShellType_unknown, argv)
	runOverSSH(newCmdCombined)
	time.Sleep(300 * time.Millisecond)
	newPane := capture()
	if !strings.Contains(newPane, marker+"-new") {
		t.Fatalf("expected the new construction's send-keys to echo the marker cleanly, got pane content: %q", newPane)
	}
	if strings.Contains(newPane, "not found") {
		t.Fatalf("new construction produced a shell error in the tmux pane: %q", newPane)
	}
}
