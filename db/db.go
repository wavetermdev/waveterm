// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package db

import "embed"

//go:embed migrations-blockstore/*.sql
var BlockstoreMigrationFS embed.FS
