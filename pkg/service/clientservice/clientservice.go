// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type ClientService struct{}

const DefaultTimeout = 2 * time.Second

func (cs *ClientService) GetClientData() (*waveobj.Client, error) {
	log.Println("GetClientData")
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	return wcore.GetClientData(ctx)
}

func (cs *ClientService) GetTab(tabId string) (*waveobj.Tab, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	return tab, nil
}

func (cs *ClientService) GetAllConnStatus(ctx context.Context) ([]wshrpc.ConnStatus, error) {
	sshStatuses := conncontroller.GetAllConnStatus()
	wslStatuses := wslconn.GetAllConnStatus()
	return append(sshStatuses, wslStatuses...), nil
}

// moves the window to the front of the windowId stack
func (cs *ClientService) FocusWindow(ctx context.Context, windowId string) error {
	return wcore.FocusWindow(ctx, windowId)
}

func (cs *ClientService) AgreeTos(ctx context.Context) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	clientData, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	timestamp := time.Now().UnixMilli()
	clientData.TosAgreed = timestamp
	err = wstore.DBUpdate(ctx, clientData)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %w", err)
	}
	wcore.BootstrapStarterLayout(ctx)
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (cs *ClientService) TelemetryUpdate(ctx context.Context, telemetryEnabled bool) error {
	meta := waveobj.MetaMapType{
		wconfig.ConfigKey_TelemetryEnabled: telemetryEnabled,
	}
	err := wconfig.SetBaseConfigValue(meta)
	if err != nil {
		return fmt.Errorf("error setting telemetry value: %w", err)
	}
	return nil
}
