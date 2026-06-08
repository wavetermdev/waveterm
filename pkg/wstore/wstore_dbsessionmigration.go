// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const MigrateSessionDaemonKey = "migrate:sessiondaemon"

func runSessionDaemonMigration(ctx context.Context) error {
	client, err := DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("get client: %w", err)
	}

	if client.Meta != nil && client.Meta[MigrateSessionDaemonKey] == true {
		return nil
	}

	blocks, err := DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		return fmt.Errorf("list blocks: %w", err)
	}

	var migrated int
	for _, block := range blocks {
		if block.JobId == "" {
			continue
		}
		connName := block.Meta.GetString("connection", "")
		if connName == "" {
			continue
		}

		daemonId := uuid.New().String()
		dbDaemon := &waveobj.SessionDaemon{
			OID:         daemonId,
			Name:        "",
			Connection:  connName,
			JobId:       block.JobId,
			IsAnonymous: true,
			Status:      "running",
			CreatedAt:   time.Now().UnixMilli(),
			IdleTimeout: 3600,
		}

		err = DBInsert(ctx, dbDaemon)
		if err != nil {
			log.Printf("[migration] warning: error inserting session daemon for block %s: %v", block.OID, err)
			continue
		}

		err = DBUpdateFn(ctx, block.OID, func(b *waveobj.Block) {
			if b.Meta == nil {
				b.Meta = make(waveobj.MetaMapType)
			}
			b.Meta[waveobj.MetaKey_SessionDaemonId] = daemonId
			b.JobId = ""
		})
		if err != nil {
			log.Printf("[migration] warning: error updating block %s: %v", block.OID, err)
			continue
		}

		migrated++
	}

	if client.Meta == nil {
		client.Meta = make(waveobj.MetaMapType)
	}
	client.Meta[MigrateSessionDaemonKey] = true
	err = DBUpdate(ctx, client)
	if err != nil {
		return fmt.Errorf("update client meta: %w", err)
	}

	if migrated > 0 {
		log.Printf("[migration] migrated %d blocks to session daemon\n", migrated)
	}
	return nil
}

func RunSessionDaemonMigration(ctx context.Context) error {
	ctx, cancelFn := context.WithTimeout(ctx, 30*time.Second)
	defer cancelFn()
	return runSessionDaemonMigration(ctx)
}
