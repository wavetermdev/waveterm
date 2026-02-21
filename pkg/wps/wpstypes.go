// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wps

import (
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// IMPORTANT: When adding a new event constant, you MUST also:
//  1. Add a "// type: <TypeName>" comment (use "none" if no data is sent)
//  2. Add the constant to AllEvents below
//  3. Add an entry to WaveEventDataTypes in pkg/tsgen/tsgenevent.go
//     - Use reflect.TypeOf(YourType{}) for value types
//     - Use reflect.TypeOf((*YourType)(nil)) for pointer types
//     - Use nil if no data is sent for the event
const (
	Event_BlockClose          = "blockclose"           // type: string
	Event_ConnChange          = "connchange"           // type: wshrpc.ConnStatus
	Event_SysInfo             = "sysinfo"              // type: wshrpc.TimeSeriesData
	Event_ControllerStatus    = "controllerstatus"     // type: *blockcontroller.BlockControllerRuntimeStatus
	Event_BuilderStatus       = "builderstatus"        // type: wshrpc.BuilderStatusData
	Event_BuilderOutput       = "builderoutput"        // type: map[string]any
	Event_WaveObjUpdate       = "waveobj:update"       // type: waveobj.WaveObjUpdate
	Event_BlockFile           = "blockfile"            // type: *WSFileEventData
	Event_Config              = "config"               // type: wconfig.WatcherUpdate
	Event_UserInput           = "userinput"            // type: *userinput.UserInputRequest
	Event_RouteDown           = "route:down"           // type: none
	Event_RouteUp             = "route:up"             // type: none
	Event_WorkspaceUpdate     = "workspace:update"     // type: none
	Event_WaveAIRateLimit     = "waveai:ratelimit"     // type: *uctypes.RateLimitInfo
	Event_WaveAppAppGoUpdated = "waveapp:appgoupdated" // type: none
	Event_TsunamiUpdateMeta   = "tsunami:updatemeta"   // type: wshrpc.AppMeta
	Event_AIModeConfig        = "waveai:modeconfig"    // type: wconfig.AIModeConfigUpdate
	Event_TabIndicator        = "tab:indicator"        // type: wshrpc.TabIndicatorEventData
	Event_BlockJobStatus      = "block:jobstatus"      // type: wshrpc.BlockJobStatusData
)

var AllEvents []string = []string{
	Event_BlockClose,
	Event_ConnChange,
	Event_SysInfo,
	Event_ControllerStatus,
	Event_BuilderStatus,
	Event_BuilderOutput,
	Event_WaveObjUpdate,
	Event_BlockFile,
	Event_Config,
	Event_UserInput,
	Event_RouteDown,
	Event_RouteUp,
	Event_WorkspaceUpdate,
	Event_WaveAIRateLimit,
	Event_WaveAppAppGoUpdated,
	Event_TsunamiUpdateMeta,
	Event_AIModeConfig,
	Event_TabIndicator,
	Event_BlockJobStatus,
}

type WaveEvent struct {
	Event   string   `json:"event"`
	Scopes  []string `json:"scopes,omitempty"`
	Sender  string   `json:"sender,omitempty"`
	Persist int      `json:"persist,omitempty"`
	Data    any      `json:"data,omitempty"`
}

func (e WaveEvent) HasScope(scope string) bool {
	return utilfn.ContainsStr(e.Scopes, scope)
}

type SubscriptionRequest struct {
	Event     string   `json:"event"`
	Scopes    []string `json:"scopes,omitempty"`
	AllScopes bool     `json:"allscopes,omitempty"`
}

const (
	FileOp_Create     = "create"
	FileOp_Delete     = "delete"
	FileOp_Append     = "append"
	FileOp_Truncate   = "truncate"
	FileOp_Invalidate = "invalidate"
)

type WSFileEventData struct {
	ZoneId   string `json:"zoneid"`
	FileName string `json:"filename"`
	FileOp   string `json:"fileop"`
	Data64   string `json:"data64"`
}
