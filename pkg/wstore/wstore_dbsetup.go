// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jmoiron/sqlx"
	"github.com/sawka/txwrap"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"

	sqlite3migrate "github.com/golang-migrate/migrate/v4/database/sqlite3"
	dbfs "github.com/wavetermdev/thenextwave/db"
)

const WStoreDBName = "waveterm.db"

type TxWrap = txwrap.TxWrap

var globalDB *sqlx.DB

func InitWStore() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	var err error
	globalDB, err = MakeDB(ctx)
	if err != nil {
		return err
	}
	err = MigrateWStore()
	if err != nil {
		return err
	}
	log.Printf("wstore initialized\n")
	return nil
}

func GetDBName() string {
	waveHome := wavebase.GetWaveHomeDir()
	return path.Join(waveHome, WStoreDBName)
}

func MakeDB(ctx context.Context) (*sqlx.DB, error) {
	dbName := GetDBName()
	rtn, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
	if err != nil {
		return nil, err
	}
	rtn.DB.SetMaxOpenConns(1)
	return rtn, nil
}

func MigrateWStore() error {
	return nil
}

func MakeWStoreMigrate() (*migrate.Migrate, error) {
	fsVar, err := iofs.New(dbfs.WStoreMigrationFS, "migrations-wstore")
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

func GetMigrateVersion(m *migrate.Migrate) (uint, bool, error) {
	if m == nil {
		var err error
		m, err = MakeWStoreMigrate()
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

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) error {
	return txwrap.WithTx(ctx, globalDB, fn)
}

func WithTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (RT, error) {
	return txwrap.WithTxRtn(ctx, globalDB, fn)
}

func TxJson(tx *TxWrap, v any) string {
	barr, err := json.Marshal(v)
	if err != nil {
		tx.SetErr(fmt.Errorf("json marshal (%T): %w", v, err))
		return ""
	}
	return string(barr)
}

func TxReadJson[T any](tx *TxWrap, jsonData string) *T {
	if jsonData == "" {
		return nil
	}
	var v T
	err := json.Unmarshal([]byte(jsonData), &v)
	if err != nil {
		tx.SetErr(fmt.Errorf("json unmarshal (%T): %w", v, err))
	}
	return &v
}
