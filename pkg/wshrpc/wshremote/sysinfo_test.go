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
	if vram != 1.5 {
		t.Errorf("Expected VRAM to be 1536, got %f", vram)
	}

	// Test memory pressure
	memPressure := getMemoryPressureFromVMStat()
	t.Logf("Memory pressure: %f GB", memPressure)
	if memPressure != 0 {
		t.Errorf("Expected memory pressure to be 0, got %f", memPressure)
	}
}

func TestWindowsGpuFunctions(t *testing.T) {
	// Test Windows GPU output parsing
	output := `[{"Name":"NVIDIA GeForce RTX 3080","AdapterRAM":10737418240,"VideoProcessor":"NVIDIA GeForce RTX 3080","DriverVersion":"31.0.15.3179"}]`

	gpuList := parseWindowsGpuOutput(output)
	t.Logf("Parsed Windows GPUs: %d", len(gpuList))
	for i, gpu := range gpuList {
		t.Logf("GPU %d: %s (%.2f GB)", i, gpu.Name, gpu.MemTotal)
	}
	if len(gpuList) != 1 {
		t.Errorf("Expected 1 GPU, got %d", len(gpuList))
	}
	if gpuList[0].Name != "NVIDIA GeForce RTX 3080" {
		t.Errorf("Expected GPU name to be NVIDIA GeForce RTX 3080, got %s", gpuList[0].Name)
	}
	if gpuList[0].MemTotal != 10 {
		t.Errorf("Expected GPU memory total to be 10, got %f", gpuList[0].MemTotal)
	}
	if gpuList[0].MemUsed != 0 {
		t.Errorf("Expected GPU memory used to be 0, got %f", gpuList[0].MemUsed)
	}

	// Test Windows GPU memory output parsing
	memOutput := `{"NVIDIA GeForce RTX 3080":2.45}`
	memUsage := parseWindowsGpuMemoryOutput(memOutput)
	t.Logf("Memory usage: %v", memUsage)
	if memUsage["NVIDIA GeForce RTX 3080"] != 2.45 {
		t.Errorf("Expected GPU memory usage to be 2.45, got %f", memUsage["NVIDIA GeForce RTX 3080"])
	}
}
