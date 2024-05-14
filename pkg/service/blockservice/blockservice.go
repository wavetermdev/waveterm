// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"fmt"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
)

type BlockService struct{}

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
