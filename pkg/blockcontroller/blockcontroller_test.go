// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/utilds"

)

// mockConnInterface implements shellexec.ConnInterface for testing.
// It tracks calls to Kill, KillGraceful, Wait, Close to detect double-calls.
type mockConnInterface struct {
	mu                sync.Mutex
	killCount         int
	killGracefulCount int
	waitCount         int
	closeCount        int
	waitErr           error
	waitCh            chan struct{} // closed when Wait is called
	fdVal             uintptr
	nameVal           string
}

func (m *mockConnInterface) Fd() uintptr { return m.fdVal }
func (m *mockConnInterface) Name() string { return m.nameVal }
func (m *mockConnInterface) Read(p []byte) (int, error) { return 0, io.EOF }
func (m *mockConnInterface) Write(p []byte) (int, error) { return len(p), nil }
func (m *mockConnInterface) Close() error {
	m.mu.Lock()
	m.closeCount++
	m.mu.Unlock()
	return nil
}
func (m *mockConnInterface) WriteString(s string) (int, error) { return len(s), nil }

func (m *mockConnInterface) Kill() {
	m.mu.Lock()
	m.killCount++
	m.mu.Unlock()
}

func (m *mockConnInterface) KillGraceful(timeout time.Duration) {
	m.mu.Lock()
	m.killGracefulCount++
	m.mu.Unlock()
}

func (m *mockConnInterface) Wait() error {
	m.mu.Lock()
	m.waitCount++
	m.mu.Unlock()
	if m.waitCh != nil {
		close(m.waitCh)
		m.waitCh = nil
	}
	return m.waitErr
}

func (m *mockConnInterface) Start() error { return nil }
func (m *mockConnInterface) ExitCode() int { return 0 }
func (m *mockConnInterface) ExitSignal() string { return "" }
func (m *mockConnInterface) StdinPipe() (io.WriteCloser, error) { return nil, nil }
func (m *mockConnInterface) StdoutPipe() (io.ReadCloser, error) { return nil, nil }
func (m *mockConnInterface) StderrPipe() (io.ReadCloser, error) { return nil, nil }
func (m *mockConnInterface) SetSize(w int, h int) error { return nil }

// slowMockConnInterface is like mockConnInterface but Wait() blocks for a
// configurable duration, simulating a real SSH session that takes time to exit.
// This is essential for exposing the Lock/Unlock/Relock race in ShellController.Stop.
type slowMockConnInterface struct {
	mu                sync.Mutex
	killCount         int
	killGracefulCount int
	waitCount         int
	closeCount        int
	waitDone          chan struct{} // signals when Wait() should return
	waitStarted       chan struct{} // signals when Wait() has been entered
}

func (m *slowMockConnInterface) Fd() uintptr { return 0 }
func (m *slowMockConnInterface) Name() string { return "slow-mock" }
func (m *slowMockConnInterface) Read(p []byte) (int, error) { return 0, io.EOF }
func (m *slowMockConnInterface) Write(p []byte) (int, error) { return len(p), nil }
func (m *slowMockConnInterface) Close() error {
	m.mu.Lock()
	m.closeCount++
	m.mu.Unlock()
	return nil
}
func (m *slowMockConnInterface) WriteString(s string) (int, error) { return len(s), nil }

func (m *slowMockConnInterface) Kill() {
	m.mu.Lock()
	m.killCount++
	m.mu.Unlock()
}

func (m *slowMockConnInterface) KillGraceful(timeout time.Duration) {
	m.mu.Lock()
	m.killGracefulCount++
	m.mu.Unlock()
	// Simulate the real KillGraceful: signal Wait to complete.
	// Use select to avoid panic on double-close (the real SSH session
	// Close does not panic on double-call, but our mock channel does).
	select {
	case <-m.waitDone:
		// already closed
	default:
		close(m.waitDone)
	}
}

func (m *slowMockConnInterface) Wait() error {
	m.mu.Lock()
	m.waitCount++
	m.mu.Unlock()
	if m.waitStarted != nil {
		close(m.waitStarted)
		m.waitStarted = nil
	}
	<-m.waitDone
	return nil
}

