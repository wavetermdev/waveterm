// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Provides a mechanism for the backend to request user input from the frontend.
package userinput

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/feupdate"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/feupdate/updatebus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
)

// The main bus for receiving user input responses from the client
var MainBus *UserInputBus = MakeUserInputBus()

// A bus for registering channels to receive user input responses from the client
type UserInputBus struct {
	bus *updatebus.UpdateBus[*scpacket.UserInputResponsePacketType, *UserInputChannel]
}

// Make a new user input bus
func MakeUserInputBus() *UserInputBus {
	return &UserInputBus{bus: updatebus.MakeUpdateBus[*scpacket.UserInputResponsePacketType, *UserInputChannel]()}
}

// A channel for receiving user input responses from the client
type UserInputChannel struct {
	ch chan *scpacket.UserInputResponsePacketType
}

func (uch *UserInputChannel) GetChannel() chan *scpacket.UserInputResponsePacketType {
	return uch.ch
}

func (uch *UserInputChannel) SetChannel(ch chan *scpacket.UserInputResponsePacketType) {
	uch.ch = ch
}

// An UpdatePacket for requesting user input from the client
type UserInputRequestType struct {
	RequestId    string `json:"requestid"`
	QueryText    string `json:"querytext"`
	ResponseType string `json:"responsetype"`
	Title        string `json:"title"`
	Markdown     bool   `json:"markdown"`
	TimeoutMs    int    `json:"timeoutms"`
}

func (UserInputRequestType) GetType() string {
	return "userinputrequest"
}

// Get the user input channel for the given request id
func (bus *UserInputBus) GetUserInputChannel(id string) (chan *scpacket.UserInputResponsePacketType, bool) {
	bus.bus.Lock.Lock()
	defer bus.bus.Lock.Unlock()

	if uich, ok := bus.bus.Channels[id]; ok {
		return uich.GetChannel(), ok
	}
	return nil, false
}

// Send a user input request to the frontend and wait for a response
func (bus *UserInputBus) GetUserInput(ctx context.Context, userInputRequest *UserInputRequestType) (*scpacket.UserInputResponsePacketType, error) {
	id := uuid.New().String()
	uich := bus.bus.RegisterChannel(id, &UserInputChannel{})
	defer bus.bus.UnregisterChannel(id)

	userInputRequest.RequestId = id
	deadline, _ := ctx.Deadline()
	userInputRequest.TimeoutMs = int(time.Until(deadline).Milliseconds()) - 500

	// Send the request to the frontend
	mu := &feupdate.ModelUpdate{}
	mu.AddUpdate(userInputRequest)
	feupdate.MainBus.SendUpdate(mu)

	var response *scpacket.UserInputResponsePacketType
	var err error
	// prepare to receive response
	select {
	case resp := <-uich:
		response = resp
	case <-ctx.Done():
		return nil, fmt.Errorf("Timed out waiting for user input")
	}

	if response.ErrorMsg != "" {
		err = fmt.Errorf(response.ErrorMsg)
	}

	return response, err
}
