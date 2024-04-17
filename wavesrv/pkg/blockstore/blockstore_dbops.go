package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"sync"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/sawka/txwrap"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
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

func (f *FileInfo) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	log.Printf("fileInfo ToMap is unimplemented!")
	return rtn
}

func (fInfo *FileInfo) FromMap(m map[string]interface{}) bool {
	fileOpts := FileOptsType{}
	dbutil.QuickSetBool(&fileOpts.Circular, m, "circular")
	dbutil.QuickSetInt64(&fileOpts.MaxSize, m, "maxsize")

	var metaJson []byte
	dbutil.QuickSetBytes(&metaJson, m, "meta")
	var fileMeta FileMeta
	err := json.Unmarshal(metaJson, &fileMeta)
	if err != nil {
		return false
	}
	dbutil.QuickSetStr(&fInfo.BlockId, m, "blockid")
	dbutil.QuickSetStr(&fInfo.Name, m, "name")
	dbutil.QuickSetInt64(&fInfo.Size, m, "size")
	dbutil.QuickSetInt64(&fInfo.CreatedTs, m, "createdts")
	dbutil.QuickSetInt64(&fInfo.ModTs, m, "modts")
	fInfo.Opts = fileOpts
	fInfo.Meta = fileMeta
	return true
}

func GetFileInfo(ctx context.Context, blockId string, name string) (*FileInfo, error) {
	fInfoArr, txErr := WithTxRtn(ctx, func(tx *TxWrap) ([]*FileInfo, error) {
		var rtn []*FileInfo
		query := `SELECT * FROM block_file WHERE name = 'file-1'`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*FileInfo](m))
		}
		return rtn, nil
	})
	if txErr != nil {
		return nil, fmt.Errorf("GetFileInfo database error: %v", txErr)
	}
	if len(fInfoArr) > 1 {
		return nil, fmt.Errorf("GetFileInfo duplicate files in database")
	}
	if len(fInfoArr) == 0 {
		return nil, fmt.Errorf("GetFileInfo: File not found")
	}
	fInfo := fInfoArr[0]
	return fInfo, nil
}

func GetCacheFromDB(ctx context.Context, blockId string, name string, off int64, length int64, cacheNum int64) (*[]byte, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*[]byte, error) {
		var cacheData *[]byte
		query := `SELECT substr(data,?,?) FROM block_data WHERE blockid = ? AND name = ? and partidx = ?`
		tx.Get(&cacheData, query, off, length+1, blockId, name, cacheNum)
		if cacheData == nil {
			cacheData = &[]byte{}
		}
		return cacheData, nil
	})
}
