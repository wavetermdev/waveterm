// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// provides the io/fs for DB migrations
package db

import "embed"

// since embeds must be relative to the package directory, this source file is required

//go:embed migrations/*.sql
var MigrationFS embed.FS

//go:embed blockstore-migrations/*.sql
var BlockstoreMigrationFS embed.FS
