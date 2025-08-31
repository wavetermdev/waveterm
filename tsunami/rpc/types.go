// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpc

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type VDomUrlRequestData struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body,omitempty"`
}

type VDomUrlRequestResponse struct {
	StatusCode int               `json:"statuscode,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       []byte            `json:"body,omitempty"`
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

type CommandWaitForRouteData struct {
	RouteId string `json:"routeid"`
	WaitMs  int    `json:"waitms"`
}

type ORef struct {
	OType string `json:"otype"`
	OID   string `json:"oid"`
}

func (oref ORef) String() string {
	return oref.OType + ":" + oref.OID
}
