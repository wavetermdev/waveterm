// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"log"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const BYTES_PER_GB = 1073741824

const PS_GPU_COMMAND = `
	$gpus = Get-WmiObject -Class Win32_VideoController | Where-Object { $_.Name -notlike "*Basic*" -and $_.Name -notlike "*Standard*" }
	$gpuInfo = @()
	foreach ($gpu in $gpus) {
		$gpuInfo += [PSCustomObject]@{
			Name = $gpu.Name
			AdapterRAM = $gpu.AdapterRAM
			VideoProcessor = $gpu.VideoProcessor
			DriverVersion = $gpu.DriverVersion
		}
	}
	$gpuInfo | ConvertTo-Json -Compress
`

// GPU data structure to hold parsed GPU information
type GpuData struct {
	Index    int     `json:"index"`
	Util     float64 `json:"util"`
	MemUsed  float64 `json:"mem_used"`
	MemTotal float64 `json:"mem_total"`
	Temp     float64 `json:"temp"`
}

// Platform detection
func detectPlatform() string {
	switch runtime.GOOS {
	case "linux":
		return "linux"
	case "darwin":
		return "darwin"
	case "windows":
		return "windows"
	default:
		return "unknown"
	}
}

// Check if nvidia-smi is available
func isNvidiaSmiAvailable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "nvidia-smi", "--version")
	return cmd.Run() == nil
}

// Check if rocm-smi is available (AMD GPUs)
func isRocmSmiAvailable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "rocm-smi", "--version")
	return cmd.Run() == nil
}

// Get GPU data using nvidia-smi
func getNvidiaGpuData() ([]GpuData, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var gpus []GpuData
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	for _, line := range lines {
		fields := strings.Split(line, ", ")
		if len(fields) >= 5 {
			index, err := strconv.Atoi(strings.TrimSpace(fields[0]))
			if err != nil {
				log.Printf("Error parsing nvidia-smi output: %v", err)
				continue
			}
			util, err := strconv.ParseFloat(strings.TrimSpace(fields[1]), 64)
			if err != nil {
				log.Printf("Error parsing nvidia-smi output: %v", err)
				continue
			}
			memUsed, _ := strconv.ParseFloat(strings.TrimSpace(fields[2]), 64)
			memTotal, _ := strconv.ParseFloat(strings.TrimSpace(fields[3]), 64)
			temp, _ := strconv.ParseFloat(strings.TrimSpace(fields[4]), 64)

			gpus = append(gpus, GpuData{
				Index:    index,
				Util:     util,
				MemUsed:  memUsed,
				MemTotal: memTotal,
				Temp:     temp,
			})
		}
	}

	return gpus, nil
}

// Get GPU data using rocm-smi (AMD)
func getRocmGpuData() ([]GpuData, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "rocm-smi", "--showproductname", "--showmeminfo", "vram", "--showtemp")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var gpus []GpuData
	// Parse rocm-smi output - this is more complex as it's not CSV format
	// For now, we'll implement a basic parser

	// Simple regex to extract GPU info
	re := regexp.MustCompile(`GPU\s+(\d+).*?VRAM Total:\s+(\d+)\s+MB.*?VRAM Used:\s+(\d+)\s+MB.*?Temperature:\s+(\d+)`)
	matches := re.FindAllStringSubmatch(string(output), -1)

	for _, match := range matches {
		if len(match) >= 5 {
			index, _ := strconv.Atoi(match[1])
			memTotal, _ := strconv.ParseFloat(match[2], 64)
			memUsed, _ := strconv.ParseFloat(match[3], 64)
			temp, _ := strconv.ParseFloat(match[4], 64)

			// Convert MB to GB
			memTotal = memTotal / 1024
			memUsed = memUsed / 1024

			gpus = append(gpus, GpuData{
				Index:    index,
				Util:     0, // rocm-smi doesn't provide utilization in the same way
				MemUsed:  memUsed,
				MemTotal: memTotal,
				Temp:     temp,
			})
		}
	}

	return gpus, nil
}

