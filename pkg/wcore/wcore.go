// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// wave core application coordinator
package wcore

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wps"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

// the wcore package coordinates actions across the storage layer
// orchestrating the wave object store, the wave pubsub system, and the wave rpc system

// TODO bring Tx infra into wcore

const DefaultTimeout = 2 * time.Second

func DeleteBlock(ctx context.Context, tabId string, blockId string) error {
	err := wstore.DeleteBlock(ctx, tabId, blockId)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	blockcontroller.StopBlockController(blockId)
	sendBlockCloseEvent(tabId, blockId)
	return nil
}

func sendBlockCloseEvent(tabId string, blockId string) {
	waveEvent := wshrpc.WaveEvent{
		Event: wshrpc.Event_BlockClose,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Tab, tabId).String(),
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: blockId,
	}
	wps.Broker.Publish(waveEvent)
}

func DeleteTab(ctx context.Context, workspaceId string, tabId string) error {
	tabData, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return fmt.Errorf("error getting tab: %w", err)
	}
	if tabData == nil {
		return nil
	}
	// close blocks (sends events + stops block controllers)
	for _, blockId := range tabData.BlockIds {
		err := DeleteBlock(ctx, tabId, blockId)
		if err != nil {
			return fmt.Errorf("error deleting block %s: %w", blockId, err)
		}
	}
	// now delete tab (also deletes layout)
	err = wstore.DeleteTab(ctx, workspaceId, tabId)
	if err != nil {
		return fmt.Errorf("error deleting tab: %w", err)
	}

	return nil
}
