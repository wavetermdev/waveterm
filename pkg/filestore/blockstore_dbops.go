// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

import (
	"context"
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
)

var ErrAlreadyExists = fmt.Errorf("file already exists")

func dbInsertFile(ctx context.Context, file *WaveFile) error {
	// will fail if file already exists
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "SELECT zoneid FROM db_wave_file WHERE zoneid = ? AND name = ?"
		if tx.Exists(query, file.ZoneId, file.Name) {
			return ErrAlreadyExists
		}
		query = "INSERT INTO db_wave_file (zoneid, name, size, createdts, modts, opts, meta) VALUES (?, ?, ?, ?, ?, ?, ?)"
		tx.Exec(query, file.ZoneId, file.Name, file.Size, file.CreatedTs, file.ModTs, dbutil.QuickJson(file.Opts), dbutil.QuickJson(file.Meta))
		return nil
	})
}

func dbDeleteFile(ctx context.Context, zoneId string, name string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "DELETE FROM db_wave_file WHERE zoneid = ? AND name = ?"
		tx.Exec(query, zoneId, name)
		query = "DELETE FROM db_file_data WHERE zoneid = ? AND name = ?"
		tx.Exec(query, zoneId, name)
		return nil
	})
}

func dbGetZoneFileNames(ctx context.Context, zoneId string) ([]string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]string, error) {
		var files []string
		query := "SELECT name FROM db_wave_file WHERE zoneid = ?"
		tx.Select(&files, query, zoneId)
		return files, nil
	})
}

func dbGetZoneFile(ctx context.Context, zoneId string, name string) (*WaveFile, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*WaveFile, error) {
		query := "SELECT * FROM db_wave_file WHERE zoneid = ? AND name = ?"
		file := dbutil.GetMappable[*WaveFile](tx, query, zoneId, name)
		return file, nil
	})
}

func dbGetAllZoneIds(ctx context.Context) ([]string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]string, error) {
		var ids []string
		query := "SELECT DISTINCT zoneid FROM db_wave_file"
		tx.Select(&ids, query)
		return ids, nil
	})
}

func dbGetFileParts(ctx context.Context, zoneId string, name string, parts []int) (map[int]*DataCacheEntry, error) {
	if len(parts) == 0 {
		return nil, nil
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (map[int]*DataCacheEntry, error) {
		var data []*DataCacheEntry
		query := "SELECT partidx, data FROM db_file_data WHERE zoneid = ? AND name = ? AND partidx IN (SELECT value FROM json_each(?))"
		tx.Select(&data, query, zoneId, name, dbutil.QuickJsonArr(parts))
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

func dbGetZoneFiles(ctx context.Context, zoneId string) ([]*WaveFile, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]*WaveFile, error) {
		query := "SELECT * FROM db_wave_file WHERE zoneid = ?"
		files := dbutil.SelectMappable[*WaveFile](tx, query, zoneId)
		return files, nil
	})
}

func dbWriteCacheEntry(ctx context.Context, file *WaveFile, dataEntries map[int]*DataCacheEntry, replace bool) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT zoneid FROM db_wave_file WHERE zoneid = ? AND name = ?`
		if !tx.Exists(query, file.ZoneId, file.Name) {
			// since deletion is synchronous this stops us from writing to a deleted file
			return os.ErrNotExist
		}
		// we don't update CreatedTs or Opts
		query = `UPDATE db_wave_file SET size = ?, modts = ?, meta = ? WHERE zoneid = ? AND name = ?`
		tx.Exec(query, file.Size, file.ModTs, dbutil.QuickJson(file.Meta), file.ZoneId, file.Name)
		if replace {
			query = `DELETE FROM db_file_data WHERE zoneid = ? AND name = ?`
			tx.Exec(query, file.ZoneId, file.Name)
		}
		dataPartQuery := `REPLACE INTO db_file_data (zoneid, name, partidx, data) VALUES (?, ?, ?, ?)`
		for partIdx, dataEntry := range dataEntries {
			if partIdx != dataEntry.PartIdx {
				panic(fmt.Sprintf("partIdx:%d and dataEntry.PartIdx:%d do not match", partIdx, dataEntry.PartIdx))
			}
			tx.Exec(dataPartQuery, file.ZoneId, file.Name, dataEntry.PartIdx, dataEntry.Data)
		}
		return nil
	})
}
