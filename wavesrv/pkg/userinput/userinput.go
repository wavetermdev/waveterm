// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Provides a mechanism for the backend to request user input from the frontend.
package userinput

import (
	"context"
	"fmt"
	"reflect"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
)

// An UpdatePacket for requesting user input from the client
type UserInputRequestType struct {
	RequestId    string `json:"requestid"`
	QueryText    string `json:"querytext"`
	ResponseType string `json:"responsetype"`
	Title        string `json:"title"`
	Markdown     bool   `json:"markdown"`
	TimeoutMs    int    `json:"timeoutms"`
}

func (*UserInputRequestType) GetType() string {
	return "userinputrequest"
}

func (req *UserInputRequestType) GetReqId() string {
	return req.RequestId
}

func (req *UserInputRequestType) SetReqId(reqId string) {
	req.RequestId = reqId
}

func (req *UserInputRequestType) GetTimeoutMs() int {
	return req.TimeoutMs
}

func (req *UserInputRequestType) SetTimeoutMs(timeoutMs int) {
	req.TimeoutMs = timeoutMs
}

// Send a user input request to the frontend and wait for a response
func GetUserInput(ctx context.Context, bus *scbus.RpcBus, userInputRequest *UserInputRequestType) (*scpacket.UserInputResponsePacketType, error) {
	resp, err := scbus.MainRpcBus.DoRpc(ctx, userInputRequest)
	if err != nil {
		return nil, err
	}
	if ret, ok := resp.(*scpacket.UserInputResponsePacketType); !ok {
		return nil, fmt.Errorf("unexpected response type: %v", reflect.TypeOf(resp))
	} else {
		return ret, nil
	}
}
