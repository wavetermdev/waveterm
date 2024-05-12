package blockstore

// setup for blockstore db
// includes migration support and txwrap setup

import (
	"context"
	"fmt"
	"log"
	"path"
	"sync"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/sawka/txwrap"

	dbfs "github.com/wavetermdev/thenextwave/db"
)

const BlockstoreDbName = "blockstore.db"

type SingleConnDBGetter struct {
	SingleConnLock *sync.Mutex
}

type TxWrap = txwrap.TxWrap

var dbWrap *SingleConnDBGetter = &SingleConnDBGetter{SingleConnLock: &sync.Mutex{}}
var globalDBLock = &sync.Mutex{}
var globalDB *sqlx.DB
var globalDBErr error

func InitBlockstore() error {
	err := MigrateBlockstore()
	if err != nil {
		return err
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	_, err = GetDB(ctx)
	if err != nil {
		return err
	}
	log.Printf("blockstore initialized\n")
	return nil
}

func GetDBName() string {
	scHome := wavebase.GetWaveHomeDir()
	return path.Join(scHome, BlockstoreDbName)
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

func MakeBlockstoreMigrate() (*migrate.Migrate, error) {
	fsVar, err := iofs.New(dbfs.BlockstoreMigrationFS, "migrations-blockstore")
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
