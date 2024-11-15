// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"time"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/util/dbutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var ErrNotFound = fmt.Errorf("not found")

var SingletonOTypes = map[string]bool{
	"client": true,
}

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
	if SingletonOTypes[getOTypeGen[T]()] {
		return 0, fmt.Errorf("cannot get count of singleton %q with DBGetCount", getOTypeGen[T]())
	}
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
	if v == nil {
		var zeroVal T
		return zeroVal, nil
	}
	return v.(T), err
}

func DBGetSingleton[T waveobj.WaveObj](ctx context.Context) (T, error) {
	rtn, err := DBGetSingletonByType(ctx, getOTypeGen[T]())
	return genericCastWithErr[T](rtn, err)
}

func DBGetSingletonByType(ctx context.Context, otype string) (waveobj.WaveObj, error) {
	if !SingletonOTypes[otype] {
		return nil, fmt.Errorf("cannot get non-singleton %q with DBGetSingletonByType", otype)
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (waveobj.WaveObj, error) {
		query := `SELECT oid, version, data FROM db_singleton WHERE otype = $1`
		var row idDataType
		found := tx.Get(&row, query, otype)
		if !found {
			return nil, ErrNotFound
		}
		rtn, err := waveobj.FromJson(row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func DBExistsSingletonByType(ctx context.Context, otype string) (bool, error) {
	if !SingletonOTypes[otype] {
		return false, fmt.Errorf("cannot check existence of non-singleton %q with DBExistsSingletonByType", otype)
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (bool, error) {
		query := `SELECT oid FROM db_singleton WHERE otype = $1`
		return tx.Exists(query, otype), nil
	})
}

func DBExistsORef(ctx context.Context, oref waveobj.ORef) (bool, error) {
	if SingletonOTypes[oref.OType] {
		return DBExistsSingletonByType(ctx, oref.OType)
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (bool, error) {
		table := tableNameFromOType(oref.OType)
		query := fmt.Sprintf("SELECT oid FROM %s WHERE oid = ?", table)
		return tx.Exists(query, oref.OID), nil
	})
}

func DBGet[T waveobj.WaveObj](ctx context.Context, id string) (T, error) {
	rtn, err := DBGetORef(ctx, waveobj.ORef{OType: getOTypeGen[T](), OID: id})
	return genericCastWithErr[T](rtn, err)
}

func DBMustGet[T waveobj.WaveObj](ctx context.Context, id string) (T, error) {
	rtn, err := DBGetORef(ctx, waveobj.ORef{OType: getOTypeGen[T](), OID: id})
	if err != nil {
		var zeroVal T
		return zeroVal, err
	}
	if rtn == nil {
		var zeroVal T
		return zeroVal, ErrNotFound
	}
	return rtn.(T), nil
}

func DBGetORef(ctx context.Context, oref waveobj.ORef) (waveobj.WaveObj, error) {
	if SingletonOTypes[oref.OType] {
		return DBGetSingletonByType(ctx, oref.OType)
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (waveobj.WaveObj, error) {
		table := tableNameFromOType(oref.OType)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid = ?", table)
		var row idDataType
		found := tx.Get(&row, query, oref.OID)
		if !found {
			return nil, nil
		}
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
		if SingletonOTypes[otype] {
			return nil, fmt.Errorf("cannot select singleton %q with DBSelectOIDs", otype)
		}
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid IN (SELECT value FROM json_each(?))", table)
		var rows []idDataType
		tx.Select(&rows, query, dbutil.QuickJson(oids))
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

func DBResolveEasyOID(ctx context.Context, oid string) (*waveobj.ORef, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*waveobj.ORef, error) {
		for _, rtype := range waveobj.AllWaveObjTypes() {
			otype := reflect.Zero(rtype).Interface().(waveobj.WaveObj).GetOType()
			if SingletonOTypes[otype] {
				continue
			}
			table := tableNameFromOType(otype)
			var fullOID string
			if len(oid) == 8 {
				query := fmt.Sprintf("SELECT oid FROM %s WHERE oid LIKE ?", table)
				fullOID = tx.GetString(query, oid+"%")
			} else {
				query := fmt.Sprintf("SELECT oid FROM %s WHERE oid = ?", table)
				fullOID = tx.GetString(query, oid)
			}
			if fullOID != "" {
				oref := waveobj.MakeORef(otype, fullOID)
				return &oref, nil
			}
		}
		// try singletons
		query := `SELECT otype FROM db_singleton WHERE oid = ?`
		otype := tx.GetString(query, oid)
		if otype != "" {
			oref := waveobj.MakeORef(otype, oid)
			return &oref, nil
		}
		return nil, ErrNotFound
	})
}

func DBSelectMap[T waveobj.WaveObj](ctx context.Context, ids []string) (map[string]T, error) {
	otype := getOTypeGen[T]()
	if SingletonOTypes[otype] {
		return nil, fmt.Errorf("cannot select singleton %q with DBSelectMap", otype)
	}
	rtnArr, err := dbSelectOIDs(ctx, otype, ids)
	if err != nil {
		return nil, err
	}
	rtnMap := make(map[string]T)
	for _, obj := range rtnArr {
		rtnMap[waveobj.GetOID(obj)] = obj.(T)
	}
	return rtnMap, nil
}

func dbDeleteSingleton(ctx context.Context, otype string, oid string) error {
	if !SingletonOTypes[otype] {
		return fmt.Errorf("cannot delete non-singleton %q with DBDeleteSingleton", otype)
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "DELETE FROM db_singleton WHERE otype = ? AND oid = ?"
		tx.Exec(query, otype, oid)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Delete, OType: otype, OID: oid})
		return nil
	})
}

func DBDelete(ctx context.Context, otype string, id string) error {
	if SingletonOTypes[otype] {
		return dbDeleteSingleton(ctx, otype, id)
	}
	err := WithTx(ctx, func(tx *TxWrap) error {
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("DELETE FROM %s WHERE oid = ?", table)
		tx.Exec(query, id)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Delete, OType: otype, OID: id})
		return nil
	})
	if err != nil {
		return err
	}
	go func() {
		// we spawn a go routine here because we don't want to reuse the DB connection
		// since DBDelete is called in a transaction from DeleteTab
		deleteCtx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelFn()
		err := filestore.WFS.DeleteZone(deleteCtx, id)
		if err != nil {
			log.Printf("error deleting filestore zone (after deleting block): %v", err)
		}
	}()
	return nil
}

