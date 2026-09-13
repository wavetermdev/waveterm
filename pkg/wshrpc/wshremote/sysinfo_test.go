// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import "testing"

func TestParseNvidiaSmiOutput(t *testing.T) {
	output := []byte("1, 50, 4096, 8192\n0, 25.5, 1024, 4096\n")
	samples := parseNvidiaSmiOutput(output)

	if len(samples) != 2 {
		t.Fatalf("expected 2 samples, got %d", len(samples))
	}
	if samples[0].idx != 0 || samples[0].util != 25.5 || samples[0].memUsedGB != 1 || samples[0].memTotalGB != 4 {
		t.Fatalf("unexpected first sample: %#v", samples[0])
	}
	if samples[1].idx != 1 || samples[1].util != 50 || samples[1].memUsedGB != 4 || samples[1].memTotalGB != 8 {
		t.Fatalf("unexpected second sample: %#v", samples[1])
	}

	values := map[string]float64{}
	addGpuSamples(values, samples)
	if values["gpu"] != 37.75 {
		t.Fatalf("expected aggregate gpu utilization 37.75, got %v", values["gpu"])
	}
	if values["gpumem:used"] != 5 || values["gpumem:total"] != 12 {
		t.Fatalf("unexpected aggregate gpu memory: %#v", values)
	}
}

func TestParseNvidiaSmiOutputSkipsMalformedRows(t *testing.T) {
	output := []byte("bad\n0, 101, 1024, 2048\n1, 33, 4096, 2048\n2, 44, 1024, 2048\n")
	samples := parseNvidiaSmiOutput(output)

	if len(samples) != 1 {
		t.Fatalf("expected 1 valid sample, got %d", len(samples))
	}
	if samples[0].idx != 2 || samples[0].util != 44 || samples[0].memUsedGB != 1 || samples[0].memTotalGB != 2 {
		t.Fatalf("unexpected sample: %#v", samples[0])
	}
}