func (m *slowMockConnInterface) Start() error { return nil }
func (m *slowMockConnInterface) ExitCode() int { return 0 }
func (m *slowMockConnInterface) ExitSignal() string { return "" }
func (m *slowMockConnInterface) StdinPipe() (io.WriteCloser, error) { return nil, nil }
func (m *slowMockConnInterface) StdoutPipe() (io.ReadCloser, error) { return nil, nil }
func (m *slowMockConnInterface) StderrPipe() (io.ReadCloser, error) { return nil, nil }
func (m *slowMockConnInterface) SetSize(w int, h int) error { return nil }

func makeSlowMockShellProc() *shellexec.ShellProc {
	mockCmd := &slowMockConnInterface{
		waitDone:    make(chan struct{}),
		waitStarted: make(chan struct{}),
	}
	return &shellexec.ShellProc{
		ConnName:  "test",
		Cmd:       mockCmd,
		CloseOnce: &sync.Once{},
		DoneCh:    make(chan any),
	}
}

func makeMockShellProc() *shellexec.ShellProc {
	mockCmd := &mockConnInterface{
		waitCh: make(chan struct{}),
	}
	return &shellexec.ShellProc{
		ConnName:  "test",
		Cmd:       mockCmd,
		CloseOnce: &sync.Once{},
		DoneCh:    make(chan any),
	}
}

// TestShellControllerStopConcurrent tests that two concurrent Stop calls
// on a ShellController do not cause a double-Close on the underlying ShellProc.
//
// This tests the race condition identified in the tab-close-after-SSH-exit bug:
// CloseTab launches DestroyBlockController in a goroutine, and DeleteTab also
// triggers DestroyBlockController via sendBlockCloseEvent. Both call Stop concurrently.
//
// The Lock/Unlock/Relock pattern in Stop creates a window where a second Stop
// can enter and call ShellProc.Close() again while the first is waiting on DoneCh.
func TestShellControllerStopConcurrent(t *testing.T) {
	t.Parallel()

	t.Run("double_stop_does_not_double_kill", func(t *testing.T) {
		t.Parallel()

		// Use the slow mock so Wait() blocks, exposing the Lock/Unlock/Relock race.
		// With the fast mock, Wait() returns instantly so the race window is too small.
		mockProc := makeSlowMockShellProc()
		mockCmd := mockProc.Cmd.(*slowMockConnInterface)

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Running,
			ShellProc:      mockProc,
			VersionTs:      utilds.VersionTs{},
		}

		var wg sync.WaitGroup
		wg.Add(2)

		// Launch two concurrent Stop calls (simulating the double-destroy race)
		go func() {
			defer wg.Done()
			sc.Stop(true, Status_Done, true)
		}()
		go func() {
			defer wg.Done()
			// Small delay to let the first Stop acquire the lock and enter the graceful wait
			time.Sleep(10 * time.Millisecond)
			sc.Stop(true, Status_Done, true)
		}()

		wg.Wait()

		// Verify that KillGraceful was called at most once.
		// A double-call indicates the race condition is NOT protected.
		mockCmd.mu.Lock()
		killGracefulCount := mockCmd.killGracefulCount
		closeCount := mockCmd.closeCount
		mockCmd.mu.Unlock()

		if killGracefulCount > 1 {
			t.Errorf("KillGraceful was called %d times; expected at most 1. This indicates a race condition where concurrent Stop calls both close the ShellProc.", killGracefulCount)
		}
		if closeCount > 1 {
			t.Errorf("Close was called %d times; expected at most 1. Double-close on SSH sessions can cause errors or panics.", closeCount)
		}
	})

	t.Run("stop_after_proc_done_is_noop", func(t *testing.T) {
		t.Parallel()

		mockProc := makeMockShellProc()
		mockCmd := mockProc.Cmd.(*mockConnInterface)

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-done",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Done,
			ShellProc:      mockProc,
			VersionTs:      utilds.VersionTs{},
		}

		sc.Stop(true, Status_Done, true)

		mockCmd.mu.Lock()
		killCount := mockCmd.killCount
		mockCmd.mu.Unlock()

		if killCount != 0 {
			t.Errorf("Kill was called %d times on a Done proc; expected 0 (should be a no-op)", killCount)
		}
	})

	t.Run("stop_sets_status_done", func(t *testing.T) {
		t.Parallel()

		mockProc := makeMockShellProc()

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-status",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Running,
			ShellProc:      mockProc,
			VersionTs:      utilds.VersionTs{},
		}

		sc.Stop(true, Status_Done, true)

		if sc.ProcStatus != Status_Done {
			t.Errorf("ProcStatus = %q; expected %q", sc.ProcStatus, Status_Done)
		}
	})
}

