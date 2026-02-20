// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// used for shared datastructures
package baseds

type LinkId int32

const NoLinkId = 0

type RpcInputChType struct {
	MsgBytes      []byte
	IngressLinkId LinkId
}

type Badge struct {
	Icon     string  `json:"icon"`
	Color    string  `json:"color,omitempty"`
	Priority float64 `json:"priority"`
}

type BadgeEvent struct {
	ORef       string `json:"oref"`
	Persistent bool   `json:"persistent,omitempty"`
	Clear      bool   `json:"clear,omitempty"`
	Badge      *Badge `json:"badge,omitempty"`
}
