// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
)

// makeTestConn creates a minimal SSHConn suitable for unit tests.
func makeTestConn(status string) *SSHConn {
	conn := &SSHConn{
		lock:             &sync.Mutex{},
		lifecycleLock:    &sync.Mutex{},
		Status:           status,
		ConnHealthStatus: ConnHealthStatus_Good,
		WshEnabled:       &atomic.Bool{},
		Opts:             &remote.SSHOpts{SSHHost: "testhost", SSHUser: "testuser", SSHPort: "2222"},
	}
	globalLock.Lock()
	clientControllerMap[*conn.Opts] = conn
	globalLock.Unlock()
	return conn
}

// cleanupTestConn removes the test connection from the global map.
func cleanupTestConn(conn *SSHConn) {
	globalLock.Lock()
	delete(clientControllerMap, *conn.Opts)
	globalLock.Unlock()
}

// makeTestMonitor creates a ConnMonitor with the given connection and a dummy client.
func makeTestMonitor(conn *SSHConn) *ConnMonitor {
	return &ConnMonitor{
		lock:          &sync.Mutex{},
		Conn:          conn,
		Client:        &ssh.Client{}, // dummy client to satisfy non-nil check if needed
		inputNotifyCh: make(chan int64, 1),
	}
}

// TestAttemptReconnectLocalConn verifies that local connections return nil immediately.
func TestAttemptReconnectLocalConn(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	err := AttemptReconnect(ctx, "local")
	if err != nil {
		t.Fatalf("expected nil for local conn, got %v", err)
	}
}

// TestAttemptReconnectInvalidName verifies that invalid connection names return an error.
func TestAttemptReconnectInvalidName(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	err := AttemptReconnect(ctx, "not-a-valid-ssh-name")
	if err == nil {
		t.Fatalf("expected error for invalid conn name, got nil")
	}
}

// TestAttemptReconnectNotInMap verifies that connections not in the controller map return an error.
func TestAttemptReconnectNotInMap(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	err := AttemptReconnect(ctx, "user@unknownhost:22")
	if err == nil {
		t.Fatalf("expected error for unknown conn, got nil")
	}
}

// TestAttemptReconnectAlreadyConnected verifies that an already-connected connection returns nil.
func TestAttemptReconnectAlreadyConnected(t *testing.T) {
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)

	ctx := context.Background()
	err := AttemptReconnect(ctx, conn.GetName())
	if err != nil {
		t.Fatalf("expected nil for already-connected conn, got %v", err)
	}
}

// TestAttemptReconnectSuccess verifies that a disconnected connection is reconnected.
func TestAttemptReconnectSuccess(t *testing.T) {
	conn := makeTestConn(Status_Disconnected)
	defer cleanupTestConn(conn)

	// Mock connectInternal so we don't need a real SSH server
	connectInternalTestHook = func(c *SSHConn, ctx context.Context, flags *wconfig.ConnKeywords) error {
		c.WithLock(func() {
			c.Status = Status_Connected
		})
		return nil
	}
	defer func() { connectInternalTestHook = nil }()

	ctx := context.Background()
	err := AttemptReconnect(ctx, conn.GetName())
	if err != nil {
		t.Fatalf("expected nil after successful reconnect, got %v", err)
	}
	if conn.GetStatus() != Status_Connected {
		t.Fatalf("expected status=Connected, got %s", conn.GetStatus())
	}
}

// TestAttemptReconnectConnectFailure verifies that connect errors are propagated.
func TestAttemptReconnectConnectFailure(t *testing.T) {
	conn := makeTestConn(Status_Disconnected)
	defer cleanupTestConn(conn)

	connectInternalTestHook = func(c *SSHConn, ctx context.Context, flags *wconfig.ConnKeywords) error {
		return fmt.Errorf("mock connect failure")
	}
	defer func() { connectInternalTestHook = nil }()

	ctx := context.Background()
	err := AttemptReconnect(ctx, conn.GetName())
	if err == nil {
		t.Fatalf("expected error after failed reconnect, got nil")
	}
}

