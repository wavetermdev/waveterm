//go:build windows

package remote

import (
	"testing"
	"time"
)

func TestDialIdentityAgentWindowsTimeout(t *testing.T) {
	start := time.Now()
	_, err := dialIdentityAgent(`\\.\\pipe\\waveterm-nonexistent-agent`)
	if err == nil {
		t.Skip("unexpectedly connected to a test pipe; skipping")
	}
	// Optionally verify error indicates connection/timeout failure
	t.Logf("dialIdentityAgent returned expected error: %v", err)
	if time.Since(start) > 3*time.Second {
		t.Fatalf("dialIdentityAgent exceeded expected timeout window")
	}
}
