// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Provides a mechanism for the backend to request user input from the frontend.
package userinput

import (
	"context"
	"fmt"
	"reflect"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
)

// An RpcPacket for requesting user input from the client
type UserInputRequestType struct {
	RequestId    string `json:"requestid"`
	QueryText    string `json:"querytext"`
	ResponseType string `json:"responsetype"`
	Title        string `json:"title"`
	Markdown     bool   `json:"markdown"`
	TimeoutMs    int    `json:"timeoutms"`
	CheckBoxMsg  string `json:"checkboxmsg"`
}

func (*UserInputRequestType) GetType() string {
	return "userinputrequest"
}

func (req *UserInputRequestType) SetReqId(reqId string) {
	req.RequestId = reqId
}

func (req *UserInputRequestType) SetTimeoutMs(timeoutMs int) {
	req.TimeoutMs = timeoutMs
}

const UserInputResponsePacketStr = "userinputresp"

// An RpcResponse for user input requests
type UserInputResponsePacketType struct {
	Type         string `json:"type"`
	RequestId    string `json:"requestid"`
	Text         string `json:"text,omitempty"`
	Confirm      bool   `json:"confirm,omitempty"`
	ErrorMsg     string `json:"errormsg,omitempty"`
	CheckboxStat bool   `json:"checkboxstat,omitempty"`
}

func (*UserInputResponsePacketType) GetType() string {
	return UserInputResponsePacketStr
}

func (pk *UserInputResponsePacketType) GetError() string {
	return pk.ErrorMsg
}

func (pk *UserInputResponsePacketType) SetError(err string) {
	pk.ErrorMsg = err
}

// Send a user input request to the frontend and wait for a response
func GetUserInput(ctx context.Context, bus *scbus.RpcBus, userInputRequest *UserInputRequestType) (*UserInputResponsePacketType, error) {
	resp, err := scbus.MainRpcBus.DoRpc(ctx, userInputRequest)
	if err != nil {
		return nil, err
	}
	if ret, ok := resp.(*UserInputResponsePacketType); !ok {
		return nil, fmt.Errorf("unexpected response type: %v", reflect.TypeOf(resp))
	} else {
		return ret, nil
	}
}

func init() {
	// Register the user input request packet type
	packet.RegisterPacketType(UserInputResponsePacketStr, reflect.TypeOf(UserInputResponsePacketType{}))
}
