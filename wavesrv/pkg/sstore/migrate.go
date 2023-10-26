// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sstore

import (
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"time"

	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/mattn/go-sqlite3"
	sh2db "github.com/wavetermdev/waveterm/wavesrv/db"

	"github.com/golang-migrate/migrate/v4"
)

const MaxMigration = 23
const MigratePrimaryScreenVersion = 9
const CmdScreenSpecialMigration = 13
const CmdLineSpecialMigration = 20

func MakeMigrate() (*migrate.Migrate, error) {
	fsVar, err := iofs.New(sh2db.MigrationFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("opening iofs: %w", err)
	}
	// migrationPathUrl := fmt.Sprintf("file://%s", path.Join(wd, "db", "migrations"))
	dbUrl := fmt.Sprintf("sqlite3://%s", GetDBName())
	m, err := migrate.NewWithSourceInstance("iofs", fsVar, dbUrl)
	// m, err := migrate.New(migrationPathUrl, dbUrl)
	if err != nil {
		return nil, fmt.Errorf("making migration db[%s]: %w", GetDBName(), err)
	}
	return m, nil
}

func copyFile(srcFile string, dstFile string) error {
	if srcFile == dstFile {
		return fmt.Errorf("cannot copy %s to itself", srcFile)
	}
	srcFd, err := os.Open(srcFile)
	if err != nil {
		return fmt.Errorf("cannot open %s: %v", err)
	}
	defer srcFd.Close()
	dstFd, err := os.OpenFile(dstFile, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("cannot open destination file %s: %v", err)
	}
	_, err = io.Copy(dstFd, srcFd)
	if err != nil {
		dstFd.Close()
		return fmt.Errorf("error copying file: %v", err)
	}
	return dstFd.Close()
}

func MigrateUpStep(m *migrate.Migrate, newVersion uint) error {
	startTime := time.Now()
	err := m.Migrate(newVersion)
	if err != nil {
		return err
	}
	if newVersion == CmdScreenSpecialMigration {
		mErr := RunMigration13()
		if mErr != nil {
			return fmt.Errorf("migrating to v%d: %w", newVersion, mErr)
		}
	}
	if newVersion == CmdLineSpecialMigration {
		mErr := RunMigration20()
		if mErr != nil {
			return fmt.Errorf("migrating to v%d: %w", newVersion, mErr)
		}
	}
	log.Printf("[db] migration v%d, elapsed %v\n", newVersion, time.Since(startTime))
	return nil
}

func MigrateUp(targetVersion uint) error {
	m, err := MakeMigrate()
	if err != nil {
		return err
	}
	curVersion, dirty, err := MigrateVersion(m)
	if dirty {
		return fmt.Errorf("cannot migrate up, database is dirty")
	}
	if err != nil {
		return fmt.Errorf("cannot get current migration version: %v", err)
	}
	if curVersion >= targetVersion {
		return nil
	}
	log.Printf("[db] migrating from %d to %d\n", curVersion, targetVersion)
	log.Printf("[db] backing up database %s to %s\n", DBFileName, DBFileNameBackup)
	err = copyFile(GetDBName(), GetDBBackupName())
	if err != nil {
		return fmt.Errorf("error creating database backup: %v", err)
	}
	for newVersion := curVersion + 1; newVersion <= targetVersion; newVersion++ {
		err = MigrateUpStep(m, newVersion)
		if err != nil {
			return fmt.Errorf("during migration v%d: %w", newVersion, err)
		}
	}
	log.Printf("[db] migration done, new version = %d\n", targetVersion)
	return nil
}

// returns curVersion, dirty, error
func MigrateVersion(m *migrate.Migrate) (uint, bool, error) {
	if m == nil {
		var err error
		m, err = MakeMigrate()
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

func MigrateDown() error {
	m, err := MakeMigrate()
	if err != nil {
		return err
	}
	err = m.Down()
	if err != nil {
		return err
	}
	return nil
}

func MigrateGoto(n uint) error {
	curVersion, _, _ := MigrateVersion(nil)
	if curVersion == n {
		return nil
	}
	if curVersion < n {
		return MigrateUp(n)
	}
	m, err := MakeMigrate()
	if err != nil {
		return err
	}
	err = m.Migrate(n)
	if err != nil {
		return err
	}
	return nil
}

func TryMigrateUp() error {
	curVersion, _, _ := MigrateVersion(nil)
	log.Printf("[db] db version = %d\n", curVersion)
	if curVersion >= MaxMigration {
		return nil
	}
	err := MigrateUp(MaxMigration)
	if err != nil {
		return err
	}
	return MigratePrintVersion()
}

func MigratePrintVersion() error {
	version, dirty, err := MigrateVersion(nil)
	if err != nil {
		return fmt.Errorf("error getting db version: %v", err)
	}
	if dirty {
		return fmt.Errorf("error db is dirty, version=%d", version)
	}
	log.Printf("[db] version=%d\n", version)
	return nil
}

func MigrateCommandOpts(opts []string) error {
	var err error
	if opts[0] == "--migrate-up" {
		fmt.Printf("migrate-up %v\n", GetDBName())
		time.Sleep(3 * time.Second)
		err = MigrateUp(MaxMigration)
	} else if opts[0] == "--migrate-down" {
		fmt.Printf("migrate-down %v\n", GetDBName())
		time.Sleep(3 * time.Second)
		err = MigrateDown()
	} else if opts[0] == "--migrate-goto" {
		n, err := strconv.Atoi(opts[1])
		if err == nil {
			fmt.Printf("migrate-goto %v => %d\n", GetDBName(), n)
			time.Sleep(3 * time.Second)
			err = MigrateGoto(uint(n))
		}
	} else {
		err = fmt.Errorf("invalid migration command")
	}
	if err != nil && err.Error() == migrate.ErrNoChange.Error() {
		err = nil
	}
	if err != nil {
		return err
	}
	return MigratePrintVersion()
}
