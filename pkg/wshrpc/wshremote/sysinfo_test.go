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

func TestParseAmdSmiMonitorOutput(t *testing.T) {
	output := []byte(`GPU  XCP  POWER   GPU_T   MEM_T   GFX_CLK   GFX%   MEM%   ENC%   DEC%      VRAM_USAGE
0    0    183 W   49 C    48 C    1427 MHz  12 %   0 %    N/A    0 %       0.3/192.0 GB
1    0    42 W    29 C    30 C    47 MHz    2 %    0 %    N/A    0 %       512.0/8192.0 MB
2    0    42 W    29 C    30 C    47 MHz    3 %    0 %    N/A    0 %       0.5/ 48.0 GB
`)
	samples := parseAmdSmiMonitorOutput(output)

	if len(samples) != 3 {
		t.Fatalf("expected 3 samples, got %d", len(samples))
	}
	if samples[0].idx != 0 || samples[0].util != 12 || samples[0].memUsedGB != 0.3 || samples[0].memTotalGB != 192 {
		t.Fatalf("unexpected first sample: %#v", samples[0])
	}
	if samples[1].idx != 1 || samples[1].util != 2 || samples[1].memUsedGB != 0.5 || samples[1].memTotalGB != 8 {
		t.Fatalf("unexpected second sample: %#v", samples[1])
	}
	if samples[2].idx != 2 || samples[2].util != 3 || samples[2].memUsedGB != 0.5 || samples[2].memTotalGB != 48 {
		t.Fatalf("unexpected third sample: %#v", samples[2])
	}
}

func TestParseRocmSmiJSONOutput(t *testing.T) {
	output := []byte(`{
  "card1": {
    "GPU use (%)": "7",
    "VRAM Total Memory (B)": "2147483648",
    "VRAM Total Used Memory (B)": "1073741824"
  },
  "card0": {
    "GPU use (%)": "50",
    "VRAM Total Memory (B)": "4294967296",
    "VRAM Total Used Memory (B)": "2147483648"
  }
}`)
	samples := parseRocmSmiJSONOutput(output)

	if len(samples) != 2 {
		t.Fatalf("expected 2 samples, got %d", len(samples))
	}
	if samples[0].idx != 0 || samples[0].util != 50 || samples[0].memUsedGB != 2 || samples[0].memTotalGB != 4 {
		t.Fatalf("unexpected first sample: %#v", samples[0])
	}
	if samples[1].idx != 1 || samples[1].util != 7 || samples[1].memUsedGB != 1 || samples[1].memTotalGB != 2 {
		t.Fatalf("unexpected second sample: %#v", samples[1])
	}
}

func TestNormalizeGpuSamples(t *testing.T) {
	samples := normalizeGpuSamples([]gpuSample{
		{idx: 3, util: 10, memUsedGB: 1, memTotalGB: 2},
		{idx: 9, util: 20, memUsedGB: 2, memTotalGB: 4},
	})

	if samples[0].idx != 0 || samples[1].idx != 1 {
		t.Fatalf("expected normalized indices, got %#v", samples)
	}
}
