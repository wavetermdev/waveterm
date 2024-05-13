package blockstore

// setup for blockstore db
// includes migration support and txwrap setup

import (
	"context"
	"fmt"
	"log"
	"path"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"

	"github.com/golang-migrate/migrate/v4"
	sqlite3migrate "github.com/golang-migrate/migrate/v4/database/sqlite3"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/sawka/txwrap"

	dbfs "github.com/wavetermdev/thenextwave/db"
)

const BlockstoreDbName = "blockstore.db"

type TxWrap = txwrap.TxWrap

var globalDB *sqlx.DB
var useTestingDb bool // just for testing (forces GetDB() to return an in-memory db)

func InitBlockstore() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	var err error
	globalDB, err = MakeDB(ctx)
	if err != nil {
		return err
	}
	err = MigrateBlockstore()
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

func MakeDB(ctx context.Context) (*sqlx.DB, error) {
	var rtn *sqlx.DB
	var err error
	if useTestingDb {
		dbName := ":memory:"
		log.Printf("[db] using in-memory db\n")
		rtn, err = sqlx.Open("sqlite3", dbName)
	} else {
		dbName := GetDBName()
		log.Printf("[db] opening db %s\n", dbName)
		rtn, err = sqlx.Open("sqlite3", fmt.Sprintf("file:%s?cache=shared&mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
	}
	if err != nil {
		return nil, fmt.Errorf("opening db: %w", err)
	}
	rtn.DB.SetMaxOpenConns(1)
	return rtn, nil
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) error {
	return txwrap.WithTx(ctx, globalDB, fn)
}

func WithTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (RT, error) {
	return txwrap.WithTxRtn(ctx, globalDB, fn)
}

func MakeBlockstoreMigrate() (*migrate.Migrate, error) {
	fsVar, err := iofs.New(dbfs.BlockstoreMigrationFS, "migrations-blockstore")
	if err != nil {
		return nil, fmt.Errorf("opening iofs: %w", err)
	}
	mdriver, err := sqlite3migrate.WithInstance(globalDB.DB, &sqlite3migrate.Config{})
	if err != nil {
		return nil, fmt.Errorf("making blockstore migration driver: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", fsVar, "sqlite3", mdriver)
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