// Get GPU data for macOS using multiple commands for better coverage
func getMacGpuData() ([]GpuData, error) {
	var gpus []GpuData

	// Try to get GPU info using system_profiler first
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "system_profiler", "SPDisplaysDataType")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	// Parse system_profiler output to get GPU names and basic info
	gpuNames := parseSystemProfilerOutput(string(output))

	// Try to get GPU utilization using iostat (if available)
	gpuUtil := getMacGpuUtilization()

	// Try to get GPU memory info using vm_stat and other commands
	gpuMem := getMacGpuMemory()

	// Create GPU data entries
	for i, name := range gpuNames {
		gpu := GpuData{
			Index:    i,
			Util:     gpuUtil,
			MemUsed:  gpuMem.Used,
			MemTotal: gpuMem.Total,
			Temp:     0, // Temperature not easily available on macOS
		}
		gpus = append(gpus, gpu)
		// Log GPU name for debugging
		log.Printf("Found macOS GPU: %s", name)
	}

	// If no GPUs found from system_profiler, create a default entry
	if len(gpus) == 0 {
		gpus = append(gpus, GpuData{
			Index:    0,
			Util:     gpuUtil,
			MemUsed:  gpuMem.Used,
			MemTotal: gpuMem.Total,
			Temp:     0,
		})
	}

	return gpus, nil
}

// Parse system_profiler output to extract GPU names
func parseSystemProfilerOutput(output string) []string {
	var gpuNames []string
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "Chipset Model:") {
			// Extract GPU name
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				gpuName := strings.TrimSpace(parts[1])
				if gpuName != "" && gpuName != "Unknown" {
					gpuNames = append(gpuNames, gpuName)
				}
			}
		}
	}

	return gpuNames
}

// Get GPU utilization using iostat (if available)
func getMacGpuUtilization() float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Try to get GPU utilization using iostat
	cmd := exec.CommandContext(ctx, "iostat", "-n", "1", "1")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	// Parse iostat output for GPU utilization
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "gpu") || strings.Contains(line, "GPU") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if util, err := strconv.ParseFloat(fields[1], 64); err == nil {
					return util
				}
			}
		}
	}

	return 0
}

// GPU memory info structure
type GpuMemoryInfo struct {
	Used  float64
	Total float64
}

// Get GPU memory information using multiple methods
func getMacGpuMemory() GpuMemoryInfo {
	var memInfo GpuMemoryInfo

	// Try to get total VRAM using system_profiler
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "system_profiler", "SPDisplaysDataType")
	output, err := cmd.Output()
	if err == nil {
		memInfo.Total = parseVRAMFromSystemProfiler(string(output))
	}

	// Try to get memory pressure info using vm_stat
	vmStat := getMemoryPressureFromVMStat()
	if vmStat > 0 {
		memInfo.Used = vmStat
	}

	// If we couldn't get total VRAM, estimate based on system memory
	if memInfo.Total == 0 {
		memInfo.Total = estimateGPUMemory()
	}

	return memInfo
}

