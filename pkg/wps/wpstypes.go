// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wps

import "github.com/wavetermdev/waveterm/pkg/util/utilfn"

const (
	Event_BlockClose       = "blockclose"
	Event_ConnChange       = "connchange"
	Event_SysInfo          = "sysinfo"
	Event_ControllerStatus = "controllerstatus"
	Event_WaveObjUpdate    = "waveobj:update"
	Event_BlockFile        = "blockfile"
	Event_Config           = "config"
	Event_UserInput        = "userinput"
	Event_RouteGone        = "route:gone"
	Event_WorkspaceUpdate  = "workspace:update"
	Event_WaveAIRateLimit  = "waveai:ratelimit"
)

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
