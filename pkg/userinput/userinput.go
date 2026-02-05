// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package userinput

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var MainUserInputHandler = UserInputHandler{Channels: make(map[string](chan *UserInputResponse), 1)}

var defaultProvider UserInputProvider = &FrontendProvider{}

type UserInputProvider interface {
	GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error)
}

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

type FrontendProvider struct{}

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

func (ui *UserInputHandler) sendRequestToFrontend(request *UserInputRequest, scopes []string) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_UserInput,
		Data:   request,
		Scopes: scopes,
	})
}

func determineScopes(ctx context.Context) ([]string, error) {
	connData := genconn.GetConnData(ctx)
	if connData == nil {
		return nil, fmt.Errorf("context did not contain connection info")
	}
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

	return []string{windowId}, nil
}

func (p *FrontendProvider) GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error) {
	id, uiCh := MainUserInputHandler.registerChannel()
	defer MainUserInputHandler.unregisterChannel(id)
	request.RequestId = id
	request.TimeoutMs = int(utilfn.TimeoutFromContext(ctx, 30*time.Second).Milliseconds())

	scopes, scopesErr := determineScopes(ctx)
	if scopesErr != nil {
		log.Printf("user input scopes could not be found: %v", scopesErr)
		blocklogger.Infof(ctx, "user input scopes could not be found: %v", scopesErr)
		allWindows, err := wstore.DBGetAllOIDsByType(ctx, "window")
		if err != nil {
			blocklogger.Infof(ctx, "unable to find windows for user input: %v", err)
			return nil, fmt.Errorf("unable to find windows for user input: %v", err)
		}
		scopes = allWindows
	}

	MainUserInputHandler.sendRequestToFrontend(request, scopes)

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
		err = errors.New(response.ErrorMsg)
	}

	return response, err
}

func GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error) {
	return defaultProvider.GetUserInput(ctx, request)
}

func SetUserInputProvider(provider UserInputProvider) {
	defaultProvider = provider
}
