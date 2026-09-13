// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os/exec"
	"runtime"
	"sort"
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

const (
	BYTES_PER_GB           = 1073741824
	mibPerGB               = 1024
	gpuQueryMaxOutputBytes = 64 * 1024
	gpuQueryTimeout        = 750 * time.Millisecond
)

type gpuSample struct {
	idx        int
	util       float64
	memUsedGB  float64
	memTotalGB float64
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

func parseGpuFloat(raw string) (float64, bool) {
	raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), "%"))
	val, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(val) || math.IsInf(val, 0) || val < 0 {
		return 0, false
	}
	return val, true
}

func parseGpuInt(raw string) (int, bool) {
	val, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || val < 0 {
		return 0, false
	}
	return val, true
}

func parseNvidiaSmiOutput(output []byte) []gpuSample {
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var samples []gpuSample
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) != 4 {
			continue
		}
		idx, ok := parseGpuInt(parts[0])
		if !ok {
			continue
		}
		util, ok := parseGpuFloat(parts[1])
		if !ok || util > 100 {
			continue
		}
		memUsedMIB, ok := parseGpuFloat(parts[2])
		if !ok {
			continue
		}
		memTotalMIB, ok := parseGpuFloat(parts[3])
		if !ok || memTotalMIB <= 0 || memUsedMIB > memTotalMIB {
			continue
		}
		samples = append(samples, gpuSample{
			idx:        idx,
			util:       util,
			memUsedGB:  memUsedMIB / mibPerGB,
			memTotalGB: memTotalMIB / mibPerGB,
		})
	}
	sort.Slice(samples, func(i int, j int) bool {
		return samples[i].idx < samples[j].idx
	})
	return samples
}

func parseAmdSmiMemoryUsage(raw string, unit string) (float64, float64, bool) {
	parts := strings.Split(raw, "/")
	if len(parts) != 2 {
		return 0, 0, false
	}
	used, ok := parseGpuFloat(parts[0])
	if !ok {
		return 0, 0, false
	}
	total, ok := parseGpuFloat(parts[1])
	if !ok || total <= 0 || used > total {
		return 0, 0, false
	}
	switch strings.ToLower(strings.TrimSpace(unit)) {
	case "gb", "gib":
		return used, total, true
	case "mb", "mib":
		return used / mibPerGB, total / mibPerGB, true
	case "b", "bytes":
		return used / BYTES_PER_GB, total / BYTES_PER_GB, true
	default:
		return 0, 0, false
	}
}

func parseAmdSmiMemoryFields(fields []string) (float64, float64, bool) {
	for fieldIdx, field := range fields {
		if !strings.Contains(field, "/") {
			continue
		}
		if fieldIdx+1 >= len(fields) {
			continue
		}
		if strings.HasSuffix(field, "/") {
			if fieldIdx+2 >= len(fields) {
				continue
			}
			used, total, ok := parseAmdSmiMemoryUsage(field+fields[fieldIdx+1], fields[fieldIdx+2])
			if ok {
				return used, total, true
			}
			continue
		}
		used, total, ok := parseAmdSmiMemoryUsage(field, fields[fieldIdx+1])
		if ok {
			return used, total, true
		}
	}
	return 0, 0, false
}

func parseAmdSmiUtil(fields []string) (float64, bool) {
	for idx := 1; idx < len(fields)-1; idx++ {
		if fields[idx+1] != "%" {
			continue
		}
		util, ok := parseGpuFloat(fields[idx])
		if ok && util <= 100 {
			return util, true
		}
	}
	return 0, false
}

func parseAmdSmiMonitorOutput(output []byte) []gpuSample {
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var samples []gpuSample
	for _, line := range lines {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 4 {
			continue
		}
		idx, ok := parseGpuInt(fields[0])
		if !ok {
			continue
		}
		util, ok := parseAmdSmiUtil(fields)
		if !ok {
			continue
		}
		memUsedGB, memTotalGB, ok := parseAmdSmiMemoryFields(fields)
		if !ok {
			continue
		}
		samples = append(samples, gpuSample{
			idx:        idx,
			util:       util,
			memUsedGB:  memUsedGB,
			memTotalGB: memTotalGB,
		})
	}
	sort.Slice(samples, func(i int, j int) bool {
		return samples[i].idx < samples[j].idx
	})
	return samples
}

func parseRocmSmiMemoryGB(card map[string]string, keys ...string) (float64, bool) {
	for _, key := range keys {
		raw, ok := card[key]
		if !ok {
			continue
		}
		bytes, ok := parseGpuFloat(raw)
		if ok {
			return bytes / BYTES_PER_GB, true
		}
	}
	return 0, false
}