// TestDestroyBlockControllerDoubleCall tests that concurrent calls to
// DestroyBlockController for the same blockId are safe and do not
// cause double-Stops or other side effects.
//
// This directly tests the race in CloseTab where both the explicit goroutine
// and the sendBlockCloseEvent handler call DestroyBlockController for the same block.
func TestDestroyBlockControllerDoubleCall(t *testing.T) {
	t.Parallel()

	// Register a test controller
	testBlockId := "test-block-destroy-double"
	testController := &ShellController{
		Lock:           &sync.Mutex{},
		ControllerType: BlockController_Shell,
		TabId:          "test-tab",
		BlockId:        testBlockId,
		ConnName:       "ssh:test",
		RunLock:        &atomic.Bool{},
		ProcStatus:     Status_Running,
		ShellProc:      makeMockShellProc(),
		VersionTs:      utilds.VersionTs{},
	}

	registerController(testBlockId, testController)

	// Clean up registry after test
	defer deleteController(testBlockId)

	var wg sync.WaitGroup
	wg.Add(2)

	// Simulate the double-destroy race from CloseTab
	go func() {
		defer wg.Done()
		DestroyBlockController(testBlockId)
	}()
	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond) // slight delay to increase race likelihood
		DestroyBlockController(testBlockId)
	}()

	wg.Wait()

	// After both calls, the controller should be removed from the registry
	controller := getController(testBlockId)
	if controller != nil {
		t.Errorf("controller still in registry after DestroyBlockController; expected nil")
	}
}

// TestDestroyBlockControllerDoubleCallDurable tests the same double-destroy
// race but with a DurableShellController, which uses jobcontroller.TerminateAndDetachJob.
func TestDestroyBlockControllerDoubleCallDurable(t *testing.T) {
	t.Parallel()

	testBlockId := "test-block-destroy-durable"
	testController := &DurableShellController{
		Lock:            &sync.Mutex{},
		ControllerType:  BlockController_Shell,
		TabId:           "test-tab",
		BlockId:         testBlockId,
		ConnName:        "ssh:test",
		LastKnownStatus: Status_Init,
		InputSessionId:  "test-session",
	}

	registerController(testBlockId, testController)

	defer deleteController(testBlockId)

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		DestroyBlockController(testBlockId)
	}()
	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond)
		DestroyBlockController(testBlockId)
	}()

	wg.Wait()

	controller := getController(testBlockId)
	if controller != nil {
		t.Errorf("controller still in registry after DestroyBlockController; expected nil")
	}
}

// TestDurableShellControllerStopConcurrent tests that two concurrent Stop calls
// on a DurableShellController do not cause issues.
// DurableShellController.Stop calls TerminateAndDetachJob without any lock,
// so concurrent calls could race on the jobId field.
func TestDurableShellControllerStopConcurrent(t *testing.T) {
	t.Parallel()

	t.Run("stop_with_empty_jobid_is_noop", func(t *testing.T) {
		t.Parallel()

		dsc := &DurableShellController{
			Lock:            &sync.Mutex{},
			ControllerType:  BlockController_Shell,
			TabId:           "test-tab",
			BlockId:         "test-block-durable-stop",
			ConnName:        "ssh:test",
			LastKnownStatus: Status_Init,
			InputSessionId:  "test-session",
		}

		// Stop with no jobId should be a no-op
		dsc.Stop(true, Status_Done, true)
		// No panic = pass
	})

	t.Run("stop_without_destroy_is_noop", func(t *testing.T) {
		t.Parallel()

		dsc := &DurableShellController{
			Lock:            &sync.Mutex{},
			ControllerType:  BlockController_Shell,
			TabId:           "test-tab",
			BlockId:         "test-block-durable-stop-2",
			ConnName:        "ssh:test",
			JobId:           "test-job",
			LastKnownStatus: Status_Running,
			InputSessionId:  "test-session",
		}

		// Stop with destroy=false should be a no-op
		dsc.Stop(true, Status_Done, false)
		// No panic = pass
	})
}

