package blockstore

import (
	"context"
	"fmt"
	"sync/atomic"

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
	return WithTxRtn(ctx, func(tx *TxWrap) (map[int]*DataCacheEntry, error) {
		var data []*DataCacheEntry
		query := "SELECT partidx, data FROM db_block_data WHERE blockid = ? AND name = ? AND partidx IN (SELECT value FROM json_each(?))"
		tx.Select(&data, query, blockId, name, dbutil.QuickJsonArr(parts))
		rtn := make(map[int]*DataCacheEntry)
		for _, d := range data {
			d.Dirty = &atomic.Bool{}
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

func dbWriteCacheEntry(ctx context.Context, fileEntry *FileCacheEntry, dataEntries []*DataCacheEntry) error {
	if fileEntry == nil {
		return fmt.Errorf("fileEntry or fileEntry.File is nil")
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT blockid FROM db_block_file WHERE blockid = ? AND name = ?`
		if !tx.Exists(query, fileEntry.File.BlockId, fileEntry.File.Name) {
			// since deletion is synchronous this stops us from writing to a deleted file
			return fmt.Errorf("file not found in db")
		}
		if fileEntry.Dirty.Load() {
			query := `UPDATE db_block_file SET size = ?, createdts = ?, modts = ?, opts = ?, meta = ? WHERE blockid = ? AND name = ?`
			tx.Exec(query, fileEntry.File.Size, fileEntry.File.CreatedTs, fileEntry.File.ModTs, dbutil.QuickJson(fileEntry.File.Opts), dbutil.QuickJson(fileEntry.File.Meta), fileEntry.File.BlockId, fileEntry.File.Name)
		}
		dataPartQuery := `REPLACE INTO db_block_data (blockid, name, partidx, data) VALUES (?, ?, ?, ?)`
		for _, dataEntry := range dataEntries {
			if dataEntry == nil || !dataEntry.Dirty.Load() {
				continue
			}
			tx.Exec(dataPartQuery, fileEntry.File.BlockId, fileEntry.File.Name, dataEntry.PartIdx, dataEntry.Data)
		}
		if tx.Err == nil {
			// clear dirty flags
			fileEntry.Dirty.Store(false)
			for _, dataEntry := range dataEntries {
				if dataEntry != nil {
					dataEntry.Dirty.Store(false)
					dataEntry.Flushing.Store(false)
				}
			}
		}
		return nil
	})
}
