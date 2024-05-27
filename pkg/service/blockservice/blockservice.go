// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

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
