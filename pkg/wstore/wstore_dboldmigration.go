// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

const OldDBName = "~/.waveterm/waveterm.db"

func GetOldDBName() string {
	return wavebase.ExpandHomeDir(OldDBName)
}

func MakeOldDB(ctx context.Context) (*sqlx.DB, error) {
	dbName := GetOldDBName()
	rtn, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000", dbName))
	if err != nil {
		return nil, err
	}
	rtn.DB.SetMaxOpenConns(1)
	return rtn, nil
}

type OldHistoryType struct {
	HistoryId  string
	Ts         int64
	RemoteName string
	HadError   bool
	CmdStr     string
	ExitCode   int
	DurationMs int64
}

func GetAllOldHistory() ([]*OldHistoryType, error) {
	query := `
		SELECT 
		    h.historyid, 
			h.ts, 
			COALESCE(r.remotecanonicalname, '') as remotename, 
			h.haderror,
			h.cmdstr, 
			COALESCE(h.exitcode, 0) as exitcode, 
			COALESCE(h.durationms, 0) as durationms
		FROM history h, remote r
		WHERE h.remoteid = r.remoteid 
		  AND NOT h.ismetacmd
	`
	db, err := MakeOldDB(context.Background())
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var rtn []*OldHistoryType
	err = db.Select(&rtn, query)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func ReplaceOldHistory(ctx context.Context, hist []*OldHistoryType) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE FROM history_migrated`
		tx.Exec(query)
		query = `INSERT INTO history_migrated (historyid, ts, remotename, haderror, cmdstr, exitcode, durationms) 
		                               VALUES (?, ?, ?, ?, ?, ?, ?)`
		for _, hobj := range hist {
			tx.Exec(query, hobj.HistoryId, hobj.Ts, hobj.RemoteName, hobj.HadError, hobj.CmdStr, hobj.ExitCode, hobj.DurationMs)
		}
		return nil
	})
}

func TryMigrateOldHistory() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelFn()
	client, err := DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return err
	}
	if client.HistoryMigrated {
		return nil
	}
	log.Printf("trying to migrate old wave history\n")
	client.HistoryMigrated = true
	err = DBUpdate(ctx, client)
	if err != nil {
		return err
	}
	hist, err := GetAllOldHistory()
	if err != nil {
		return err
	}
	if len(hist) == 0 {
		return nil
	}
	err = ReplaceOldHistory(ctx, hist)
	if err != nil {
		return err
	}
	log.Printf("migrated %d old wave history records\n", len(hist))
	return nil
}
