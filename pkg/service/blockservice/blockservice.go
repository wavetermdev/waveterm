// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

func (bs *BlockService) CreateBlock(bdef *wstore.BlockDef, rtOpts *wstore.RuntimeOpts) (*wstore.Block, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	if bdef == nil {
		return nil, fmt.Errorf("block definition is nil")
	}
	if rtOpts == nil {
		return nil, fmt.Errorf("runtime options is nil")
	}
	blockData, err := blockcontroller.CreateBlock(ctx, bdef, rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	return blockData, nil
}

func (bs *BlockService) CloseBlock(blockId string) {
	blockcontroller.CloseBlock(blockId)
}

func (bs *BlockService) GetBlockData(blockId string) (*wstore.Block, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	blockData, err := wstore.DBGet[wstore.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block data: %w", err)
	}
	return blockData, nil
}

func (bs *BlockService) SendCommand(blockId string, cmdMap map[string]any) error {
	cmd, err := blockcontroller.ParseCmdMap(cmdMap)
	if err != nil {
		return fmt.Errorf("error parsing command map: %w", err)
	}
	if strings.HasPrefix(cmd.GetCommand(), "controller:") {
		bc := blockcontroller.GetBlockController(blockId)
		if bc == nil {
			return fmt.Errorf("block controller not found for block %q", blockId)
		}
		bc.InputCh <- cmd
	} else {
		blockcontroller.ProcessStaticCommand(blockId, cmd)
	}
	return nil
}
