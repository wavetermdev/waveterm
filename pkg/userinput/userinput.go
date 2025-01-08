// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package userinput

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

var MainUserInputHandler = UserInputHandler{Channels: make(map[string](chan *UserInputResponse), 1)}

type UserInputRequest struct {
	RequestId    string `json:"requestid"`
	QueryText    string `json:"querytext"`
	ResponseType string `json:"responsetype"`
	Title        string `json:"title"`
	Markdown     bool   `json:"markdown"`
	TimeoutMs    int    `json:"timeoutms"`
	CheckBoxMsg  string `json:"checkboxmsg"`
	PublicText   bool   `json:"publictext"`
	OkLabel      string `json:"oklabel,omitempty"`
	CancelLabel  string `json:"cancellabel,omitempty"`
}

type UserInputResponse struct {
	Type         string `json:"type"`
	RequestId    string `json:"requestid"`
	Text         string `json:"text,omitempty"`
	Confirm      bool   `json:"confirm,omitempty"`
	ErrorMsg     string `json:"errormsg,omitempty"`
	CheckboxStat bool   `json:"checkboxstat,omitempty"`
}

type UserInputHandler struct {
	Lock     sync.Mutex
	Channels map[string](chan *UserInputResponse)
}

func (ui *UserInputHandler) registerChannel() (string, chan *UserInputResponse) {
	ui.Lock.Lock()
	defer ui.Lock.Unlock()

	id := uuid.New().String()
	uich := make(chan *UserInputResponse, 1)

	ui.Channels[id] = uich
	return id, uich
}

func (ui *UserInputHandler) unregisterChannel(id string) {
	ui.Lock.Lock()
	defer ui.Lock.Unlock()

	delete(ui.Channels, id)
}

func (ui *UserInputHandler) sendRequestToFrontend(request *UserInputRequest) {
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_UserInput,
		Data:  request,
	})
}

func GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error) {
	id, uiCh := MainUserInputHandler.registerChannel()
	defer MainUserInputHandler.unregisterChannel(id)
	request.RequestId = id
	deadline, _ := ctx.Deadline()
	request.TimeoutMs = int(time.Until(deadline).Milliseconds()) - 500
	MainUserInputHandler.sendRequestToFrontend(request)

	var response *UserInputResponse
	var err error
	select {
	case resp := <-uiCh:
		log.Printf("checking received: %v", resp.RequestId)
		response = resp
	case <-ctx.Done():
		return nil, fmt.Errorf("timed out waiting for user input")
	}

	if response.ErrorMsg != "" {
		err = fmt.Errorf(response.ErrorMsg)
	}

	return response, err
}