func rocmSmiCardIndex(key string, fallback int) int {
	if strings.HasPrefix(key, "card") {
		idx, ok := parseGpuInt(strings.TrimPrefix(key, "card"))
		if ok {
			return idx
		}
	}
	return fallback
}

func parseRocmSmiJSONOutput(output []byte) []gpuSample {
	cardData := make(map[string]map[string]string)
	if err := json.Unmarshal(output, &cardData); err != nil {
		return nil
	}
	cardKeys := make([]string, 0, len(cardData))
	for key := range cardData {
		cardKeys = append(cardKeys, key)
	}
	sort.Strings(cardKeys)
	var samples []gpuSample
	for fallbackIdx, key := range cardKeys {
		card := cardData[key]
		util, ok := parseGpuFloat(card["GPU use (%)"])
		if !ok || util > 100 {
			continue
		}
		memUsedGB, ok := parseRocmSmiMemoryGB(card,
			"VRAM Total Used Memory (B)",
			"VIS_VRAM Total Used Memory (B)",
			"GTT Total Used Memory (B)",
		)
		if !ok {
			continue
		}
		memTotalGB, ok := parseRocmSmiMemoryGB(card,
			"VRAM Total Memory (B)",
			"VIS_VRAM Total Memory (B)",
			"GTT Total Memory (B)",
		)
		if !ok || memTotalGB <= 0 || memUsedGB > memTotalGB {
			continue
		}
		samples = append(samples, gpuSample{
			idx:        rocmSmiCardIndex(key, fallbackIdx),
			util:       util,
			memUsedGB:  memUsedGB,
			memTotalGB: memTotalGB,
		})
	}
	sort.Slice(samples, func(i int, j int) bool {
		return samples[i].idx < samples[j].idx
	})
	return samples
}

func parseGpuJSONFloat(raw any) (float64, bool) {
	switch v := raw.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return 0, false
		}
		return v, true
	case string:
		return parseGpuFloat(strings.Trim(v, `"`))
	case json.Number:
		val, err := v.Float64()
		if err != nil || math.IsNaN(val) || math.IsInf(val, 0) || val < 0 {
			return 0, false
		}
		return val, true
	default:
		return 0, false
	}
}

func parseMacosIORegNumber(line string, key string) (float64, bool) {
	keyIdx := strings.Index(line, `"`+key+`"`)
	if keyIdx == -1 {
		return 0, false
	}
	tail := line[keyIdx+len(key)+2:]
	eqIdx := strings.Index(tail, "=")
	if eqIdx == -1 {
		return 0, false
	}
	tail = strings.TrimSpace(tail[eqIdx+1:])
	if tail == "" {
		return 0, false
	}
	if tail[0] == '"' {
		tail = tail[1:]
		endIdx := strings.Index(tail, `"`)
		if endIdx != -1 {
			tail = tail[:endIdx]
		}
	} else {
		endIdx := strings.IndexAny(tail, ",} \t\r\n")
		if endIdx != -1 {
			tail = tail[:endIdx]
		}
	}
	return parseGpuFloat(tail)
}

func firstMacosIORegNumber(line string, keys ...string) (float64, bool) {
	for _, key := range keys {
		val, ok := parseMacosIORegNumber(line, key)
		if ok {
			return val, true
		}
	}
	return 0, false
}

func parseMacosIORegUtil(line string) (float64, bool) {
	util, ok := firstMacosIORegNumber(line,
		"Device Utilization %",
		"GPU Device Utilization %",
		"GPU HW active residency",
	)
	if ok {
		return util, util <= 100
	}
	var utilSum float64
	for _, key := range []string{"Renderer Utilization %", "Tiler Utilization %", "GPU Core Utilization %"} {
		util, ok := parseMacosIORegNumber(line, key)
		if !ok || util > 100 {
			continue
		}
		utilSum += util
	}
	if utilSum == 0 {
		return 0, false
	}
	return min(utilSum, 100), true
}

