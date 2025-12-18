//go:build !windows

package remote

import (
	"net"
	"path/filepath"
	"testing"
)

func TestDialIdentityAgentUnix(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")

	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen unix socket: %v", err)
	}
	defer ln.Close()

	acceptDone := make(chan struct{})
	go func() {
		conn, _ := ln.Accept()
		if conn != nil {
			conn.Close()
		}
		close(acceptDone)
	}()

	conn, err := dialIdentityAgent(socketPath)
	if err != nil {
		t.Fatalf("dialIdentityAgent: %v", err)
	}
	conn.Close()
	<-acceptDone
}
