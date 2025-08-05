// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"fmt"
	"strings"
	"testing"
)

func TestDetectPlatform(t *testing.T) {
	platform := detectPlatform()
	if platform == "" {
		t.Error("Platform detection returned empty string")
	}
	t.Logf("Detected platform: %s", platform)
}

func TestNvidiaSmiAvailability(t *testing.T) {
	available := isNvidiaSmiAvailable()
	t.Logf("nvidia-smi available: %v", available)
}

func TestRocmSmiAvailability(t *testing.T) {
	available := isRocmSmiAvailable()
	t.Logf("rocm-smi available: %v", available)
}

func TestGetGpuData(t *testing.T) {
	values := make(map[string]float64)
	getGpuData(values)

	// Check if any GPU data was collected
	hasGpuData := false
	for key := range values {
		if key == "gpu" || (len(key) > 4 && key[:4] == "gpu:") {
			hasGpuData = true
			t.Logf("Found GPU data: %s = %f", key, values[key])
		}
	}

	if !hasGpuData {
		t.Log("No GPU data collected (this is normal if no GPU tools are available)")
	}
}

func TestMacOSGpuFunctions(t *testing.T) {
	// Test system_profiler parsing
	output := `Graphics/Displays:
    Intel Iris Pro:
      Chipset Model: Intel Iris Pro
      VRAM (Dynamic, Max): 1536 MB
      Resolution: 2560 x 1600
    NVIDIA GeForce GT 750M:
      Chipset Model: NVIDIA GeForce GT 750M
      VRAM (Total): 2048 MB`

	gpuNames := parseSystemProfilerOutput(output)
	for i, name := range gpuNames {
		gpuNames[i] = fmt.Sprintf("%q", name)
	}

	t.Logf("Parsed GPU names: %s", strings.Join(gpuNames, ", "))

	// Test VRAM parsing
	vram := parseVRAMFromSystemProfiler(output)
	t.Logf("Parsed VRAM: %f GB", vram)

	// Test memory pressure
	memPressure := getMemoryPressureFromVMStat()
	t.Logf("Memory pressure: %f GB", memPressure)

	// Test GPU memory estimation
	estimatedMem := estimateGPUMemory()
	t.Logf("Estimated GPU memory: %f GB", estimatedMem)
}

func TestWindowsGpuFunctions(t *testing.T) {
	// Test Windows GPU output parsing
	output := `[{"Name":"NVIDIA GeForce RTX 3080","AdapterRAM":10737418240,"VideoProcessor":"NVIDIA GeForce RTX 3080","DriverVersion":"31.0.15.3179"}]`

	gpuList := parseWindowsGpuOutput(output)
	t.Logf("Parsed Windows GPUs: %d", len(gpuList))
	for i, gpu := range gpuList {
		t.Logf("GPU %d: %s (%.2f GB)", i, gpu.Name, gpu.MemTotal)
	}

	// Test Windows GPU memory output parsing
	memOutput := `{"NVIDIA GeForce RTX 3080":2.45}`
	memUsage := parseWindowsGpuMemoryOutput(memOutput)
	t.Logf("Memory usage: %v", memUsage)
}