func dbUpdateSingleton(ctx context.Context, val waveobj.WaveObj) error {
	otype := val.GetOType()
	if !SingletonOTypes[otype] {
		return fmt.Errorf("cannot update non-singleton %q with DBUpdateSingleton", otype)
	}
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot update %T value with empty id", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		query := "UPDATE db_singleton SET version = version+1, data = ? WHERE otype = ? RETURNING version"
		newVersion := tx.GetInt(query, jsonData, otype)
		waveobj.SetVersion(val, newVersion)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: otype, OID: oid, Obj: val})
		return nil
	})
}

func DBUpdate(ctx context.Context, val waveobj.WaveObj) error {
	otype := val.GetOType()
	if SingletonOTypes[otype] {
		return dbUpdateSingleton(ctx, val)
	}
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
		query := fmt.Sprintf("UPDATE %s SET data = ?, version = version+1 WHERE oid = ? RETURNING version", table)
		newVersion := tx.GetInt(query, jsonData, oid)
		waveobj.SetVersion(val, newVersion)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: val.GetOType(), OID: oid, Obj: val})
		return nil
	})
}

func dbInsertSingleton(ctx context.Context, val waveobj.WaveObj) error {
	if !SingletonOTypes[val.GetOType()] {
		return fmt.Errorf("cannot insert non-singleton %q with DBInsertSingleton", val.GetOType())
	}
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot insert %T value with empty id", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		// will fail from primary key constraint if we add a 2nd singleton of the same type
		query := "INSERT INTO db_singleton (otype, oid, version, data) VALUES (?, ?, ?, ?)"
		tx.Exec(query, val.GetOType(), oid, 1, jsonData)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: val.GetOType(), OID: oid, Obj: val})
		return nil
	})
}

func DBInsert(ctx context.Context, val waveobj.WaveObj) error {
	otype := val.GetOType()
	if SingletonOTypes[otype] {
		return dbInsertSingleton(ctx, val)
	}
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
		waveobj.SetVersion(val, 1)
		query := fmt.Sprintf("INSERT INTO %s (oid, version, data) VALUES (?, ?, ?)", table)
		tx.Exec(query, oid, 1, jsonData)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: val.GetOType(), OID: oid, Obj: val})
		return nil
	})
}

func DBFindWindowForTabId(ctx context.Context, tabId string) (string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (string, error) {
		query := "SELECT oid FROM db_window WHERE data->>'activetabid' = ?"
		return tx.GetString(query, tabId), nil
	})
}

func DBFindTabForBlockId(ctx context.Context, blockId string) (string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (string, error) {
		iterNum := 1
		for {
			if iterNum > 5 {
				return "", fmt.Errorf("too many iterations looking for tab in block parents")
			}
			query := `
			SELECT json_extract(b.data, '$.parentoref') AS parentoref
			FROM db_block b
			WHERE b.oid = ?;`
			parentORef := tx.GetString(query, blockId)
			oref, err := waveobj.ParseORef(parentORef)
			if err != nil {
				return "", fmt.Errorf("bad block parent oref: %v", err)
			}
			if oref.OType == "tab" {
				return oref.OID, nil
			}
			if oref.OType == "block" {
				blockId = oref.OID
				iterNum++
				continue
			}
			return "", fmt.Errorf("bad parent oref type: %v", oref.OType)
		}
	})
}

func DBFindWorkspaceForTabId(ctx context.Context, tabId string) (string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (string, error) {
		query := `
			SELECT w.oid
			FROM db_workspace w, json_each(data->'tabids') je
			WHERE je.value = ?`
		return tx.GetString(query, tabId), nil
	})
}