func parseMacosIORegMemoryGB(line string) (float64, float64, bool) {
	usedBytes, ok := firstMacosIORegNumber(line,
		"vramUsedBytes",
		"VRAM Used Bytes",
		"VRAM Total Used Memory (B)",
	)
	if !ok {
		return 0, 0, false
	}
	totalBytes, totalOk := firstMacosIORegNumber(line,
		"vramTotalBytes",
		"VRAM Total Bytes",
		"VRAM Total Memory (B)",
	)
	if !totalOk {
		freeBytes, freeOk := firstMacosIORegNumber(line,
			"vramFreeBytes",
			"VRAM Free Bytes",
		)
		if freeOk {
			totalBytes = usedBytes + freeBytes
			totalOk = true
		}
	}
	if !totalOk || totalBytes <= 0 || usedBytes > totalBytes {
		return 0, 0, false
	}
	return usedBytes / BYTES_PER_GB, totalBytes / BYTES_PER_GB, true
}

func parseMacosIORegGpuOutput(output []byte) []gpuSample {
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var samples []gpuSample
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "PerformanceStatistics") {
			continue
		}
		util, ok := parseMacosIORegUtil(line)
		if !ok {
			continue
		}
		sample := gpuSample{
			idx:  len(samples),
			util: util,
		}
		memUsedGB, memTotalGB, ok := parseMacosIORegMemoryGB(line)
		if ok {
			sample.memUsedGB = memUsedGB
			sample.memTotalGB = memTotalGB
		}
		samples = append(samples, sample)
	}
	return samples
}

type intelGpuTopEngineStat struct {
	Busy any    `json:"busy"`
	Unit string `json:"unit"`
}

type intelGpuTopSample struct {
	Engines map[string]intelGpuTopEngineStat `json:"engines"`
}

func parseIntelGpuTopSampleUtil(sample intelGpuTopSample) (float64, bool) {
	if len(sample.Engines) == 0 {
		return 0, false
	}
	var utilSum float64
	var found bool
	for _, engine := range sample.Engines {
		if engine.Unit != "" && engine.Unit != "%" {
			continue
		}
		util, ok := parseGpuJSONFloat(engine.Busy)
		if !ok || util > 100 {
			continue
		}
		utilSum += util
		found = true
	}
	if !found {
		return 0, false
	}
	return min(utilSum, 100), true
}

func parseIntelGpuTopJSONOutput(output []byte) []gpuSample {
	jsonText := strings.TrimSpace(string(output))
	if jsonText == "" {
		return nil
	}
	if strings.HasPrefix(jsonText, "[") && !strings.HasSuffix(jsonText, "]") {
		jsonText = strings.TrimRight(jsonText, " \t\r\n,") + "]"
	}
	var samples []intelGpuTopSample
	if strings.HasPrefix(jsonText, "{") {
		var sample intelGpuTopSample
		if err := json.Unmarshal([]byte(jsonText), &sample); err != nil {
			return nil
		}
		samples = append(samples, sample)
	} else if err := json.Unmarshal([]byte(jsonText), &samples); err != nil {
		return nil
	}
	for idx := len(samples) - 1; idx >= 0; idx-- {
		util, ok := parseIntelGpuTopSampleUtil(samples[idx])
		if ok {
			return []gpuSample{{idx: 0, util: util}}
		}
	}
	return nil
}

func normalizeGpuSamples(samples []gpuSample) []gpuSample {
	rtn := make([]gpuSample, 0, len(samples))
	for idx, sample := range samples {
		sample.idx = idx
		rtn = append(rtn, sample)
	}
	return rtn
}

func addGpuSamples(values map[string]float64, samples []gpuSample) {
	if len(samples) == 0 {
		return
	}
	var utilSum float64
	var memUsedSum float64
	var memTotalSum float64
	for _, sample := range samples {
		gpuIdx := strconv.Itoa(sample.idx)
		values["gpu:"+gpuIdx] = sample.util
		if sample.memTotalGB > 0 {
			values["gpumem:"+gpuIdx+":used"] = sample.memUsedGB
			values["gpumem:"+gpuIdx+":total"] = sample.memTotalGB
		}
		utilSum += sample.util
		if sample.memTotalGB > 0 {
			memUsedSum += sample.memUsedGB
			memTotalSum += sample.memTotalGB
		}
	}
	values["gpu"] = utilSum / float64(len(samples))
	if memTotalSum > 0 {
		values["gpumem:used"] = memUsedSum
		values["gpumem:total"] = memTotalSum
	}
}

func runGpuQuery(ctx context.Context, name string, args ...string) ([]byte, error) {
	return runGpuQueryInternal(ctx, false, name, args...)
}

func runGpuQueryAllowTimeout(ctx context.Context, name string, args ...string) ([]byte, error) {
	return runGpuQueryInternal(ctx, true, name, args...)
}

