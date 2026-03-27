// Copyright 2026, Command Line Inc.
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
	BadgeId   string  `json:"badgeid"` // must be a uuidv7
	Icon      string  `json:"icon"`
	Color     string  `json:"color,omitempty"`
	Priority  float64 `json:"priority"`
	PidLinked bool    `json:"pidlinked,omitempty"`
}

type BadgeEvent struct {
	ORef        string `json:"oref"`
	Clear       bool   `json:"clear,omitempty"`
	ClearAll    bool   `json:"clearall,omitempty"`
	ClearById   string `json:"clearbyid,omitempty"`
	Badge       *Badge `json:"badge,omitempty"`
	Sound       string `json:"sound,omitempty"`
	Border      bool   `json:"border,omitempty"`
	BorderColor string `json:"bordercolor,omitempty"`
}