// TestGetStallDisconnectThresholdMsDefault verifies the 30s default.
func TestGetStallDisconnectThresholdMsDefault(t *testing.T) {
	t.Parallel()
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	ms := cm.getStallDisconnectThresholdMs()
	if ms != 30000 {
		t.Fatalf("expected default 30000ms, got %d", ms)
	}
}

// TestGetStallDisconnectThresholdMsFromConfig verifies reading from connection config.
func TestGetStallDisconnectThresholdMsFromConfig(t *testing.T) {
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	getConnectionConfigTestHook = func(c *SSHConn) (wconfig.ConnKeywords, bool) {
		threshold := 15
		return wconfig.ConnKeywords{ConnStallDisconnectThreshold: &threshold}, true
	}
	defer func() { getConnectionConfigTestHook = nil }()

	ms := cm.getStallDisconnectThresholdMs()
	if ms != 15000 {
		t.Fatalf("expected 15000ms (15s), got %d", ms)
	}
}

// TestShouldAutoDisconnectOnStallDefault verifies default true.
func TestShouldAutoDisconnectOnStallDefault(t *testing.T) {
	t.Parallel()
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	if !cm.shouldAutoDisconnectOnStall() {
		t.Fatalf("expected default true")
	}
}

// TestShouldAutoDisconnectOnStallRespectsConfig verifies conn:stallautodisconnect=false.
func TestShouldAutoDisconnectOnStallRespectsConfig(t *testing.T) {
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	disabled := false
	getConnectionConfigTestHook = func(c *SSHConn) (wconfig.ConnKeywords, bool) {
		return wconfig.ConnKeywords{ConnStallAutoDisconnect: &disabled}, true
	}
	defer func() { getConnectionConfigTestHook = nil }()

	if cm.shouldAutoDisconnectOnStall() {
		t.Fatalf("expected false when config disabled")
	}
}

// TestDisconnectOnStallChangesStatus verifies that disconnectOnStall sets Status=Disconnected.
func TestDisconnectOnStallChangesStatus(t *testing.T) {
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	cm.disconnectOnStall()

	// Allow the goroutine inside disconnectOnStall to run
	time.Sleep(100 * time.Millisecond)

	status := conn.GetStatus()
	if status != Status_Disconnected {
		t.Fatalf("expected Status=Disconnected after stall disconnect, got %s", status)
	}
}

// TestDisconnectOnStallSkipsWhenDisabled verifies no disconnect when auto-disconnect is disabled.
func TestDisconnectOnStallSkipsWhenDisabled(t *testing.T) {
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	disabled := false
	getConnectionConfigTestHook = func(c *SSHConn) (wconfig.ConnKeywords, bool) {
		return wconfig.ConnKeywords{ConnStallAutoDisconnect: &disabled}, true
	}
	defer func() { getConnectionConfigTestHook = nil }()

	cm.disconnectOnStall()
	time.Sleep(100 * time.Millisecond)

	if conn.GetStatus() != Status_Connected {
		t.Fatalf("expected Status to remain Connected when auto-disconnect disabled")
	}
}

// TestStallStartTimeTracking verifies StallStartTime is set on stall and reset when stall clears.
func TestStallStartTimeTracking(t *testing.T) {
	conn := makeTestConn(Status_Connected)
	defer cleanupTestConn(conn)
	cm := makeTestMonitor(conn)

	// Simulate: keepalive in-flight, no response, activity stale
	cm.LastActivityTime.Store(time.Now().UnixMilli() - 20000)
	cm.KeepAliveInFlight = true
	cm.KeepAliveSentTime.Store(time.Now().UnixMilli() - 15000)

	cm.checkConnection()
	if cm.StallStartTime.Load() == 0 {
		t.Fatalf("expected StallStartTime to be set after stall detection")
	}

	// Simulate stall clearing (keepalive returned, activity restored)
	cm.KeepAliveInFlight = false
	cm.LastActivityTime.Store(time.Now().UnixMilli())
	cm.checkConnection()
	if cm.StallStartTime.Load() != 0 {
		t.Fatalf("expected StallStartTime to be reset after stall clears")
	}
}
