// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgen

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestGenerateWaveEventTypes(t *testing.T) {
	tsTypesMap := make(map[reflect.Type]string)
	waveEventTypeDecl := GenerateWaveEventTypes(tsTypesMap)

	if !strings.Contains(waveEventTypeDecl, `type WaveEventName = "blockclose"`) {
		t.Fatalf("expected WaveEventName declaration, got:\n%s", waveEventTypeDecl)
	}
	if !strings.Contains(waveEventTypeDecl, `{ event: "block:jobstatus"; data?: BlockJobStatusData; }`) {
		t.Fatalf("expected typed block:jobstatus event, got:\n%s", waveEventTypeDecl)
	}
	if !strings.Contains(waveEventTypeDecl, `{ event: "route:up"; data?: null; }`) {
		t.Fatalf("expected null for known no-data event, got:\n%s", waveEventTypeDecl)
	}
	if got := getWaveEventDataTSType("unmapped:event", tsTypesMap); got != "any" {
		t.Fatalf("expected any for unmapped event fallback, got: %q", got)
	}
	if _, found := tsTypesMap[reflect.TypeOf(wps.WaveEvent{})]; !found {
		t.Fatalf("expected WaveEvent type to be seeded in tsTypesMap")
	}
	if _, found := tsTypesMap[reflect.TypeOf(wshrpc.BlockJobStatusData{})]; !found {
		t.Fatalf("expected mapped data types to be generated into tsTypesMap")
	}
}
