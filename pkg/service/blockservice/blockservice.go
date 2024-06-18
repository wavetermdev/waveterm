// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
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

func (bs *BlockService) SaveTerminalState(ctx context.Context, blockId string, state string, stateType string, ptyOffset int64) error {
	_, err := wstore.DBMustGet[*wstore.Block](ctx, blockId)
	if err != nil {
		return err
	}
	if stateType != "full" && stateType != "preview" {
		return fmt.Errorf("invalid state type: %q", stateType)
	}
	// ignore MakeFile error (already exists is ok)
	filestore.WFS.MakeFile(ctx, blockId, "cache:term:"+stateType, nil, filestore.FileOptsType{})
	err = filestore.WFS.WriteFile(ctx, blockId, "cache:term:"+stateType, []byte(state))
	if err != nil {
		return fmt.Errorf("cannot save terminal state: %w", err)
	}
	err = filestore.WFS.WriteMeta(ctx, blockId, "cache:term:"+stateType, filestore.FileMeta{"ptyoffset": ptyOffset}, true)
	if err != nil {
		return fmt.Errorf("cannot save terminal state meta: %w", err)
	}
	return nil
}
