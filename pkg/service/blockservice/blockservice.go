// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

type BlockService struct{}

func (bs *BlockService) CreateBlock(bdefMap map[string]any, rtOptsMap map[string]any) (map[string]any, error) {
	var bdef wstore.BlockDef
	err := utilfn.JsonMapToStruct(bdefMap, &bdef)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling BlockDef: %w", err)
	}
	var rtOpts wstore.RuntimeOpts
	err = utilfn.JsonMapToStruct(rtOptsMap, &rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling RuntimeOpts: %w", err)
	}
	blockData, err := blockcontroller.CreateBlock(&bdef, &rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	rtnMap, err := utilfn.StructToJsonMap(blockData)
	if err != nil {
		return nil, fmt.Errorf("error marshalling BlockData: %w", err)
	}
	return rtnMap, nil
}

func (bs *BlockService) CloseBlock(blockId string) {
	blockcontroller.CloseBlock(blockId)
}

func (bs *BlockService) GetBlockData(blockId string) (map[string]any, error) {
	blockData := wstore.BlockMap.Get(blockId)
	if blockData == nil {
		return nil, nil
	}
	rtnMap, err := utilfn.StructToJsonMap(blockData)
	if err != nil {
		return nil, fmt.Errorf("error marshalling BlockData: %w", err)
	}
	return rtnMap, nil

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
