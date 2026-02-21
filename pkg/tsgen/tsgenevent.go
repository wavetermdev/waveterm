// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgen

import (
	"bytes"
	"fmt"
	"reflect"
	"strconv"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var waveEventRType = reflect.TypeOf(wps.WaveEvent{})

var WaveEventDataTypes = map[string]reflect.Type{
	wps.Event_BlockClose:          reflect.TypeOf(""),
	wps.Event_ConnChange:          reflect.TypeOf(wshrpc.ConnStatus{}),
	wps.Event_SysInfo:             reflect.TypeOf(wshrpc.TimeSeriesData{}),
	wps.Event_ControllerStatus:    reflect.TypeOf((*blockcontroller.BlockControllerRuntimeStatus)(nil)),
	wps.Event_BuilderStatus:       reflect.TypeOf(wshrpc.BuilderStatusData{}),
	wps.Event_BuilderOutput:       reflect.TypeOf(map[string]any{}),
	wps.Event_WaveObjUpdate:       reflect.TypeOf(waveobj.WaveObjUpdate{}),
	wps.Event_BlockFile:           reflect.TypeOf((*wps.WSFileEventData)(nil)),
	wps.Event_Config:              reflect.TypeOf(wconfig.WatcherUpdate{}),
	wps.Event_UserInput:           reflect.TypeOf((*userinput.UserInputRequest)(nil)),
	wps.Event_RouteDown:           nil,
	wps.Event_RouteUp:             nil,
	wps.Event_WorkspaceUpdate:     nil,
	wps.Event_WaveAIRateLimit:     reflect.TypeOf((*uctypes.RateLimitInfo)(nil)),
	wps.Event_WaveAppAppGoUpdated: nil,
	wps.Event_TsunamiUpdateMeta:   reflect.TypeOf(wshrpc.AppMeta{}),
	wps.Event_AIModeConfig:        reflect.TypeOf(wconfig.AIModeConfigUpdate{}),
	wps.Event_TabIndicator:        reflect.TypeOf(wshrpc.TabIndicatorEventData{}),
	wps.Event_BlockJobStatus:      reflect.TypeOf(wshrpc.BlockJobStatusData{}),
}

func getWaveEventDataTSType(eventName string, tsTypesMap map[reflect.Type]string) string {
	rtype, found := WaveEventDataTypes[eventName]
	if !found {
		return "any"
	}
	if rtype == nil {
		return "null"
	}
	tsType, _ := TypeToTSType(rtype, tsTypesMap)
	if tsType == "" {
		return "any"
	}
	return tsType
}

func GenerateWaveEventTypes(tsTypesMap map[reflect.Type]string) string {
	for _, rtype := range WaveEventDataTypes {
		GenerateTSType(rtype, tsTypesMap)
	}
	// suppress default struct generation, this type is custom generated
	tsTypesMap[waveEventRType] = ""

	var buf bytes.Buffer
	buf.WriteString("// wps.WaveEvent\n")
	buf.WriteString("type WaveEventName = ")
	for idx, eventName := range wps.AllEvents {
		if idx > 0 {
			buf.WriteString(" | ")
		}
		buf.WriteString(strconv.Quote(eventName))
	}
	buf.WriteString(";\n\n")
	buf.WriteString("type WaveEvent = {\n")
	buf.WriteString("    event: WaveEventName;\n")
	buf.WriteString("    scopes?: string[];\n")
	buf.WriteString("    sender?: string;\n")
	buf.WriteString("    persist?: number;\n")
	buf.WriteString("    data?: unknown;\n")
	buf.WriteString("} & (\n")
	for idx, eventName := range wps.AllEvents {
		if idx > 0 {
			buf.WriteString(" | \n")
		}
		buf.WriteString(fmt.Sprintf("    { event: %s; data?: %s; }", strconv.Quote(eventName), getWaveEventDataTSType(eventName, tsTypesMap)))
	}
	buf.WriteString("\n);\n")
	return buf.String()
}