// Parse VRAM information from system_profiler output
func parseVRAMFromSystemProfiler(output string) float64 {
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "VRAM") || strings.Contains(line, "Memory") {
			// Look for memory size patterns like "8 GB", "4 GB", etc.
			re := regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(GB|MB)`)
			matches := re.FindStringSubmatch(line)
			if len(matches) >= 3 {
				if size, err := strconv.ParseFloat(matches[1], 64); err == nil {
					unit := matches[2]
					if unit == "MB" {
						return size / 1024 // Convert MB to GB
					}
					return size
				}
			}
		}
	}

	return 0
}

// Get memory pressure from vm_stat command
func getMemoryPressureFromVMStat() float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "vm_stat")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	lines := strings.Split(string(output), "\n")
	var pageSize int64 = 4096 // Default page size

	// Find page size
	for _, line := range lines {
		if strings.Contains(line, "Mach Virtual Memory Statistics") {
			re := regexp.MustCompile(`page size of (\d+)`)
			matches := re.FindStringSubmatch(line)
			if len(matches) >= 2 {
				if size, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
					pageSize = size
				}
			}
			break
		}
	}

	// Parse memory statistics
	var activePages, inactivePages, wiredPages int64

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "Pages active:") {
			re := regexp.MustCompile(`Pages active:\s+(\d+)`)
			matches := re.FindStringSubmatch(line)
			if len(matches) >= 2 {
				if pages, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
					activePages = pages
				}
			}
		} else if strings.Contains(line, "Pages inactive:") {
			re := regexp.MustCompile(`Pages inactive:\s+(\d+)`)
			matches := re.FindStringSubmatch(line)
			if len(matches) >= 2 {
				if pages, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
					inactivePages = pages
				}
			}
		} else if strings.Contains(line, "Pages wired down:") {
			re := regexp.MustCompile(`Pages wired down:\s+(\d+)`)
			matches := re.FindStringSubmatch(line)
			if len(matches) >= 2 {
				if pages, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
					wiredPages = pages
				}
			}
		}
	}

	// Calculate used memory in GB
	usedBytes := (activePages + inactivePages + wiredPages) * pageSize
	return float64(usedBytes) / (1024 * 1024 * 1024) // Convert to GB
}

// Estimate GPU memory based on system memory
func estimateGPUMemory() float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sysctl", "hw.memsize")
	output, err := cmd.Output()
	if err != nil {
		return 4.0 // Default estimate
	}

	// Parse total system memory
	re := regexp.MustCompile(`hw\.memsize:\s+(\d+)`)
	matches := re.FindStringSubmatch(string(output))
	if len(matches) >= 2 {
		if memSize, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
			totalGB := float64(memSize) / (1024 * 1024 * 1024)
			// Estimate GPU memory as a fraction of system memory
			// This is a rough estimate and varies by GPU
			// Actual GPU memory varies significantly and this should be treated as unreliable
			return totalGB * 0.1 // Assume 10% of system memory for GPU
		}
	}

	return 4.0 // Default estimate
}

// Get GPU data for Windows using PowerShell commands
func getWindowsGpuData() ([]GpuData, error) {
	var gpus []GpuData

	// Try to get GPU info using PowerShell
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// PowerShell command to get GPU information

	cmd := exec.CommandContext(ctx, "powershell", "-Command", PS_GPU_COMMAND)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	// Parse the JSON output
	gpuList := parseWindowsGpuOutput(string(output))

	// Get GPU utilization using a separate PowerShell command
	gpuUtil := getWindowsGpuUtilization()

	// Get GPU memory usage
	memUsage := getWindowsGpuMemoryUsage()

	// Create GPU data entries
	for i, gpu := range gpuList {
		// Try to find memory usage for this GPU
		memUsed := 0.0
		for adapterName, usage := range memUsage {
			if strings.Contains(strings.ToLower(adapterName), strings.ToLower(gpu.Name)) {
				memUsed = usage
				break
			}
		}

		gpuData := GpuData{
			Index:    i,
			Util:     gpuUtil,
			MemUsed:  memUsed,
			MemTotal: gpu.MemTotal,
			Temp:     0, // Temperature requires additional tools on Windows
		}
		gpus = append(gpus, gpuData)
	}

	// If no GPUs found, create a default entry
	if len(gpus) == 0 {
		gpus = append(gpus, GpuData{
			Index:    0,
			Util:     gpuUtil,
			MemUsed:  0,
			MemTotal: 0,
			Temp:     0,
		})
	}

	return gpus, nil
}

// Windows GPU info structure
type WindowsGpuInfo struct {
	Name     string  `json:"Name"`
	MemTotal float64 `json:"MemTotal"`
	MemUsed  float64 `json:"MemUsed"`
}

// Parse Windows GPU output from PowerShell
func parseWindowsGpuOutput(output string) []WindowsGpuInfo {
	var gpuList []WindowsGpuInfo

	// Try to parse as JSON array
	if strings.TrimSpace(output) == "" {
		return gpuList
	}

	// Simple JSON parsing for the PowerShell output
	// The output should be a JSON array of GPU objects
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Extract GPU name and memory info using regex
		nameRe := regexp.MustCompile(`"Name":\s*"([^"]+)"`)
		adapterRamRe := regexp.MustCompile(`"AdapterRAM":\s*(\d+)`)

		nameMatches := nameRe.FindStringSubmatch(line)
		ramMatches := adapterRamRe.FindStringSubmatch(line)

		if len(nameMatches) >= 2 && len(ramMatches) >= 2 {
			name := nameMatches[1]
			if ramSize, err := strconv.ParseInt(ramMatches[1], 10, 64); err == nil {
				// Convert bytes to GB
				memTotal := float64(ramSize) / (1024 * 1024 * 1024)

				gpuInfo := WindowsGpuInfo{
					Name:     name,
					MemTotal: memTotal,
					MemUsed:  0, // Will be estimated based on utilization
				}
				gpuList = append(gpuList, gpuInfo)
			}
		}
	}

	return gpuList
}

// Get GPU utilization on Windows using PowerShell
func getWindowsGpuUtilization() float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// PowerShell command to get GPU utilization
	psCommand := `
		try {
			$gpu = Get-Counter "\GPU Engine(*)\Utilization Percentage" -ErrorAction SilentlyContinue
			if ($gpu) {
				$maxUtil = ($gpu.CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum
				[math]::Round($maxUtil, 2)
			} else {
				0
			}
		} catch {
			0
		}
	`

	cmd := exec.CommandContext(ctx, "powershell", "-Command", psCommand)
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	// Parse the utilization value
	utilStr := strings.TrimSpace(string(output))
	if util, err := strconv.ParseFloat(utilStr, 64); err == nil {
		return util
	}

	return 0
}

