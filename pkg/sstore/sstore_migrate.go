package sstore

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/commandlinedev/prompt-server/pkg/scbase"
)

type cmdMigrationType struct {
	SessionId string
	ScreenId  string
	CmdId     string
}

func getSliceChunk[T any](slice []T, chunkSize int) ([]T, []T) {
	if chunkSize >= len(slice) {
		return slice, nil
	}
	return slice[0:chunkSize], slice[chunkSize:]
}

func RunCmdScreenMigration13() error {
	ctx := context.Background()
	startTime := time.Now()
	var migrations []cmdMigrationType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		tx.Select(&migrations, `SELECT * FROM cmd_migrate`)
		return nil
	})
	if txErr != nil {
		return fmt.Errorf("trying to get cmd migrations: %w", txErr)
	}
	log.Printf("[db] got %d cmd-screen migrations\n", len(migrations))
	for len(migrations) > 0 {
		var mchunk []cmdMigrationType
		mchunk, migrations = getSliceChunk(migrations, 5)
		err := processMigrationChunk(ctx, mchunk)
		if err != nil {
			return fmt.Errorf("cmd migration failed on chunk: %w", err)
		}
	}
	err := os.RemoveAll(scbase.GetSessionsDir())
	if err != nil {
		return fmt.Errorf("cannot remove old sessions dir %s: %w\n", scbase.GetSessionsDir(), err)
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE client SET cmdstoretype = 'screen'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		return fmt.Errorf("cannot change client cmdstoretype: %w", err)
	}
	log.Printf("[db] cmd screen migration done: %v\n", time.Since(startTime))
	return nil
}

func processMigrationChunk(ctx context.Context, mchunk []cmdMigrationType) error {
	for _, mig := range mchunk {
		newFile, err := scbase.PtyOutFile(mig.ScreenId, mig.CmdId)
		if err != nil {
			log.Printf("ptyoutfile error: %v\n", err)
			continue
		}
		oldFile, err := scbase.PtyOutFile_Sessions(mig.SessionId, mig.CmdId)
		if err != nil {
			log.Printf("ptyoutfile_sessions error: %v\n", err)
			continue
		}
		err = os.Rename(oldFile, newFile)
		if err != nil {
			log.Printf("error renaming %s => %s: %v\n", oldFile, newFile, err)
			continue
		}
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		for _, mig := range mchunk {
			query := `DELETE FROM cmd_migrate WHERE cmdid = ?`
			tx.Exec(query, mig.CmdId)
		}
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}