func runGpuQueryInternal(ctx context.Context, allowTimeoutOutput bool, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	output, readErr := io.ReadAll(io.LimitReader(stdout, gpuQueryMaxOutputBytes+1))
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if len(output) > gpuQueryMaxOutputBytes {
		return nil, fmt.Errorf("%s output exceeded %d bytes", name, gpuQueryMaxOutputBytes)
	}
	if waitErr != nil {
		if allowTimeoutOutput && ctx.Err() != nil && len(output) > 0 {
			return output, nil
		}
		return nil, waitErr
	}
	return output, nil
}

func runNvidiaSmiQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(
		ctx,
		"nvidia-smi",
		"--query-gpu=index,utilization.gpu,memory.used,memory.total",
		"--format=csv,noheader,nounits",
	)
}

func runAmdSmiQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(ctx, "amd-smi", "monitor", "--gfx", "--vram-usage")
}

func runRocmSmiQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(ctx, "rocm-smi", "--showuse", "--showmeminfo", "vram", "--json")
}

func runMacosIORegGpuQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(ctx, "ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator")
}

func runMacosAGXGpuQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(ctx, "ioreg", "-r", "-d", "1", "-w", "0", "-c", "AGXAccelerator")
}

func runMacosIntelGpuQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(ctx, "ioreg", "-r", "-d", "1", "-w", "0", "-c", "IntelAccelerator")
}

func runIntelGpuTopQuery(ctx context.Context) ([]byte, error) {
	return runGpuQuery(ctx, "intel_gpu_top", "-J", "-s", "250", "-n", "2", "-o", "-")
}

func runIntelGpuTopFallbackQuery(ctx context.Context) ([]byte, error) {
	return runGpuQueryAllowTimeout(ctx, "intel_gpu_top", "-J", "-s", "250", "-o", "-")
}

func getNvidiaGpuSamples() []gpuSample {
	ctx, cancel := context.WithTimeout(context.Background(), gpuQueryTimeout)
	defer cancel()
	output, err := runNvidiaSmiQuery(ctx)
	if err != nil {
		return nil
	}
	return parseNvidiaSmiOutput(output)
}

func getAmdSmiGpuSamples() []gpuSample {
	ctx, cancel := context.WithTimeout(context.Background(), gpuQueryTimeout)
	defer cancel()
	output, err := runAmdSmiQuery(ctx)
	if err != nil {
		return nil
	}
	return parseAmdSmiMonitorOutput(output)
}

func getRocmSmiGpuSamples() []gpuSample {
	ctx, cancel := context.WithTimeout(context.Background(), gpuQueryTimeout)
	defer cancel()
	output, err := runRocmSmiQuery(ctx)
	if err != nil {
		return nil
	}
	return parseRocmSmiJSONOutput(output)
}

func getAmdGpuSamples() []gpuSample {
	samples := getAmdSmiGpuSamples()
	if len(samples) > 0 {
		return samples
	}
	return getRocmSmiGpuSamples()
}

func getMacosGpuSamples() []gpuSample {
	if runtime.GOOS != "darwin" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), gpuQueryTimeout)
	output, err := runMacosIORegGpuQuery(ctx)
	cancel()
	if err == nil {
		samples := parseMacosIORegGpuOutput(output)
		if len(samples) > 0 {
			return samples
		}
	}
	for _, queryFn := range []func(context.Context) ([]byte, error){runMacosAGXGpuQuery, runMacosIntelGpuQuery} {
		ctx, cancel = context.WithTimeout(context.Background(), gpuQueryTimeout)
		output, err = queryFn(ctx)
		cancel()
		if err != nil {
			continue
		}
		samples := parseMacosIORegGpuOutput(output)
		if len(samples) > 0 {
			return samples
		}
	}
	return nil
}

func getIntelGpuSamples() []gpuSample {
	if runtime.GOOS != "linux" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), gpuQueryTimeout)
	output, err := runIntelGpuTopQuery(ctx)
	cancel()
	if err != nil {
		ctx, cancel = context.WithTimeout(context.Background(), gpuQueryTimeout)
		output, err = runIntelGpuTopFallbackQuery(ctx)
		cancel()
		if err != nil {
			return nil
		}
	}
	return parseIntelGpuTopJSONOutput(output)
}

func getGpuData(values map[string]float64) {
	var samples []gpuSample
	samples = append(samples, getNvidiaGpuSamples()...)
	samples = append(samples, getAmdGpuSamples()...)
	samples = append(samples, getMacosGpuSamples()...)
	samples = append(samples, getIntelGpuSamples()...)
	addGpuSamples(values, normalizeGpuSamples(samples))
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
