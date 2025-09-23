// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

type ObjRTInfo struct {
	TsunamiTitle     string `json:"tsunami:title,omitempty"`
	TsunamiShortDesc string `json:"tsunami:shortdesc,omitempty"`
	TsunamiSchemas   any    `json:"tsunami:schemas,omitempty"`
	CmdHasCurCwd     bool   `json:"cmd:hascurcwd,omitempty"`
}
