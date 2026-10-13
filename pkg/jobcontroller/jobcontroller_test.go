// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"testing"
	"time"
)

func TestNextAutoReconnectDelayDefersInsideCooldown(t *testing.T) {
	jobId := "test-job-cooldown"
	defer lastAutoReconnectAttempt.Delete(jobId)

	delay, ok := nextAutoReconnectDelay(jobId)
	if !ok || delay != AutoReconnectDelay {
		t.Fatalf("Expected immediate attempt, got delay=%v ok=%v", delay, ok)
	}

	// a second route down inside the cooldown must be deferred, not dropped
	delay, ok = nextAutoReconnectDelay(jobId)
	if !ok {
		t.Fatal("Expected a deferred attempt inside the cooldown")
	}
	if delay <= AutoReconnectDelay || delay > AutoReconnectCooldown+AutoReconnectDelay {
		t.Errorf("Expected delay until the end of the cooldown, got %v", delay)
	}

	// further route downs while the deferred attempt is pending schedule nothing
	if _, ok = nextAutoReconnectDelay(jobId); ok {
		t.Error("Expected no new attempt while a deferred attempt is pending")
	}
}

func TestNextAutoReconnectDelayAfterCooldown(t *testing.T) {
	jobId := "test-job-expired"
	defer lastAutoReconnectAttempt.Delete(jobId)

	lastAutoReconnectAttempt.Set(jobId, time.Now().Add(-AutoReconnectCooldown).Unix())
	delay, ok := nextAutoReconnectDelay(jobId)
	if !ok || delay != AutoReconnectDelay {
		t.Errorf("Expected immediate attempt after cooldown, got delay=%v ok=%v", delay, ok)
	}
}
