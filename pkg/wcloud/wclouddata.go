// Copyright 2025, Command Line Inc.
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
	UserId            string                    `json:"userid"`
	ClientId          string                    `json:"clientid"`
	AppType           string                    `json:"apptype,omitempty"`
	AutoUpdateEnabled bool                      `json:"autoupdateenabled,omitempty"`
	AutoUpdateChannel string                    `json:"autoupdatechannel,omitempty"`
	CurDay            string                    `json:"curday"`
	Activity          []*telemetry.ActivityType `json:"activity"`
}
