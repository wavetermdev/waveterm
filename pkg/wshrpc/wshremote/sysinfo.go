// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"os/exec"
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
	BYTES_PER_GB            = 1073741824
	mibPerGB                = 1024
	nvidiaSmiMaxOutputBytes = 64 * 1024
	nvidiaSmiTimeout        = 750 * time.Millisecond
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

func parseNvidiaSmiFloat(raw string) (float64, bool) {
	val, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(val) || math.IsInf(val, 0) || val < 0 {
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
		idx, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil || idx < 0 {
			continue
		}
		util, ok := parseNvidiaSmiFloat(parts[1])
		if !ok || util > 100 {
			continue
		}
		memUsedMIB, ok := parseNvidiaSmiFloat(parts[2])
		if !ok {
			continue
		}
		memTotalMIB, ok := parseNvidiaSmiFloat(parts[3])
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
		values["gpumem:"+gpuIdx+":used"] = sample.memUsedGB
		values["gpumem:"+gpuIdx+":total"] = sample.memTotalGB
		utilSum += sample.util
		memUsedSum += sample.memUsedGB
		memTotalSum += sample.memTotalGB
	}
	values["gpu"] = utilSum / float64(len(samples))
	values["gpumem:used"] = memUsedSum
	values["gpumem:total"] = memTotalSum
}

func runNvidiaSmiQuery(ctx context.Context) ([]byte, error) {
	cmd := exec.CommandContext(
		ctx,
		"nvidia-smi",
		"--query-gpu=index,utilization.gpu,memory.used,memory.total",
		"--format=csv,noheader,nounits",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	output, readErr := io.ReadAll(io.LimitReader(stdout, nvidiaSmiMaxOutputBytes + 1))
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if len(output) > nvidiaSmiMaxOutputBytes {
		return nil, fmt.Errorf("nvidia-smi output exceeded %d bytes", nvidiaSmiMaxOutputBytes)
	}
	if waitErr != nil {
		return nil, waitErr
	}
	return output, nil
}

func getNvidiaGpuData(values map[string]float64) {
	ctx, cancel := context.WithTimeout(context.Background(), nvidiaSmiTimeout)
	defer cancel()
	output, err := runNvidiaSmiQuery(ctx)
	if err != nil {
		return
	}
	addGpuSamples(values, parseNvidiaSmiOutput(output))
}

func getGpuData(values map[string]float64) {
	getNvidiaGpuData(values)
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
