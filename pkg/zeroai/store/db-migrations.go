// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package store

import (
	"embed"
	"fmt"

	"github.com/wavetermdev/waveterm/db"
)

// RunMigrations executes the ZeroAI database migrations
func RunMigrations(migrateFunc func(embed.FS, string) error) error {
	if err := migrateFunc(db.ZeroaiMigrationFS, "zeroai"); err != nil {
		return fmt.Errorf("failed to run ZeroAI migrations: %w", err)
	}
	return nil
}