// TestShellControllerStopNilShellProc tests that Stop handles the case
// where ShellProc is nil (e.g., shell exited and was already cleaned up).
func TestShellControllerStopNilShellProc(t *testing.T) {
	t.Parallel()

	t.Run("nil_proc_updates_status", func(t *testing.T) {
		t.Parallel()

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-nil-proc",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Running,
			ShellProc:      nil,
			VersionTs:      utilds.VersionTs{},
		}

		// When ShellProc is nil, Stop still updates status if newStatus differs
		sc.Stop(true, Status_Done, true)
		if sc.ProcStatus != Status_Done {
			t.Errorf("ProcStatus = %q; expected %q", sc.ProcStatus, Status_Done)
		}
	})

	t.Run("nil_proc_already_done_noop", func(t *testing.T) {
		t.Parallel()

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-nil-proc-done",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Done,
			ShellProc:      nil,
			VersionTs:      utilds.VersionTs{},
		}

		// When ProcStatus is already Done and ShellProc is nil, Stop is a no-op
		sc.Stop(true, Status_Done, true)
		// No panic = pass
	})

	t.Run("nil_proc_init_status", func(t *testing.T) {
		t.Parallel()

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-nil-proc-init",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Init,
			ShellProc:      nil,
			VersionTs:      utilds.VersionTs{},
		}

		// When ProcStatus is Init and ShellProc is nil, Stop is a no-op
		sc.Stop(true, Status_Done, true)
		// No panic = pass
	})
}

// TestShellProcDoubleClose tests that calling ShellProc.Close() twice
// does not panic. This simulates the actual race condition where
// two concurrent Stop calls both close the ShellProc.
func TestShellProcDoubleClose(t *testing.T) {
	t.Parallel()

	t.Run("double_close_on_running_proc", func(t *testing.T) {
		t.Parallel()

		mockProc := makeSlowMockShellProc()
		mockCmd := mockProc.Cmd.(*slowMockConnInterface)

		var wg sync.WaitGroup
		wg.Add(2)

		// Call Close concurrently (simulating the race)
		go func() {
			defer wg.Done()
			mockProc.Close()
		}()
		go func() {
			defer wg.Done()
			time.Sleep(5 * time.Millisecond)
			mockProc.Close()
		}()

		// The slowMockConnInterface.KillGraceful() already closes waitDone,
		// so Wait() returns immediately. No manual close needed.
		wg.Wait()

		// Wait for the DoneCh to be closed
		<-mockProc.DoneCh

		mockCmd.mu.Lock()
		killGracefulCount := mockCmd.killGracefulCount
		closeCount := mockCmd.closeCount
		mockCmd.mu.Unlock()

		// KillGraceful may be called multiple times (once per Close call),
		// but should not panic. Log if it happens more than once.
		if killGracefulCount > 1 {
			t.Logf("WARNING: KillGraceful was called %d times (expected 1). This indicates ShellProc.Close is not idempotent and the race condition allows double-kills.", killGracefulCount)
		}
		if closeCount > 1 {
			t.Logf("WARNING: Close was called %d times (expected 1). Double-close on SSH sessions can cause errors.", closeCount)
		}
	})

	t.Run("close_then_wait", func(t *testing.T) {
		t.Parallel()

		mockProc := makeMockShellProc()
		mockCmd := mockProc.Cmd.(*mockConnInterface)

		// Simulate the real flow: Close is called, then Wait is called
		mockProc.Close()

		// Wait for DoneCh
		<-mockProc.DoneCh

		// Second Close should not panic even after Wait
		mockProc.Close()

		mockCmd.mu.Lock()
		waitCount := mockCmd.waitCount
		mockCmd.mu.Unlock()

		// Wait should only execute once (protected by sync.Once in ShellProc)
		if waitCount > 1 {
			t.Errorf("Wait was called %d times; expected at most 1 (should be protected by sync.Once)", waitCount)
		}
	})
}

