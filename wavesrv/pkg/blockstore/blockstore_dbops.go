package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"sync"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/sawka/txwrap"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"

	dbfs "github.com/wavetermdev/waveterm/wavesrv/db"
)

const DBFileName = "blockstore.db"

type SingleConnDBGetter struct {
	SingleConnLock *sync.Mutex
}

var dbWrap *SingleConnDBGetter = &SingleConnDBGetter{SingleConnLock: &sync.Mutex{}}

type TxWrap = txwrap.TxWrap

func MakeBlockstoreMigrate() (*migrate.Migrate, error) {
	fsVar, err := iofs.New(dbfs.BlockstoreMigrationFS, "blockstore-migrations")
	if err != nil {
		return nil, fmt.Errorf("opening iofs: %w", err)
	}
	dbUrl := fmt.Sprintf("sqlite3://%s", GetDBName())
	m, err := migrate.NewWithSourceInstance("iofs", fsVar, dbUrl)
	if err != nil {
		return nil, fmt.Errorf("making blockstore migration db[%s]: %w", GetDBName(), err)
	}
	return m, nil
}

func MigrateBlockstore() error {
	log.Printf("migrate blockstore\n")
	m, err := MakeBlockstoreMigrate()
	if err != nil {
		return err
	}
	curVersion, dirty, err := GetMigrateVersion(m)
	if dirty {
		return fmt.Errorf("cannot migrate up, database is dirty")
	}
	if err != nil {
		return fmt.Errorf("cannot get current migration version: %v", err)
	}
	defer m.Close()
	err = m.Up()
	if err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrating blockstore: %w", err)
	}
	newVersion, _, err := GetMigrateVersion(m)
	if err != nil {
		return fmt.Errorf("cannot get new migration version: %v", err)
	}
	if newVersion != curVersion {
		log.Printf("[db] blockstore migration done, version %d -> %d\n", curVersion, newVersion)
	}
	return nil
}

func GetMigrateVersion(m *migrate.Migrate) (uint, bool, error) {
	if m == nil {
		var err error
		m, err = MakeBlockstoreMigrate()
		if err != nil {
			return 0, false, err
		}
	}
	curVersion, dirty, err := m.Version()
	if err == migrate.ErrNilVersion {
		return 0, false, nil
	}
	return curVersion, dirty, err
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
var overrideDBName string

func GetDBName() string {
	if overrideDBName != "" {
		return overrideDBName
	}
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

func DeleteFileFromDB(ctx context.Context, blockId string, name string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_file where blockid = ? AND name = ?`
		tx.Exec(query, blockId, name)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_data where blockid = ? AND name = ?`
		tx.Exec(query, blockId, name)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func DeleteBlockFromDB(ctx context.Context, blockId string) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_file where blockid = ?`
		tx.Exec(query, blockId)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_data where blockid = ?`
		tx.Exec(query, blockId)
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func GetAllFilesInDBForBlockId(ctx context.Context, blockId string) ([]*FileInfo, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]*FileInfo, error) {
		var rtn []*FileInfo
		query := `SELECT * FROM block_file where blockid = ?`
		marr := tx.SelectMaps(query, blockId)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*FileInfo](m))
		}
		return rtn, nil
	})
}

func GetAllFilesInDB(ctx context.Context) ([]*FileInfo, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]*FileInfo, error) {
		var rtn []*FileInfo
		query := `SELECT * FROM block_file`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*FileInfo](m))
		}
		return rtn, nil
	})
}

func GetAllBlockIdsInDB(ctx context.Context) ([]string, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) ([]string, error) {
		var rtn []string
		query := `SELECT DISTINCT blockid FROM block_file`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			var blockId string
			dbutil.QuickSetStr(&blockId, m, "blockid")
			rtn = append(rtn, blockId)
		}
		return rtn, nil
	})
}
