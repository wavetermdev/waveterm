// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

var BlockServiceInstance = &BlockService{}

func (bs *BlockService) SendCommand_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send command to block",
		ArgNames: []string{"blockid", "cmd"},
	}
}

func (bs *BlockService) SendCommand(blockId string, cmd wshutil.BlockCommand) error {
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
