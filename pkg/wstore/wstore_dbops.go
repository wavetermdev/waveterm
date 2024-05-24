// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"reflect"
)

const Table_Client = "db_client"
const Table_Workspace = "db_workspace"
const Table_Tab = "db_tab"
const Table_Block = "db_block"
const Table_Window = "db_window"

// can replace with struct tags in the future
type ObjectWithId interface {
	GetId() string
}

// can replace these with struct tags in the future
var idColumnName = map[string]string{
	Table_Client:    "clientid",
	Table_Workspace: "workspaceid",
	Table_Tab:       "tabid",
	Table_Block:     "blockid",
	Table_Window:    "windowid",
}

var tableToType = map[string]reflect.Type{
	Table_Client:    reflect.TypeOf(Client{}),
	Table_Workspace: reflect.TypeOf(Workspace{}),
	Table_Tab:       reflect.TypeOf(Tab{}),
	Table_Block:     reflect.TypeOf(Block{}),
	Table_Window:    reflect.TypeOf(Window{}),
}

var typeToTable map[reflect.Type]string

func init() {
	typeToTable = make(map[reflect.Type]string)
	for k, v := range tableToType {
		typeToTable[v] = k
	}
}

func DBGetCount[T ObjectWithId](ctx context.Context) (int, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (int, error) {
		var valInstance T
		table := typeToTable[reflect.TypeOf(valInstance)]
		if table == "" {
			return 0, fmt.Errorf("unknown table type: %T", valInstance)
		}
		query := fmt.Sprintf("SELECT count(*) FROM %s", table)
		return tx.GetInt(query), nil
	})
}

func DBGetSingleton[T ObjectWithId](ctx context.Context) (*T, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*T, error) {
		var rtn T
		query := fmt.Sprintf("SELECT data FROM %s LIMIT 1", typeToTable[reflect.TypeOf(rtn)])
		jsonData := tx.GetString(query)
		return TxReadJson[T](tx, jsonData), nil
	})
}

func DBGet[T ObjectWithId](ctx context.Context, id string) (*T, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*T, error) {
		var rtn T
		table := typeToTable[reflect.TypeOf(rtn)]
		if table == "" {
			return nil, fmt.Errorf("unknown table type: %T", rtn)
		}
		query := fmt.Sprintf("SELECT data FROM %s WHERE %s = ?", table, idColumnName[table])
		jsonData := tx.GetString(query, id)
		return TxReadJson[T](tx, jsonData), nil
	})
}

type idDataType struct {
	Id   string
	Data string
}

func DBSelectMap[T ObjectWithId](ctx context.Context, ids []string) (map[string]*T, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (map[string]*T, error) {
		var valInstance T
		table := typeToTable[reflect.TypeOf(valInstance)]
		if table == "" {
			return nil, fmt.Errorf("unknown table type: %T", &valInstance)
		}
		var rows []idDataType
		query := fmt.Sprintf("SELECT %s, data FROM %s WHERE %s IN (SELECT value FROM json_each(?))", idColumnName[table], table, idColumnName[table])
		tx.Select(&rows, query, ids)
		rtnMap := make(map[string]*T)
		for _, row := range rows {
			if row.Id == "" || row.Data == "" {
				continue
			}
			r := TxReadJson[T](tx, row.Data)
			if r == nil {
				continue
			}
			rtnMap[(*r).GetId()] = r
		}
		return rtnMap, nil
	})
}

func DBDelete[T ObjectWithId](ctx context.Context, id string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		var rtn T
		table := typeToTable[reflect.TypeOf(rtn)]
		if table == "" {
			return fmt.Errorf("unknown table type: %T", rtn)
		}
		query := fmt.Sprintf("DELETE FROM %s WHERE %s = ?", table, idColumnName[table])
		tx.Exec(query, id)
		return nil
	})
}

func DBUpdate[T ObjectWithId](ctx context.Context, val *T) error {
	if val == nil {
		return fmt.Errorf("cannot update nil value")
	}
	if (*val).GetId() == "" {
		return fmt.Errorf("cannot update %T value with empty id", val)
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := typeToTable[reflect.TypeOf(*val)]
		if table == "" {
			return fmt.Errorf("unknown table type: %T", *val)
		}
		query := fmt.Sprintf("UPDATE %s SET data = ? WHERE %s = ?", table, idColumnName[table])
		tx.Exec(query, TxJson(tx, val), (*val).GetId())
		return nil
	})
}

func DBInsert[T ObjectWithId](ctx context.Context, val *T) error {
	if val == nil {
		return fmt.Errorf("cannot insert nil value")
	}
	if (*val).GetId() == "" {
		return fmt.Errorf("cannot insert %T value with empty id", val)
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := typeToTable[reflect.TypeOf(*val)]
		if table == "" {
			return fmt.Errorf("unknown table type: %T", *val)
		}
		query := fmt.Sprintf("INSERT INTO %s (%s, data) VALUES (?, ?)", table, idColumnName[table])
		tx.Exec(query, (*val).GetId(), TxJson(tx, val))
		return nil
	})
}
