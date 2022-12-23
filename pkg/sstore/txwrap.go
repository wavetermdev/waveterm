package sstore

import (
	"context"
	"database/sql"
	"sync"

	"github.com/jmoiron/sqlx"
)

type TxWrap struct {
	Txx *sqlx.Tx
	Err error
	Ctx context.Context
}

type txWrapKey struct{}

// single-threaded access to DB
var globalNestingLock = &sync.Mutex{}

func IsTxWrapContext(ctx context.Context) bool {
	ctxVal := ctx.Value(txWrapKey{})
	return ctxVal != nil
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) (rtnErr error) {
	var txWrap *TxWrap
	ctxVal := ctx.Value(txWrapKey{})
	if ctxVal != nil {
		txWrap = ctxVal.(*TxWrap)
		if txWrap.Err != nil {
			return txWrap.Err
		}
	}
	if txWrap == nil {
		globalNestingLock.Lock()
		defer globalNestingLock.Unlock()

		db, err := GetDB(ctx)
		if err != nil {
			return err
		}
		tx, beginErr := db.BeginTxx(ctx, nil)
		if beginErr != nil {
			return beginErr
		}
		txWrap = &TxWrap{Txx: tx, Ctx: ctx}
		defer func() {
			if p := recover(); p != nil {
				txWrap.Txx.Rollback()
				panic(p)
			}
			if rtnErr != nil {
				txWrap.Txx.Rollback()
			} else {
				rtnErr = txWrap.Txx.Commit()
			}
		}()
	}
	fnErr := fn(txWrap)
	if txWrap.Err == nil && fnErr != nil {
		txWrap.Err = fnErr
	}
	if txWrap.Err != nil {
		return txWrap.Err
	}
	return nil
}

func (tx *TxWrap) Context() context.Context {
	return context.WithValue(tx.Ctx, txWrapKey{}, tx)
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

func (tx *TxWrap) Exists(query string, args ...interface{}) bool {
	var dest interface{}
	return tx.GetWrap(&dest, query, args...)
}

func (tx *TxWrap) GetString(query string, args ...interface{}) string {
	var rtnStr string
	tx.GetWrap(&rtnStr, query, args...)
	return rtnStr
}

func (tx *TxWrap) GetBool(query string, args ...interface{}) bool {
	var rtnBool bool
	tx.GetWrap(&rtnBool, query, args...)
	return rtnBool
}

func (tx *TxWrap) SelectStrings(query string, args ...interface{}) []string {
	var rtnArr []string
	tx.SelectWrap(&rtnArr, query, args...)
	return rtnArr
}

func (tx *TxWrap) GetInt(query string, args ...interface{}) int {
	var rtnInt int
	tx.GetWrap(&rtnInt, query, args...)
	return rtnInt
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
