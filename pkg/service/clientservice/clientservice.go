// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

type ClientService struct{}

const DefaultTimeout = 2 * time.Second

func (cs *ClientService) GetClientData() (*wstore.Client, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	clientData, err := wstore.DBGetSingleton[*wstore.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	return clientData, nil
}

func (cs *ClientService) GetWorkspace(workspaceId string) (*wstore.Workspace, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ws, err := wstore.DBGet[*wstore.Workspace](ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	return ws, nil
}

func (cs *ClientService) GetTab(tabId string) (*wstore.Tab, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	tab, err := wstore.DBGet[*wstore.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	return tab, nil
}

func (cs *ClientService) GetWindow(windowId string) (*wstore.Window, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	window, err := wstore.DBGet[*wstore.Window](ctx, windowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	return window, nil
}
