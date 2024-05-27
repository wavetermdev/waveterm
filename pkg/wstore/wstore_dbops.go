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

func tableNameFromOType(otype string) string {
	return "db_" + otype
}

func tableNameGen[T waveobj.WaveObj]() string {
	var zeroObj T
	return tableNameFromOType(zeroObj.GetOType())
}

func getOTypeGen[T waveobj.WaveObj]() string {
	var zeroObj T
	return zeroObj.GetOType()
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

func genericCastWithErr[T any](v any, err error) (T, error) {
	if err != nil {
		var zeroVal T
		return zeroVal, err
	}
	return v.(T), err
}

func DBGetSingleton[T waveobj.WaveObj](ctx context.Context) (T, error) {
	rtn, err := DBGetSingletonByType(ctx, getOTypeGen[T]())
	return genericCastWithErr[T](rtn, err)
}

func DBGetSingletonByType(ctx context.Context, otype string) (waveobj.WaveObj, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (waveobj.WaveObj, error) {
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s LIMIT 1", table)
		var row idDataType
		tx.Get(&row, query)
		rtn, err := waveobj.FromJson(row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func DBGet[T waveobj.WaveObj](ctx context.Context, id string) (T, error) {
	rtn, err := DBGetORef(ctx, waveobj.ORef{OType: getOTypeGen[T](), OID: id})
	return genericCastWithErr[T](rtn, err)
}

func DBGetORef(ctx context.Context, oref waveobj.ORef) (waveobj.WaveObj, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (waveobj.WaveObj, error) {
		table := tableNameFromOType(oref.OType)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid = ?", table)
		var row idDataType
		tx.Get(&row, query, oref.OID)
		rtn, err := waveobj.FromJson(row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func dbSelectOIDs(ctx context.Context, otype string, oids []string) ([]waveobj.WaveObj, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]waveobj.WaveObj, error) {
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid IN (SELECT value FROM json_each(?))", table)
		var rows []idDataType
		tx.Select(&rows, query, oids)
		rtn := make([]waveobj.WaveObj, 0, len(rows))
		for _, row := range rows {
			waveObj, err := waveobj.FromJson(row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(waveObj, row.Version)
			rtn = append(rtn, waveObj)
		}
		return rtn, nil
	})
}

func DBSelectORefs(ctx context.Context, orefs []waveobj.ORef) ([]waveobj.WaveObj, error) {
	oidsByType := make(map[string][]string)
	for _, oref := range orefs {
		oidsByType[oref.OType] = append(oidsByType[oref.OType], oref.OID)
	}
	return WithTxRtn(ctx, func(tx *TxWrap) ([]waveobj.WaveObj, error) {
		rtn := make([]waveobj.WaveObj, 0, len(orefs))
		for otype, oids := range oidsByType {
			rtnArr, err := dbSelectOIDs(tx.Context(), otype, oids)
			if err != nil {
				return nil, err
			}
			rtn = append(rtn, rtnArr...)
		}
		return rtn, nil
	})
}

func DBSelectMap[T waveobj.WaveObj](ctx context.Context, ids []string) (map[string]T, error) {
	rtnArr, err := dbSelectOIDs(ctx, getOTypeGen[T](), ids)
	if err != nil {
		return nil, err
	}
	rtnMap := make(map[string]T)
	for _, obj := range rtnArr {
		rtnMap[waveobj.GetOID(obj)] = obj.(T)
	}
	return rtnMap, nil
}

func DBDelete(ctx context.Context, otype string, id string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		table := tableNameFromOType(otype)
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

func DBInsert(ctx context.Context, val waveobj.WaveObj) error {
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
