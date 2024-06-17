// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowservice

import (
	"context"

	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

type WindowService struct{}

func (ws *WindowService) SetWindowPosAndSize(ctx context.Context, windowId string, pos *wstore.Point, size *wstore.WinSize) (wstore.UpdatesRtnType, error) {
	if pos == nil && size == nil {
		return nil, nil
	}
	ctx = wstore.ContextWithUpdates(ctx)
	win, err := wstore.DBMustGet[*wstore.Window](ctx, windowId)
	if err != nil {
		return nil, err
	}
	if pos != nil {
		win.Pos = *pos
	}
	if size != nil {
		win.WinSize = *size
	}
	err = wstore.DBUpdate(ctx, win)
	if err != nil {
		return nil, err
	}
	return wstore.ContextGetUpdatesRtn(ctx), nil
}
