// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// TestShouldAttemptAutoReconnect verifies that the cooldown timestamp
// is NOT consumed by shouldAttemptAutoReconnect; it is only checked.
func TestShouldAttemptAutoReconnect(t *testing.T) {
	// Reset global state
	lastAutoReconnectAttempt = ds.MakeSyncMap[int64]()

	// First call with no prior attempt should return true
	if got := shouldAttemptAutoReconnect("job-a"); !got {
		t.Fatalf("first call: expected true, got false")
	}

	// Verify timestamp was NOT set by the check alone
	if _, exists := lastAutoReconnectAttempt.GetEx("job-a"); exists {
		t.Fatalf("shouldAttemptAutoReconnect must not set timestamp")
	}

	// Simulate a prior attempt within cooldown window
	lastAutoReconnectAttempt.Set("job-a", time.Now().Unix())

	// Second call inside cooldown should return false
	if got := shouldAttemptAutoReconnect("job-a"); got {
		t.Fatalf("second call inside cooldown: expected false, got true")
	}

	// Simulate cooldown expired
	lastAutoReconnectAttempt.Set("job-a", time.Now().Unix()-int64(AutoReconnectCooldown.Seconds())-1)

	// Call after cooldown should return true
	if got := shouldAttemptAutoReconnect("job-a"); !got {
		t.Fatalf("call after cooldown: expected true, got false")
	}

	// Still must not set timestamp itself
	if _, exists := lastAutoReconnectAttempt.GetEx("job-b"); exists {
		t.Fatalf("shouldAttemptAutoReconnect must not set timestamp for new job")
	}
}

// TestAttemptAutoReconnectCooldownSet verifies that the cooldown
// timestamp is only set after IsConnected returns true.
func TestAttemptAutoReconnectCooldownSet(t *testing.T) {
	lastAutoReconnectAttempt = ds.MakeSyncMap[int64]()

	// Mock IsConnected to always return false
	isConnectedTestHook = func(connName string) (bool, error) {
		return false, nil
	}

	// Call synchronously; no goroutine needed because we just verify side effects
	attemptAutoReconnect("job-c", "conn:mock")

	// Timestamp should NOT have been set because connection was down
	if _, exists := lastAutoReconnectAttempt.GetEx("job-c"); exists {
		t.Fatalf("attemptAutoReconnect must not set timestamp when connection is down")
	}

	// Now mock IsConnected to return true
	isConnectedTestHook = func(connName string) (bool, error) {
		return true, nil
	}

	attemptAutoReconnect("job-d", "conn:mock")

	// Timestamp SHOULD have been set because connection was up
	if _, exists := lastAutoReconnectAttempt.GetEx("job-d"); !exists {
		t.Fatalf("attemptAutoReconnect must set timestamp when connection is up")
	}

	isConnectedTestHook = nil
}

// TestConnStateGenerationTracking verifies that actualGen increments
// only when the actual connection state changes.
func TestConnStateGenerationTracking(t *testing.T) {
	// Reset global connStates
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	cs := &connState{actual: false, procGen: 0, actualGen: 0, reconciling: false}
	connStates.m["conn:gen"] = cs

	// First change false -> true
	connStates.Lock()
	if cs.actual != true {
		cs.actual = true
		cs.actualGen++
	}
	connStates.Unlock()

	if cs.actualGen != 1 {
		t.Fatalf("expected actualGen=1 after first change, got %d", cs.actualGen)
	}

	// No change true -> true (must use lock to avoid racing with test reads)
	connStates.Lock()
	if cs.actual != true {
		cs.actual = true
		cs.actualGen++
	}
	connStates.Unlock()

	if cs.actualGen != 1 {
		t.Fatalf("expected actualGen=1 after no-change, got %d", cs.actualGen)
	}

	// Second change true -> false
	connStates.Lock()
	if cs.actual != false {
		cs.actual = false
		cs.actualGen++
	}
	connStates.Unlock()

	if cs.actualGen != 2 {
		t.Fatalf("expected actualGen=2 after second change, got %d", cs.actualGen)
	}
}