// TestShellControllerStopRaceWithDoneStatus tests the specific race where
// one goroutine sees ProcStatus as Running and enters Close, while another
// goroutine updates ProcStatus to Done concurrently. This is the exact
// scenario from the bug: the shell exits (setting Done) while the tab
// close triggers Stop (seeing Running).
func TestShellControllerStopRaceWithDoneStatus(t *testing.T) {
	t.Parallel()

	// This test simulates the real-world scenario:
	// 1. Shell process exits (manageRunningShellProcess wait loop sets ProcStatus=Done)
	// 2. Tab close triggers Stop (sees Running, calls Close)
	// Both happen concurrently.

	mockProc := makeSlowMockShellProc()
	mockCmd := mockProc.Cmd.(*slowMockConnInterface)

	sc := &ShellController{
		Lock:           &sync.Mutex{},
		ControllerType: BlockController_Shell,
		TabId:          "test-tab",
		BlockId:        "test-block-race-done",
		ConnName:       "ssh:test",
		RunLock:        &atomic.Bool{},
		ProcStatus:     Status_Running,
		ShellProc:      mockProc,
		VersionTs:      utilds.VersionTs{},
	}

	var wg sync.WaitGroup
	wg.Add(2)

	// Goroutine 1: simulates tab close calling Stop
	go func() {
		defer wg.Done()
		sc.Stop(true, Status_Done, true)
	}()

	// Goroutine 2: simulates the shell exiting (sets Done status)
	// This mimics what manageRunningShellProcess does via UpdateControllerAndSendUpdate
	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond)
		sc.UpdateControllerAndSendUpdate(func() bool {
			if sc.ProcStatus == Status_Running {
				sc.ProcStatus = Status_Done
			}
			return true
		})
	}()

	wg.Wait()

	// Final status should be Done
	if sc.ProcStatus != Status_Done {
		t.Errorf("ProcStatus = %q; expected %q", sc.ProcStatus, Status_Done)
	}

	mockCmd.mu.Lock()
	killGracefulCount := mockCmd.killGracefulCount
	mockCmd.mu.Unlock()

	// The key question: was KillGraceful called even though the shell was exiting?
	// In the current implementation, Stop checks ProcStatus BEFORE calling Close,
	// but the Lock/Unlock/Relock pattern creates a window where the status may
	// change between the check and the Close call.
	if killGracefulCount > 1 {
		t.Logf("KillGraceful was called %d times. This may indicate the race between shell exit and tab close causes redundant close operations.", killGracefulCount)
	}
}

