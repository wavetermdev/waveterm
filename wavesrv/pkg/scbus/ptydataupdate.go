// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scbus

const PtyDataUpdateStr = "pty"

// An UpdatePacket for sending pty data to the client
type PtyDataUpdate struct {
	ScreenId   string `json:"screenid,omitempty"`
	LineId     string `json:"lineid,omitempty"`
	RemoteId   string `json:"remoteid,omitempty"`
	PtyPos     int64  `json:"ptypos"`
	PtyData64  string `json:"ptydata64"`
	PtyDataLen int64  `json:"ptydatalen"`
}

func (*PtyDataUpdate) GetType() string {
	return PtyDataUpdateStr
}

func (pdu *PtyDataUpdate) Clean() {}
