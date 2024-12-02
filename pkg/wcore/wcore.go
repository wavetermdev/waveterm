// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// wave core application coordinator
package wcore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// the wcore package coordinates actions across the storage layer
// orchestrating the wave object store, the wave pubsub system, and the wave rpc system

// TODO bring Tx infra into wcore

const DefaultTimeout = 2 * time.Second
const DefaultActivateBlockTimeout = 60 * time.Second

func DeleteBlock(ctx context.Context, blockId string) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	if block == nil {
		return nil
	}
	if len(block.SubBlockIds) > 0 {
		for _, subBlockId := range block.SubBlockIds {
			err := DeleteBlock(ctx, subBlockId)
			if err != nil {
				return fmt.Errorf("error deleting subblock %s: %w", subBlockId, err)
			}
		}
	}
	err = wstore.DeleteBlock(ctx, blockId)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	go blockcontroller.StopBlockController(blockId)
	sendBlockCloseEvent(blockId)
	return nil
}

func sendBlockCloseEvent(blockId string) {
	waveEvent := wps.WaveEvent{
		Event: wps.Event_BlockClose,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: blockId,
	}
	wps.Broker.Publish(waveEvent)
}

// returns (new-window, first-time, error)
func EnsureInitialData() (*waveobj.Window, bool, error) {
	// does not need to run in a transaction since it is called on startup
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	firstRun := false
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err == wstore.ErrNotFound {
		client, err = CreateClient(ctx)
		if err != nil {
			return nil, false, fmt.Errorf("error creating client: %w", err)
		}
		firstRun = true
	}
	if client.TempOID == "" {
		log.Println("client.TempOID is empty")
		client.TempOID = uuid.NewString()
		err = wstore.DBUpdate(ctx, client)
		if err != nil {
			return nil, false, fmt.Errorf("error updating client: %w", err)
		}
	}
	log.Printf("clientid: %s\n", client.OID)
	if len(client.WindowIds) == 1 {
		log.Println("client has one window")
		window := CheckAndFixWindow(ctx, client.WindowIds[0])
		if window != nil {
			return window, firstRun, nil
		}
	}
	if len(client.WindowIds) > 0 {
		log.Println("client has windows")
		return nil, false, nil
	}
	log.Println("client has no windows, creating default workspace")
	defaultWs, err := CreateWorkspace(ctx, "Default workspace", "circle", "green")
	if err != nil {
		return nil, false, fmt.Errorf("error creating default workspace: %w", err)
	}
	_, err = CreateTab(ctx, defaultWs.OID, "", true)
	if err != nil {
		return nil, false, fmt.Errorf("error creating tab: %w", err)
	}
	window, err := CreateWindow(ctx, nil, defaultWs.OID)
	if err != nil {
		return nil, false, fmt.Errorf("error creating window: %w", err)
	}
	return window, firstRun, nil
}

func CreateClient(ctx context.Context) (*waveobj.Client, error) {
	client := &waveobj.Client{
		OID:       uuid.NewString(),
		WindowIds: []string{},
	}
	err := wstore.DBInsert(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error inserting client: %w", err)
	}
	return client, nil
}

func CreateSubBlock(ctx context.Context, blockId string, blockDef *waveobj.BlockDef) (*waveobj.Block, error) {
	if blockDef == nil {
		return nil, fmt.Errorf("blockDef is nil")
	}
	if blockDef.Meta == nil || blockDef.Meta.GetString(waveobj.MetaKey_View, "") == "" {
		return nil, fmt.Errorf("no view provided for new block")
	}
	blockData, err := wstore.CreateSubBlock(ctx, blockId, blockDef)
	if err != nil {
		return nil, fmt.Errorf("error creating sub block: %w", err)
	}
	return blockData, nil
}

func CreateBlock(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (*waveobj.Block, error) {
	if blockDef == nil {
		return nil, fmt.Errorf("blockDef is nil")
	}
	if blockDef.Meta == nil || blockDef.Meta.GetString(waveobj.MetaKey_View, "") == "" {
		return nil, fmt.Errorf("no view provided for new block")
	}
	blockData, err := wstore.CreateBlock(ctx, tabId, blockDef, rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	go func() {
		defer panichandler.PanicHandler("CreateBlock:telemetry")
		blockView := blockDef.Meta.GetString(waveobj.MetaKey_View, "")
		if blockView == "" {
			return
		}
		tctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelFn()
		telemetry.UpdateActivity(tctx, wshrpc.ActivityUpdate{
			Renderers: map[string]int{blockView: 1},
		})
	}()
	return blockData, nil
}

func GetClientData(ctx context.Context) (*waveobj.Client, error) {
	clientData, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	log.Printf("clientData: %v\n", clientData)
	return clientData, nil
}