// TestShellControllerStopDoesNotPanicOnClosedSession tests that calling Stop
// on a ShellController whose underlying SSH session has already been closed
// (e.g., after user typed exit) does not panic.
func TestShellControllerStopDoesNotPanicOnClosedSession(t *testing.T) {
	t.Parallel()

	t.Run("closed_session_stop", func(t *testing.T) {
		t.Parallel()

		// mockClosedConn simulates an SSH session that has already been closed.
		// KillGraceful and Close return errors (simulating a closed channel).
		mockCmd := &mockClosedConnInterface{}

		mockProc := &shellexec.ShellProc{
			ConnName:  "ssh:test",
			Cmd:       mockCmd,
			CloseOnce: &sync.Once{},
			DoneCh:    make(chan any),
		}

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-closed-session",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Running,
			ShellProc:      mockProc,
			VersionTs:      utilds.VersionTs{},
		}

		// Stop should not panic even when the underlying session is closed
		sc.Stop(true, Status_Done, true)
		if sc.ProcStatus != Status_Done {
			t.Errorf("ProcStatus = %q; expected %q", sc.ProcStatus, Status_Done)
		}
	})

	t.Run("concurrent_stop_on_closing_session", func(t *testing.T) {
		t.Parallel()

		// Test concurrent Stop calls on a session that is closing (simulating
		// the real scenario where the SSH shell has exited and tab close happens).
		mockProc := makeSlowMockShellProc()
		mockCmd := mockProc.Cmd.(*slowMockConnInterface)

		sc := &ShellController{
			Lock:           &sync.Mutex{},
			ControllerType: BlockController_Shell,
			TabId:          "test-tab",
			BlockId:        "test-block-concurrent-close",
			ConnName:       "ssh:test",
			RunLock:        &atomic.Bool{},
			ProcStatus:     Status_Running,
			ShellProc:      mockProc,
			VersionTs:      utilds.VersionTs{},
		}

		var wg sync.WaitGroup
		wg.Add(3)

		// Goroutine 1: First Stop call (simulates CloseTab goroutine)
		go func() {
			defer wg.Done()
			sc.Stop(true, Status_Done, true)
		}()

		// Goroutine 2: Second Stop call (simulates sendBlockCloseEvent handler)
		go func() {
			defer wg.Done()
			time.Sleep(10 * time.Millisecond)
			sc.Stop(true, Status_Done, true)
		}()

		// Goroutine 3: Simulate the shell exiting concurrently.
		// In this mock, KillGraceful already signals Wait to complete,
		// so no manual channel close is needed.
		go func() {
			defer wg.Done()
			time.Sleep(20 * time.Millisecond)
		}()

		wg.Wait()

		mockCmd.mu.Lock()
		killGracefulCount := mockCmd.killGracefulCount
		closeCount := mockCmd.closeCount
		mockCmd.mu.Unlock()

		if killGracefulCount > 1 {
			t.Errorf("KillGraceful was called %d times on a closing session; expected at most 1. Double-kill on a closing SSH session can cause errors or panics in the ssh package.", killGracefulCount)
		}
		if closeCount > 1 {
			t.Errorf("Close was called %d times on a closing session; expected at most 1.", closeCount)
		}
	})
}

// mockClosedConnInterface simulates a closed SSH session where operations
// return errors (as would happen after the remote side has exited/closed).
type mockClosedConnInterface struct {
	mu sync.Mutex
	closeCount int
}

func (m *mockClosedConnInterface) Fd() uintptr { return 0 }
func (m *mockClosedConnInterface) Name() string { return "closed-session" }
func (m *mockClosedConnInterface) Read(p []byte) (int, error) { return 0, io.EOF }
func (m *mockClosedConnInterface) Write(p []byte) (int, error) { return 0, errors.New("session closed") }
func (m *mockClosedConnInterface) Close() error {
	m.mu.Lock()
	m.closeCount++
	m.mu.Unlock()
	return errors.New("session already closed")
}
func (m *mockClosedConnInterface) WriteString(s string) (int, error) { return 0, errors.New("session closed") }

func (m *mockClosedConnInterface) Kill() {}
func (m *mockClosedConnInterface) KillGraceful(timeout time.Duration) {}
func (m *mockClosedConnInterface) Wait() error { return errors.New("session exited") }
func (m *mockClosedConnInterface) Start() error { return errors.New("session closed") }
func (m *mockClosedConnInterface) ExitCode() int { return 0 }
func (m *mockClosedConnInterface) ExitSignal() string { return "" }
func (m *mockClosedConnInterface) StdinPipe() (io.WriteCloser, error) { return nil, errors.New("session closed") }
func (m *mockClosedConnInterface) StdoutPipe() (io.ReadCloser, error) { return nil, errors.New("session closed") }
func (m *mockClosedConnInterface) StderrPipe() (io.ReadCloser, error) { return nil, errors.New("session closed") }
func (m *mockClosedConnInterface) SetSize(w int, h int) error { return errors.New("session closed") }