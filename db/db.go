// provides the io/fs for DB migrations
package db

import "embed"

// since embeds must be relative to the package directory, this source file is required

//go:embed migrations/*.sql
var MigrationFS embed.FS
