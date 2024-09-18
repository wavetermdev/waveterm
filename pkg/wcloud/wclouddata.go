// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcloud

import (
	"github.com/wavetermdev/waveterm/pkg/telemetry"
)

type NoTelemetryInputType struct {
	ClientId string `json:"clientid"`
	Value    bool   `json:"value"`
}

type TelemetryInputType struct {
	UserId       string                    `json:"userid"`
	ClientId     string                    `json:"clientid"`
	CurDay       string                    `json:"curday"`
	DefaultShell string                    `json:"defaultshell"`
	Activity     []*telemetry.ActivityType `json:"activity"`
}
