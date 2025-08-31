// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpc

import (
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type RpcOpts struct {
	Timeout    int64  `json:"timeout,omitempty"`
	NoResponse bool   `json:"noresponse,omitempty"`
	Route      string `json:"route,omitempty"`

	StreamCancelFn func() `json:"-"` // this is an *output* parameter, set by the handler
}

type RpcContext struct {
	ClientType string `json:"ctype,omitempty"`
	BlockId    string `json:"blockid,omitempty"`
	TabId      string `json:"tabid,omitempty"`
	Conn       string `json:"conn,omitempty"`
}

type ORef struct {
	OType string `json:"otype"`
	OID   string `json:"oid"`
}

func (oref ORef) String() string {
	return oref.OType + ":" + oref.OID
}

// Types moved to rpctypes package
type VDomUrlRequestData = rpctypes.VDomUrlRequestData
type VDomUrlRequestResponse = rpctypes.VDomUrlRequestResponse
type CommandWaitForRouteData = rpctypes.CommandWaitForRouteData
