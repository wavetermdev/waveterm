// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellexec

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os/exec"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"golang.org/x/crypto/ssh"
)

// startTestSSHServer spins up a minimal, in-process SSH server that accepts
// password auth (any credentials) and, for each "exec" channel request, runs
// the requested command line via the real system `sh -c` — exactly the way
// OpenSSH's sshd invokes a non-interactive exec payload against the
// connecting user's shell. This exercises the actual golang.org/x/crypto/ssh
// wire protocol (the same client Session type SessionWrap.Start drives in
// production), not a mock, without depending on a system sshd install.
func startTestSSHServer(t *testing.T) (addr string, closeFn func()) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate host key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}
	config := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			return nil, nil // accept anything
		},
	}
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}

	done := make(chan struct{})
	go func() {
		for {
			nConn, err := listener.Accept()
			if err != nil {
				return
			}
			go handleTestSSHConn(nConn, config)
		}
	}()

	return listener.Addr().String(), func() {
		listener.Close()
		close(done)
	}
}

func handleTestSSHConn(nConn net.Conn, config *ssh.ServerConfig) {
	sconn, chans, reqs, err := ssh.NewServerConn(nConn, config)
	if err != nil {
		return
	}
	defer sconn.Close()
	go ssh.DiscardRequests(reqs)
	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "unsupported channel type")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			continue
		}
		go func() {
			defer channel.Close()
			for req := range requests {
				if req.Type != "exec" {
					if req.WantReply {
						req.Reply(false, nil)
					}
					continue
				}
				// exec payload is a length-prefixed string per RFC 4254 6.5
				var payload struct{ Command string }
				ssh.Unmarshal(req.Payload, &payload)
				if req.WantReply {
					req.Reply(true, nil)
				}
				cmd := exec.Command("sh", "-c", payload.Command)
				cmd.Stdout = channel
				cmd.Stderr = channel.Stderr()
				exitCode := 0
				if runErr := cmd.Run(); runErr != nil {
					if exitErr, ok := runErr.(*exec.ExitError); ok {
						exitCode = exitErr.ExitCode()
					} else {
						exitCode = 1
					}
				}
				channel.SendRequest("exit-status", false, ssh.Marshal(struct{ ExitStatus uint32 }{uint32(exitCode)}))
				return
			}
		}()
	}
}

func dialTestSSH(t *testing.T, addr string) *ssh.Client {
	t.Helper()
	client, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            "testuser",
		Auth:            []ssh.AuthMethod{ssh.Password("anything")},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		t.Fatalf("failed to dial test ssh server: %v", err)
	}
	return client
}

// TestSSHIntegration_OldConstructionFailsOverRealSSH reproduces the exact
// original bug over a REAL (in-process, but wire-protocol-real) SSH exec
// channel: shellOpts=["-c","echo marker-a marker-b"] flattened with a naive
// unquoted join loses the "-c" argument boundary, so the marker words never
// appear in the command's output.
func TestSSHIntegration_OldConstructionFailsOverRealSSH(t *testing.T) {
	addr, closeFn := startTestSSHServer(t)
	defer closeFn()
	client := dialTestSSH(t, addr)
	defer client.Close()

	shellPath := "/bin/bash"
	shellOpts := []string{"-c", "echo marker-a marker-b"}
	oldCmdCombined := shellPath + " " + strings.Join(shellOpts, " ")

	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	defer session.Close()
	out, err := session.Output(oldCmdCombined)
	got := strings.TrimSpace(string(out))
	if err == nil && got == "marker-a marker-b" {
		t.Fatalf("expected the old unquoted construction to fail over real SSH, but it produced the correct output %q", got)
	}
}

// TestSSHIntegration_NewConstructionPreservesArgvOverRealSSH proves the fix:
// the same shellOpts, serialized via SerializeCommandForShell, arrives
// intact through a real SSH exec channel.
func TestSSHIntegration_NewConstructionPreservesArgvOverRealSSH(t *testing.T) {
	addr, closeFn := startTestSSHServer(t)
	defer closeFn()
	client := dialTestSSH(t, addr)
	defer client.Close()

	shellPath := "/bin/bash"
	shellOpts := []string{"-c", "echo marker-a marker-b"}
	newCmdCombined := shellutil.SerializeCommandForShell(shellutil.ShellType_unknown, append([]string{shellPath}, shellOpts...))

	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	defer session.Close()
	out, err := session.Output(newCmdCombined)
	if err != nil {
		t.Fatalf("session.Output failed: %v (cmd=%q)", err, newCmdCombined)
	}
	got := strings.TrimSpace(string(out))
	if got != "marker-a marker-b" {
		t.Fatalf("cmd=%q: got output %q, want %q", newCmdCombined, got, "marker-a marker-b")
	}
}

// TestSSHIntegration_ArbitraryCmdStrOverRealSSH exercises a cmdStr shape
// close to real usage (a wsh-run-style multi-word remote command with a
// hyphenated argument, e.g. `wsh run -- tmux attach -t cc-pp-gatefix`),
// proving the full shellPath+["-c",cmdStr] construction survives a real SSH
// round trip.
func TestSSHIntegration_ArbitraryCmdStrOverRealSSH(t *testing.T) {
	addr, closeFn := startTestSSHServer(t)
	defer closeFn()
	client := dialTestSSH(t, addr)
	defer client.Close()

	cases := []string{
		"echo marker-a marker-b",
		`echo "quoted marker" 'single quoted'`,
		"echo dollar-marker: $HOME literal",
		"printf 'no-newline-marker'",
	}
	for _, cmdStr := range cases {
		t.Run(cmdStr, func(t *testing.T) {
			shellOpts := []string{"-c", cmdStr}
			cmdCombined := shellutil.SerializeCommandForShell(shellutil.ShellType_unknown, append([]string{"/bin/bash"}, shellOpts...))

			session, err := client.NewSession()
			if err != nil {
				t.Fatalf("failed to create session: %v", err)
			}
			defer session.Close()
			gotOut, err := session.Output(cmdCombined)
			if err != nil {
				t.Fatalf("session.Output failed: %v (cmd=%q)", err, cmdCombined)
			}

			wantSession, err := client.NewSession()
			if err != nil {
				t.Fatalf("failed to create comparison session: %v", err)
			}
			defer wantSession.Close()
			// Ground truth: running cmdStr directly (as bash -c would) must
			// match exactly what our serialized construction produced.
			wantOut, err := wantSession.Output("bash -c " + shellutil.HardQuote(cmdStr))
			if err != nil {
				t.Fatalf("failed to compute ground truth: %v", err)
			}
			if string(gotOut) != string(wantOut) {
				t.Fatalf("cmd=%q: got %q, want %q", cmdCombined, gotOut, wantOut)
			}
		})
	}
}
