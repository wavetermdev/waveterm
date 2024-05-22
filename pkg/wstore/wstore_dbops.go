// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

func WorkspaceCount(ctx context.Context) (int, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (int, error) {
		query := "SELECT count(*) FROM workspace"
		return tx.GetInt(query), nil
	})
}

func WorkspaceInsert(ctx context.Context, ws *Workspace) error {
	if ws.WorkspaceId == "" {
		ws.WorkspaceId = uuid.New().String()
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "INSERT INTO workspace (workspaceid, data) VALUES (?, ?)"
		tx.Exec(query, ws.WorkspaceId, TxJson(tx, ws))
		return nil
	})
}

func WorkspaceGet(ctx context.Context, workspaceId string) (*Workspace, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*Workspace, error) {
		query := "SELECT data FROM workspace WHERE workspaceid = ?"
		jsonData := tx.GetString(query, workspaceId)
		return TxReadJson[Workspace](tx, jsonData), nil
	})
}

func WorkspaceUpdate(ctx context.Context, ws *Workspace) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "UPDATE workspace SET data = ? WHERE workspaceid = ?"
		tx.Exec(query, TxJson(tx, ws), ws.WorkspaceId)
		return nil
	})
}

func addTabToWorkspace(ctx context.Context, workspaceId string, tabId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		ws, err := WorkspaceGet(tx.Context(), workspaceId)
		if err != nil {
			return err
		}
		if ws == nil {
			return fmt.Errorf("workspace not found: %s", workspaceId)
		}
		ws.TabIds = append(ws.TabIds, tabId)
		return WorkspaceUpdate(tx.Context(), ws)
	})
}

func TabInsert(ctx context.Context, tab *Tab, workspaceId string) error {
	if tab.TabId == "" {
		tab.TabId = uuid.New().String()
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "INSERT INTO tab (tabid, data) VALUES (?, ?)"
		tx.Exec(query, tab.TabId, TxJson(tx, tab))
		return addTabToWorkspace(tx.Context(), workspaceId, tab.TabId)
	})
}

func BlockGet(ctx context.Context, blockId string) (*Block, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*Block, error) {
		query := "SELECT data FROM block WHERE blockid = ?"
		jsonData := tx.GetString(query, blockId)
		return TxReadJson[Block](tx, jsonData), nil
	})
}

func BlockDelete(ctx context.Context, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "DELETE FROM block WHERE blockid = ?"
		tx.Exec(query, blockId)
		return nil
	})
}

func BlockInsert(ctx context.Context, block *Block) error {
	if block.BlockId == "" {
		block.BlockId = uuid.New().String()
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "INSERT INTO block (blockid, data) VALUES (?, ?)"
		tx.Exec(query, block.BlockId, TxJson(tx, block))
		return nil
	})
}
