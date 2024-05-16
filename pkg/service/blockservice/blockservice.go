// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"fmt"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
)

type BlockService struct{}

func (bs *BlockService) CreateBlock(bdefMap map[string]any, rtOptsMap map[string]any) (map[string]any, error) {
	var bdef blockcontroller.BlockDef
	err := utilfn.JsonMapToStruct(bdefMap, &bdef)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling BlockDef: %w", err)
	}
	var rtOpts blockcontroller.RuntimeOpts
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

func (bs *BlockService) GetBlockData(blockId string) (map[string]any, error) {
	blockData := blockcontroller.GetBlockData(blockId)
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
	bc := blockcontroller.GetBlockController(blockId)
	if bc == nil {
		return fmt.Errorf("block controller not found for block %q", blockId)
	}
	cmd, err := blockcontroller.ParseCmdMap(cmdMap)
	if err != nil {
		return fmt.Errorf("error parsing command map: %w", err)
	}
	bc.InputCh <- cmd
	return nil
}
