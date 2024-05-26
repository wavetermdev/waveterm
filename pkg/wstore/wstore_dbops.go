// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"

	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

func waveObjTableName(w waveobj.WaveObj) string {
	return "db_" + w.GetOType()
}

func tableNameGen[T waveobj.WaveObj]() string {
	var zeroObj T
	return "db_" + zeroObj.GetOType()
}

func DBGetCount[T waveobj.WaveObj](ctx context.Context) (int, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (int, error) {
		table := tableNameGen[T]()
		query := fmt.Sprintf("SELECT count(*) FROM %s", table)
		return tx.GetInt(query), nil
	})
}

type idDataType struct {
	OId     string
	Version int
	Data    []byte
}

func DBGetSingleton[T waveobj.WaveObj](ctx context.Context) (T, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (T, error) {
		table := tableNameGen[T]()
		query := fmt.Sprintf("SELECT oid, version, data FROM %s LIMIT 1", table)
		var row idDataType
		tx.Get(&row, query)
		rtn, err := waveobj.FromJsonGen[T](row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func DBGet[T waveobj.WaveObj](ctx context.Context, id string) (T, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (T, error) {
		table := tableNameGen[T]()
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid = ?", table)
		var row idDataType
		tx.Get(&row, query, id)
		rtn, err := waveobj.FromJsonGen[T](row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func DBSelectMap[T waveobj.WaveObj](ctx context.Context, ids []string) (map[string]T, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (map[string]T, error) {
		table := tableNameGen[T]()
		var rows []idDataType
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid IN (SELECT value FROM json_each(?))", table)
		tx.Select(&rows, query, ids)
		rtnMap := make(map[string]T)
		for _, row := range rows {
			if row.OId == "" || len(row.Data) == 0 {
				continue
			}
			waveObj, err := waveobj.FromJsonGen[T](row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(waveObj, row.Version)
			rtnMap[row.OId] = waveObj
		}
		return rtnMap, nil
	})
}

func DBDelete[T waveobj.WaveObj](ctx context.Context, id string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		table := tableNameGen[T]()
		query := fmt.Sprintf("DELETE FROM %s WHERE oid = ?", table)
		tx.Exec(query, id)
		return nil
	})
}

func DBUpdate(ctx context.Context, val waveobj.WaveObj) error {
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot update %T value with empty id", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := waveObjTableName(val)
		query := fmt.Sprintf("UPDATE %s SET data = ?, version = version+1 WHERE oid = ?", table)
		tx.Exec(query, jsonData, oid)
		return nil
	})
}

func DBInsert[T waveobj.WaveObj](ctx context.Context, val T) error {
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot insert %T value with empty id", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := waveObjTableName(val)
		query := fmt.Sprintf("INSERT INTO %s (oid, version, data) VALUES (?, ?, ?)", table)
		tx.Exec(query, oid, 1, jsonData)
		return nil
	})
}
