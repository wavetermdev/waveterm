package blockstore

import (
	"context"
	"fmt"
	"log"
	"path"
	"sync"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/sawka/txwrap"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
)

const DBFileName = "blockstore.db"

type SingleConnDBGetter struct {
	SingleConnLock *sync.Mutex
}

var dbWrap *SingleConnDBGetter

type TxWrap = txwrap.TxWrap

func InitDBState() {
	dbWrap = &SingleConnDBGetter{SingleConnLock: &sync.Mutex{}}
}

func (dbg *SingleConnDBGetter) GetDB(ctx context.Context) (*sqlx.DB, error) {
	db, err := GetDB(ctx)
	if err != nil {
		return nil, err
	}
	dbg.SingleConnLock.Lock()
	return db, nil
}

func (dbg *SingleConnDBGetter) ReleaseDB(db *sqlx.DB) {
	dbg.SingleConnLock.Unlock()
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) error {
	return txwrap.DBGWithTx(ctx, dbWrap, fn)
}

func WithTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (RT, error) {
	var rtn RT
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		temp, err := fn(tx)
		if err != nil {
			return err
		}
		rtn = temp
		return nil
	})
	return rtn, txErr
}

var globalDBLock = &sync.Mutex{}
var globalDB *sqlx.DB
var globalDBErr error

func GetDBName() string {
	scHome := scbase.GetWaveHomeDir()
	return path.Join(scHome, DBFileName)
}

func GetDB(ctx context.Context) (*sqlx.DB, error) {
	if txwrap.IsTxWrapContext(ctx) {
		return nil, fmt.Errorf("cannot call GetDB from within a running transaction")
	}
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil && globalDBErr == nil {
		dbName := GetDBName()
		globalDB, globalDBErr = sqlx.Open("sqlite3", fmt.Sprintf("file:%s?cache=shared&mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
		if globalDBErr != nil {
			globalDBErr = fmt.Errorf("opening db[%s]: %w", dbName, globalDBErr)
			log.Printf("[db] error: %v\n", globalDBErr)
		} else {
			log.Printf("[db] successfully opened db %s\n", dbName)
		}
	}
	return globalDB, globalDBErr
}

func CloseDB() {
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil {
		return
	}
	err := globalDB.Close()
	if err != nil {
		log.Printf("[db] error closing database: %v\n", err)
	}
	globalDB = nil
}