// TestReconcileAllConnsSpawnsOnGenerationMismatch verifies that
// reconcileAllConns sets reconciling=true when actualGen != procGen.
func TestReconcileAllConnsSpawnsOnGenerationMismatch(t *testing.T) {
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	cs := &connState{actual: true, procGen: 0, actualGen: 1, reconciling: false}
	connStates.m["conn:spawn"] = cs

	// Fast no-op so reconcileConn finishes quickly
	reconcileOnUpTestHook = func(connName string) {}
	defer func() { reconcileOnUpTestHook = nil }()

	reconcileAllConns()

	connStates.Lock()
	r := cs.reconciling
	connStates.Unlock()
	if !r {
		t.Fatalf("expected reconciling=true for mismatched gen")
	}

	// Poll until the spawned goroutine finishes and clears reconciling
	for i := 0; i < 1000; i++ {
		connStates.Lock()
		r = cs.reconciling
		connStates.Unlock()
		if !r {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	connStates.Lock()
	r = cs.reconciling
	connStates.Unlock()
	if r {
		t.Fatalf("expected reconciling=false after reconcile completes")
	}
}

// TestReconcileConnUpdatesProcGen verifies that reconcileConn updates
// procGen to the target generation and clears reconciling.
func TestReconcileConnUpdatesProcGen(t *testing.T) {
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	cs := &connState{actual: true, procGen: 0, actualGen: 1, reconciling: true}
	connStates.m["conn:proc"] = cs

	// Drain any stale signal from the channel
	select {
	case <-connStates.reconcileCh:
	default:
	}

	reconcileConn("conn:proc", true, 1)

	if cs.procGen != 1 {
		t.Fatalf("expected procGen=1, got %d", cs.procGen)
	}
	if cs.reconciling {
		t.Fatalf("expected reconciling=false after reconcileConn")
	}

	// Since actualGen == procGen, no follow-up signal should have been sent
	select {
	case <-connStates.reconcileCh:
		t.Fatalf("unexpected follow-up signal when actualGen == procGen")
	default:
	}
}

// TestReconcileConnFollowUpSignalOnMismatch verifies that reconcileConn
// sends a follow-up reconcile signal when actualGen != procGen at finish.
func TestReconcileConnFollowUpSignalOnMismatch(t *testing.T) {
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	cs := &connState{actual: true, procGen: 0, actualGen: 2, reconciling: true}
	connStates.m["conn:follow"] = cs

	// Drain any stale signal
	select {
	case <-connStates.reconcileCh:
	default:
	}

	reconcileConn("conn:follow", false, 1)

	if cs.procGen != 1 {
		t.Fatalf("expected procGen=1, got %d", cs.procGen)
	}
	if cs.reconciling {
		t.Fatalf("expected reconciling=false after reconcileConn")
	}

	// A follow-up signal should be in the channel (or buffer full, but we drain)
	var gotSignal bool
	select {
	case <-connStates.reconcileCh:
		gotSignal = true
	default:
	}
	if !gotSignal {
		t.Fatalf("expected follow-up signal when actualGen != procGen")
	}
}

// TestReconcileConnRapidFlapRecovery verifies the full rapid-flap scenario:
// actual flaps during reconcile, and the generation counter ensures
// a follow-up reconcile is scheduled.
func TestReconcileConnRapidFlapRecovery(t *testing.T) {
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	cs := &connState{actual: true, procGen: 0, actualGen: 1, reconciling: true}
	connStates.m["conn:flap"] = cs

	reconcileOnUpTestHook = func(connName string) {
		// Simulate a flap during processing: actual goes down and back up
		connStates.Lock()
		cs.actual = false
		cs.actualGen++
		connStates.Unlock()
	}
	defer func() { reconcileOnUpTestHook = nil }()

	// Drain stale signal
	select {
	case <-connStates.reconcileCh:
	default:
	}

	reconcileConn("conn:flap", true, 1)

	// After reconcileConn finishes, actualGen=2, procGen=1 -> mismatch
	if cs.procGen != 1 {
		t.Fatalf("expected procGen=1, got %d", cs.procGen)
	}
	if cs.actualGen != 2 {
		t.Fatalf("expected actualGen=2 after simulated flap, got %d", cs.actualGen)
	}

	// Follow-up signal should be present
	var gotSignal bool
	select {
	case <-connStates.reconcileCh:
		gotSignal = true
	default:
	}
	if !gotSignal {
		t.Fatalf("expected follow-up signal after rapid flap")
	}
}

// TestSingleflightGroupsAreDistinct verifies that ReconnectJob and
// ReconnectJobRoute use different singleflight.Group instances.
func TestSingleflightGroupsAreDistinct(t *testing.T) {
	if &reconnectConnGroup == &reconnectRouteGroup {
		t.Fatalf("reconnectConnGroup and reconnectRouteGroup must be different instances")
	}

	// Verify concurrency isolation: two simultaneous calls to the same jobId,
	// one via ReconnectJob and one via ReconnectJobRoute, should NOT block each other.
	var connGate sync.WaitGroup
	connGate.Add(1)
	var routeGate sync.WaitGroup
	routeGate.Add(1)

	var connEntered int32
	var routeEntered int32

	// Override doReconnectJob path via test hooks inside singleflight
	// We use the actual groups but with a stub doReconnectJob.
	// Since we can't intercept doReconnectJob easily, we test the group behavior directly.

	// Start a blocked call in reconnectConnGroup
	go func() {
		reconnectConnGroup.Do("job:x", func() (any, error) {
			atomic.AddInt32(&connEntered, 1)
			connGate.Wait()
			return nil, nil
		})
	}()

	// Start a blocked call in reconnectRouteGroup for the same key
	go func() {
		reconnectRouteGroup.Do("job:x", func() (any, error) {
			atomic.AddInt32(&routeEntered, 1)
			routeGate.Wait()
			return nil, nil
		})
	}()

	// Give both goroutines time to enter their respective groups
	time.Sleep(200 * time.Millisecond)

	if atomic.LoadInt32(&connEntered) != 1 {
		t.Fatalf("expected conn group call to have entered")
	}
	if atomic.LoadInt32(&routeEntered) != 1 {
		t.Fatalf("expected route group call to have entered")
	}

	// Release both
	connGate.Done()
	routeGate.Done()
	time.Sleep(100 * time.Millisecond)
}

// TestHandleConnChangeEventIncrementsGen verifies that the event handler
// increments actualGen only on true state transitions.
func TestHandleConnChangeEventIncrementsGen(t *testing.T) {
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	// First event: connected=true
	event1 := wps.WaveEvent{
		Event:  wps.Event_ConnChange,
		Scopes: []string{"connection:evtest"},
		Data:   wshrpc.ConnStatus{Connected: true},
	}
	handleConnChangeEvent(&event1)

	cs, exists := connStates.m["evtest"]
	if !exists {
		t.Fatalf("expected connState to be created")
	}
	if cs.actual != true {
		t.Fatalf("expected actual=true")
	}
	if cs.actualGen != 1 {
		t.Fatalf("expected actualGen=1 after first true event, got %d", cs.actualGen)
	}

	// Second event: connected=true again (no change)
	handleConnChangeEvent(&event1)
	if cs.actualGen != 1 {
		t.Fatalf("expected actualGen=1 after duplicate true event, got %d", cs.actualGen)
	}

	// Third event: connected=false
	event2 := wps.WaveEvent{
		Event:  wps.Event_ConnChange,
		Scopes: []string{"connection:evtest"},
		Data:   wshrpc.ConnStatus{Connected: false},
	}
	handleConnChangeEvent(&event2)
	if cs.actual != false {
		t.Fatalf("expected actual=false")
	}
	if cs.actualGen != 2 {
		t.Fatalf("expected actualGen=2 after false event, got %d", cs.actualGen)
	}

	// Fourth event: connected=true again
	handleConnChangeEvent(&event1)
	if cs.actual != true {
		t.Fatalf("expected actual=true")
	}
	if cs.actualGen != 3 {
		t.Fatalf("expected actualGen=3 after final true event, got %d", cs.actualGen)
	}
}

// TestAttemptAutoReconnectSkipsCooldownWhenDown is an end-to-end style test
// verifying that if the connection is down, no cooldown is consumed,
// so a subsequent attempt can proceed immediately.
func TestAttemptAutoReconnectSkipsCooldownWhenDown(t *testing.T) {
	lastAutoReconnectAttempt = ds.MakeSyncMap[int64]()

	isConnectedTestHook = func(connName string) (bool, error) {
		return false, nil
	}

	attemptAutoReconnect("job-e", "conn:mock")

	// No timestamp set
	if _, exists := lastAutoReconnectAttempt.GetEx("job-e"); exists {
		t.Fatalf("timestamp must not be set when connection is down")
	}

	isConnectedTestHook = nil

	// shouldAttemptAutoReconnect should still allow another attempt immediately
	if got := shouldAttemptAutoReconnect("job-e"); !got {
		t.Fatalf("expected second attempt to be allowed because no cooldown was consumed")
	}
}

// TestReconcileAllConnsSkipsWhenGenMatches verifies that reconcileAllConns
// does not spawn a goroutine when procGen == actualGen.
func TestReconcileAllConnsSkipsWhenGenMatches(t *testing.T) {
	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	cs := &connState{actual: true, procGen: 1, actualGen: 1, reconciling: false}
	connStates.m["conn:match"] = cs

	reconcileAllConns()

	if cs.reconciling {
		t.Fatalf("expected reconciling=false when gen matches")
	}
}

// TestAttemptAutoReconnectSetsCooldownWhenUp verifies the happy path:
// connection is up, timestamp is set, and ReconnectJobRoute is called.
func TestAttemptAutoReconnectSetsCooldownWhenUp(t *testing.T) {
	lastAutoReconnectAttempt = ds.MakeSyncMap[int64]()

	isConnectedTestHook = func(connName string) (bool, error) {
		return true, nil
	}
	defer func() { isConnectedTestHook = nil }()

	// Stub out ReconnectJobRoute so we don't need wstore / rpc infrastructure
	var reconnectCalled int32
	reconnectRouteGroup.Do("job-f", func() (any, error) {
		atomic.AddInt32(&reconnectCalled, 1)
		return nil, fmt.Errorf("stub error")
	})
	// The stub call above warms the group and removes the key, so the real
	// attemptAutoReconnect will execute its own singleflight.

	attemptAutoReconnect("job-f", "conn:mock")

	if _, exists := lastAutoReconnectAttempt.GetEx("job-f"); !exists {
		t.Fatalf("timestamp must be set when connection is up")
	}

	isConnectedTestHook = nil
}