// Get GPU memory usage on Windows using PowerShell
func getWindowsGpuMemoryUsage() map[string]float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// PowerShell command to get GPU memory usage
	psCommand := `
		try {
			$gpu = Get-Counter "\GPU Adapter Memory(*)\Dedicated Usage" -ErrorAction SilentlyContinue
			$memUsage = @{}
			foreach ($counter in $gpu.CounterSamples) {
				$adapterName = $counter.InstanceName
				$usage = $counter.CookedValue / 1GB
				$memUsage[$adapterName] = [math]::Round($usage, 2)
			}
			$memUsage | ConvertTo-Json -Compress
		} catch {
			"{}"
		}
	`

	cmd := exec.CommandContext(ctx, "powershell", "-Command", psCommand)
	output, err := cmd.Output()
	if err != nil {
		return make(map[string]float64)
	}

	// Parse the memory usage JSON
	return parseWindowsGpuMemoryOutput(string(output))
}

// Parse Windows GPU memory output
func parseWindowsGpuMemoryOutput(output string) map[string]float64 {
	memUsage := make(map[string]float64)

	// Simple JSON parsing for memory usage
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Extract adapter name and memory usage
		re := regexp.MustCompile(`"([^"]+)":\s*([\d.]+)`)
		matches := re.FindStringSubmatch(line)
		if len(matches) >= 3 {
			adapterName := matches[1]
			if usage, err := strconv.ParseFloat(matches[2], 64); err == nil {
				memUsage[adapterName] = usage
			}
		}
	}

	return memUsage
}

func getGpuData(values map[string]float64) {
	platform := detectPlatform()
	var gpus []GpuData
	var err error

	switch platform {
	case "linux":
		if isNvidiaSmiAvailable() {
			gpus, err = getNvidiaGpuData()
		} else if isRocmSmiAvailable() {
			gpus, err = getRocmGpuData()
		}
	case "darwin":
		gpus, err = getMacGpuData()
	case "windows":
		gpus, err = getWindowsGpuData()
	}

	if err != nil || len(gpus) == 0 {
		if err != nil {
			log.Printf("Error getting GPU data: %v", err)
		}
		return
	}

	// Add GPU data to values map
	for _, gpu := range gpus {
		indexStr := strconv.Itoa(gpu.Index)
		values[wshrpc.TimeSeries_Gpu+":"+indexStr+":util"] = gpu.Util
		values[wshrpc.TimeSeries_Gpu+":"+indexStr+":mem_used"] = gpu.MemUsed
		values[wshrpc.TimeSeries_Gpu+":"+indexStr+":mem_total"] = gpu.MemTotal
		values[wshrpc.TimeSeries_Gpu+":"+indexStr+":temp"] = gpu.Temp
	}

	// Add aggregate GPU utilization (average of all GPUs)
	if len(gpus) > 0 {
		totalUtil := 0.0
		for _, gpu := range gpus {
			totalUtil += gpu.Util
		}
		values[wshrpc.TimeSeries_Gpu] = totalUtil / float64(len(gpus))
	}
}

func getCpuData(values map[string]float64) {
	percentArr, err := cpu.Percent(0, false)
	if err != nil {
		return
	}
	if len(percentArr) > 0 {
		values[wshrpc.TimeSeries_Cpu] = percentArr[0]
	}
	percentArr, err = cpu.Percent(0, true)
	if err != nil {
		return
	}
	for idx, percent := range percentArr {
		values[wshrpc.TimeSeries_Cpu+":"+strconv.Itoa(idx)] = percent
	}
}

func getMemData(values map[string]float64) {
	memData, err := mem.VirtualMemory()
	if err != nil {
		return
	}
	values["mem:total"] = float64(memData.Total) / BYTES_PER_GB
	values["mem:available"] = float64(memData.Available) / BYTES_PER_GB
	values["mem:used"] = float64(memData.Used) / BYTES_PER_GB
	values["mem:free"] = float64(memData.Free) / BYTES_PER_GB
}

func generateSingleServerData(client *wshutil.WshRpc, connName string) {
	now := time.Now()
	values := make(map[string]float64)
	getCpuData(values)
	getMemData(values)
	getGpuData(values)
	tsData := wshrpc.TimeSeriesData{Ts: now.UnixMilli(), Values: values}
	event := wps.WaveEvent{
		Event:   wps.Event_SysInfo,
		Scopes:  []string{connName},
		Data:    tsData,
		Persist: 1024,
	}
	wshclient.EventPublishCommand(client, event, &wshrpc.RpcOpts{NoResponse: true})
}

func RunSysInfoLoop(client *wshutil.WshRpc, connName string) {
	defer func() {
		log.Printf("sysinfo loop ended conn:%s\n", connName)
	}()
	for {
		generateSingleServerData(client, connName)
		time.Sleep(1 * time.Second)
	}
}
