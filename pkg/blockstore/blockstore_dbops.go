// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"context"
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
)

func dbInsertFile(ctx context.Context, file *BlockFile) error {
	// will fail if file already exists
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "INSERT INTO db_block_file (blockid, name, size, createdts, modts, opts, meta) VALUES (?, ?, ?, ?, ?, ?, ?)"
		tx.Exec(query, file.BlockId, file.Name, file.Size, file.CreatedTs, file.ModTs, dbutil.QuickJson(file.Opts), dbutil.QuickJson(file.Meta))
		return nil
	})
}

func dbDeleteFile(ctx context.Context, blockId string, name string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "DELETE FROM db_block_file WHERE blockid = ? AND name = ?"
		tx.Exec(query, blockId, name)
		query = "DELETE FROM db_block_data WHERE blockid = ? AND name = ?"
		tx.Exec(query, blockId, name)
		return nil
	})
}

func dbGetBlockFileNames(ctx context.Context, blockId string) ([]string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]string, error) {
		var files []string
		query := "SELECT name FROM db_block_file WHERE blockid = ?"
		tx.Select(&files, query, blockId)
		return files, nil
	})
}

func dbGetBlockFile(ctx context.Context, blockId string, name string) (*BlockFile, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*BlockFile, error) {
		query := "SELECT * FROM db_block_file WHERE blockid = ? AND name = ?"
		file := dbutil.GetMappable[*BlockFile](tx, query, blockId, name)
		return file, nil
	})
}

func dbGetAllBlockIds(ctx context.Context) ([]string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]string, error) {
		var ids []string
		query := "SELECT DISTINCT blockid FROM db_block_file"
		tx.Select(&ids, query)
		return ids, nil
	})
}

func dbGetFileParts(ctx context.Context, blockId string, name string, parts []int) (map[int]*DataCacheEntry, error) {
	if len(parts) == 0 {
		return nil, nil
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (map[int]*DataCacheEntry, error) {
		var data []*DataCacheEntry
		query := "SELECT partidx, data FROM db_block_data WHERE blockid = ? AND name = ? AND partidx IN (SELECT value FROM json_each(?))"
		tx.Select(&data, query, blockId, name, dbutil.QuickJsonArr(parts))
		rtn := make(map[int]*DataCacheEntry)
		for _, d := range data {
			if cap(d.Data) != int(partDataSize) {
				newData := make([]byte, len(d.Data), partDataSize)
				copy(newData, d.Data)
				d.Data = newData
			}
			rtn[d.PartIdx] = d
		}
		return rtn, nil
	})
}

func dbGetBlockFiles(ctx context.Context, blockId string) ([]*BlockFile, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]*BlockFile, error) {
		query := "SELECT * FROM db_block_file WHERE blockid = ?"
		files := dbutil.SelectMappable[*BlockFile](tx, query, blockId)
		return files, nil
	})
}

func dbWriteCacheEntry(ctx context.Context, file *BlockFile, dataEntries map[int]*DataCacheEntry, replace bool) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT blockid FROM db_block_file WHERE blockid = ? AND name = ?`
		if !tx.Exists(query, file.BlockId, file.Name) {
			// since deletion is synchronous this stops us from writing to a deleted file
			return os.ErrNotExist
		}
		// we don't update CreatedTs or Opts
		query = `UPDATE db_block_file SET size = ?, modts = ?, meta = ? WHERE blockid = ? AND name = ?`
		tx.Exec(query, file.Size, file.ModTs, dbutil.QuickJson(file.Meta), file.BlockId, file.Name)
		if replace {
			query = `DELETE FROM db_block_data WHERE blockid = ? AND name = ?`
			tx.Exec(query, file.BlockId, file.Name)
		}
		dataPartQuery := `REPLACE INTO db_block_data (blockid, name, partidx, data) VALUES (?, ?, ?, ?)`
		for partIdx, dataEntry := range dataEntries {
			if partIdx != dataEntry.PartIdx {
				panic(fmt.Sprintf("partIdx:%d and dataEntry.PartIdx:%d do not match", partIdx, dataEntry.PartIdx))
			}
			tx.Exec(dataPartQuery, file.BlockId, file.Name, dataEntry.PartIdx, dataEntry.Data)
		}
		return nil
	})
}
