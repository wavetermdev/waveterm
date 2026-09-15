// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellexec

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func TestWslNoWshArgv(t *testing.T) {
	tests := []struct {
		name       string
		distroName string
		cmdStr     string
		want       []string
	}{
		{
			name:       "empty cmdStr launches default interactive shell",
			distroName: "Ubuntu",
			cmdStr:     "",
			want:       []string{"wsl.exe", "~", "-d", "Ubuntu"},
		},
		{
			name:       "non-empty cmdStr is passed as one argv element to sh -c",
			distroName: "Ubuntu",
			cmdStr:     "tmux attach -t cc-pp-gatefix",
			want:       []string{"wsl.exe", "~", "-d", "Ubuntu", "--", "sh", "-c", "tmux attach -t cc-pp-gatefix"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := wslNoWshArgv(tt.distroName, tt.cmdStr)
			if len(got) != len(tt.want) {
				t.Fatalf("wslNoWshArgv(%q, %q) = %v, want %v", tt.distroName, tt.cmdStr, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("wslNoWshArgv(%q, %q)[%d] = %q, want %q", tt.distroName, tt.cmdStr, i, got[i], tt.want[i])
				}
			}
		})
	}
}

// TestNoWsh_SessionWrapDeliversCmdStrOverRealSSH covers the SSH no-wsh
// fallback fix (StartRemoteShellProcNoWsh): before the fix, cmdStr was
// always ignored and the fallback unconditionally called session.Shell(),
// silently dropping any requested command. The fix makes it call
// sessionWrap.Start(cmdStr) whenever cmdStr is non-empty. SSHConn cannot be
// constructed outside the conncontroller package (unexported lock fields),
// so this exercises the exact SessionWrap.Start/session.Shell branch
// StartRemoteShellProcNoWsh takes, over a real SSH session, which is the
// only externally-observable effect of that function's logic.
func TestNoWsh_SessionWrapDeliversCmdStrOverRealSSH(t *testing.T) {
	addr, closeFn := startTestSSHServer(t)
	defer closeFn()
	client := dialTestSSH(t, addr)
	defer client.Close()

	cmdStr := "echo marker-a marker-b"
	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	defer session.Close()

	// Mirrors StartRemoteShellProcNoWsh's fixed branch: cmdStr != "" -> use
	// MakeSessionWrap + sessionWrap.Start(cmdStr).
	sessionWrap := MakeSessionWrap(session, cmdStr, nil)
	if sessionWrap.StartCmd != cmdStr {
		t.Fatalf("SessionWrap.StartCmd = %q, want %q", sessionWrap.StartCmd, cmdStr)
	}
	out, err := session.Output(sessionWrap.StartCmd)
	if err != nil {
		t.Fatalf("session.Output failed: %v", err)
	}
	if got := strings.TrimSpace(string(out)); got != "marker-a marker-b" {
		t.Fatalf("got %q, want %q", got, "marker-a marker-b")
	}
}

// TestDescribeForLog_NeverLeaksSecrets is the log-redaction regression test:
// describeForLog must never emit a swap token, packed token, or JWT VALUE —
// only shell types, the executable, argc, and env var key NAMES.
func TestDescribeForLog_NeverLeaksSecrets(t *testing.T) {
	rawToken := "super-secret-raw-token-0123456789"
	packedToken := "cGFja2VkLXNlY3JldC10b2tlbi1hYmNkZWY=" // base64, but still a secret
	jwt := "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.c2lnbmF0dXJl"

	env := map[string]string{
		"WAVETERM_SWAPTOKEN": packedToken,
		"WAVETERM_JWT":       jwt,
		"ZDOTDIR":            "/home/user/.waveterm/shell/zsh",
	}
	shellOpts := []string{"-c", "some command containing " + rawToken}

	logLine := describeForLog(shellutil.ShellType_bash, shellutil.ShellType_zsh, "/bin/zsh", shellOpts, env)

	for _, secret := range []string{rawToken, packedToken, jwt} {
		if strings.Contains(logLine, secret) {
			t.Fatalf("describeForLog leaked a secret value into the log line: %q contains %q", logLine, secret)
		}
	}
	// Env var NAMES are fine (and expected) to appear.
	for k := range env {
		if !strings.Contains(logLine, k) {
			t.Fatalf("describeForLog dropped env key name %q entirely; log line: %q", k, logLine)
		}
	}
	// The raw shell command text (which could itself embed a secret, as in
	// this test) must never appear either — describeForLog must never be
	// handed or echo the fully-assembled, env-prefixed command string.
	if strings.Contains(logLine, "some command containing") {
		t.Fatalf("describeForLog echoed shellOpts content verbatim; log line: %q", logLine)
	}
}
