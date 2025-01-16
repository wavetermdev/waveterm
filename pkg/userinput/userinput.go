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
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
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

func (ui *UserInputHandler) sendRequestToFrontend(request *UserInputRequest, windowId string) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_UserInput,
		Data:   request,
		Scopes: []string{windowId},
	})
}

func GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error) {
	id, uiCh := MainUserInputHandler.registerChannel()
	defer MainUserInputHandler.unregisterChannel(id)
	request.RequestId = id
	deadline, _ := ctx.Deadline()
	request.TimeoutMs = int(time.Until(deadline).Milliseconds()) - 500

	connData := genconn.GetConnData(ctx)
	// resolve windowId from blockId
	tabId, err := wstore.DBFindTabForBlockId(ctx, connData.BlockId)
	if err != nil {
		return nil, fmt.Errorf("unabled to determine tab for route: %w", err)
	}
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("unabled to determine workspace for route: %w", err)
	}
	windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("unabled to determine window for route: %w", err)
	}

	MainUserInputHandler.sendRequestToFrontend(request, windowId)

	var response *UserInputResponse
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
