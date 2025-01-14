// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package db

import "embed"

//go:embed migrations-filestore/*.sql
var FilestoreMigrationFS embed.FS

//go:embed migrations-wstore/*.sql
var WStoreMigrationFS embed.FS
