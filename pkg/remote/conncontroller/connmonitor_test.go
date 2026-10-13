// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import "testing"

func TestHealthThresholds(t *testing.T) {
	tests := []struct {
		name         string
		rttMs        int64
		urgent       bool
		wantDegraded int64
		wantStalled  int64
	}{
		{"no sample yet, idle", 0, false, 2000, 15000},
		{"no sample yet, typing", 0, true, 2000, 8000},
		{"lan", 5, true, 2000, 8000},
		{"floor boundary", 500, false, 2000, 15000},
		{"cross-pacific typing", 700, true, 2800, 8000},
		{"very slow link", 2000, true, 8000, 20000},
		{"very slow link idle", 2000, false, 8000, 20000},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotDegraded, gotStalled := healthThresholds(tc.rttMs, tc.urgent)
			if gotDegraded != tc.wantDegraded || gotStalled != tc.wantStalled {
				t.Fatalf("healthThresholds(%d, %v) = (%d, %d), want (%d, %d)",
					tc.rttMs, tc.urgent, gotDegraded, gotStalled, tc.wantDegraded, tc.wantStalled)
			}
		})
	}
}

func TestUpdateRttEwma(t *testing.T) {
	if got := updateRttEwma(0, 300); got != 300 {
		t.Fatalf("first sample: got %d, want 300", got)
	}
	if got := updateRttEwma(-1, 300); got != 300 {
		t.Fatalf("negative prev treated as empty: got %d, want 300", got)
	}
	// 75% of 400 + 25% of 800 = 500
	if got := updateRttEwma(400, 800); got != 500 {
		t.Fatalf("got %d, want 500", got)
	}
	// converges toward a steady sample
	v := int64(100)
	for i := 0; i < 50; i++ {
		v = updateRttEwma(v, 600)
	}
	if v < 590 || v > 600 {
		t.Fatalf("did not converge: got %d", v)
	}
}
