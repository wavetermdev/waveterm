// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package migrateutil

import (
	"database/sql"
	"fmt"
	"io/fs"
	"log"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	sqlite3migrate "github.com/golang-migrate/migrate/v4/database/sqlite3"
)

func GetMigrateVersion(m *migrate.Migrate) (uint, bool, error) {
	curVersion, dirty, err := m.Version()
	if err == migrate.ErrNilVersion {
		return 0, false, nil
	}
	return curVersion, dirty, err
}

func MakeMigrate(storeName string, db *sql.DB, migrationFS fs.FS, migrationsName string) (*migrate.Migrate, error) {
	fsVar, err := iofs.New(migrationFS, migrationsName)
	if err != nil {
		return nil, fmt.Errorf("opening fs: %w", err)
	}
	mdriver, err := sqlite3migrate.WithInstance(db, &sqlite3migrate.Config{})
	if err != nil {
		return nil, fmt.Errorf("making %s migration driver: %w", storeName, err)
	}
	m, err := migrate.NewWithInstance("iofs", fsVar, "sqlite3", mdriver)
	if err != nil {
		return nil, fmt.Errorf("making %s migration: %w", storeName, err)
	}
	return m, nil
}

func Migrate(storeName string, db *sql.DB, migrationFS fs.FS, migrationsName string) error {
	log.Printf("migrate %s\n", storeName)
	m, err := MakeMigrate(storeName, db, migrationFS, migrationsName)
	if err != nil {
		return err
	}
	curVersion, dirty, err := GetMigrateVersion(m)
	if dirty {
		return fmt.Errorf("%s, migrate up, database is dirty", storeName)
	}
	if err != nil {
		return fmt.Errorf("%s, cannot get current migration version: %v", storeName, err)
	}
	err = m.Up()
	if err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrating %s: %w", storeName, err)
	}
	newVersion, _, err := GetMigrateVersion(m)
	if err != nil {
		return fmt.Errorf("%s, cannot get new migration version: %v", storeName, err)
	}
	if newVersion != curVersion {
		log.Printf("[db] %s migration done, version %d -> %d\n", storeName, curVersion, newVersion)
	}
	return nil
}
