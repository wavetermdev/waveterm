package sstore

import (
	"context"
	"database/sql"

	"github.com/jmoiron/sqlx"
)

type TxWrap struct {
	Txx *sqlx.Tx
	Err error
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) (rtnErr error) {
	db, err := GetDB()
	if err != nil {
		return err
	}
	tx, beginErr := db.BeginTxx(ctx, nil)
	if beginErr != nil {
		return beginErr
	}
	txWrap := &TxWrap{Txx: tx}
	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		}
		if rtnErr != nil {
			tx.Rollback()
		} else {
			rtnErr = tx.Commit()
		}
	}()
	fnErr := fn(txWrap)
	if fnErr != nil {
		return fnErr
	}
	if txWrap.Err != nil {
		return txWrap.Err
	}
	return nil
}

func (tx *TxWrap) NamedExecWrap(query string, arg interface{}) sql.Result {
	if tx.Err != nil {
		return nil
	}
	result, err := tx.Txx.NamedExec(query, arg)
	if err != nil {
		tx.Err = err
	}
	return result
}

func (tx *TxWrap) ExecWrap(query string, args ...interface{}) sql.Result {
	if tx.Err != nil {
		return nil
	}
	result, err := tx.Txx.Exec(query, args...)
	if err != nil {
		tx.Err = err
	}
	return result
}

func (tx *TxWrap) GetWrap(dest interface{}, query string, args ...interface{}) bool {
	if tx.Err != nil {
		return false
	}
	err := tx.Txx.Get(dest, query, args...)
	if err != nil && err == sql.ErrNoRows {
		return false
	}
	if err != nil {
		tx.Err = err
		return false
	}
	return true
}

func (tx *TxWrap) SelectWrap(dest interface{}, query string, args ...interface{}) {
	if tx.Err != nil {
		return
	}
	err := tx.Txx.Select(dest, query, args...)
	if err != nil {
		tx.Err = err
	}
	return
}

func (tx *TxWrap) SelectMaps(query string, args ...interface{}) []map[string]interface{} {
	if tx.Err != nil {
		return nil
	}
	rows, err := tx.Txx.Queryx(query, args...)
	if err != nil {
		tx.Err = err
		return nil
	}
	var rtn []map[string]interface{}
	for rows.Next() {
		m := make(map[string]interface{})
		err = rows.MapScan(m)
		if err != nil {
			tx.Err = err
			return nil
		}
		rtn = append(rtn, m)
	}
	return rtn
}

func (tx *TxWrap) GetMap(query string, args ...interface{}) map[string]interface{} {
	if tx.Err != nil {
		return nil
	}
	row := tx.Txx.QueryRowx(query, args...)
	m := make(map[string]interface{})
	err := row.MapScan(m)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		tx.Err = err
		return nil
	}
	return m
}
