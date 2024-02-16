// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scbus

import (
	"reflect"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
)

const PtyDataUpdateStr = "pty"

type PtyDataUpdate struct {
	ScreenId   string `json:"screenid,omitempty"`
	LineId     string `json:"lineid,omitempty"`
	RemoteId   string `json:"remoteid,omitempty"`
	PtyPos     int64  `json:"ptypos"`
	PtyData64  string `json:"ptydata64"`
	PtyDataLen int64  `json:"ptydatalen"`
}

// An UpdatePacket for sending pty data to the client
type PtyDataUpdatePacketType struct {
	Type string         `json:"type"`
	Data *PtyDataUpdate `json:"data"`
}

func (*PtyDataUpdatePacketType) GetType() string {
	return PtyDataUpdateStr
}

func (pdu *PtyDataUpdatePacketType) Clean() {}

func MakePtyDataUpdate(update *PtyDataUpdate) *PtyDataUpdatePacketType {
	return &PtyDataUpdatePacketType{Type: PtyDataUpdateStr, Data: update}
}

func init() {
	packet.RegisterPacketType(PtyDataUpdateStr, reflect.TypeOf(PtyDataUpdatePacketType{}))
}
