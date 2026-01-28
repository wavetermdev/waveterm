// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fstype

import (
	"context"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	DefaultTimeout                     = 30 * time.Second
	FileMode               os.FileMode = 0644
	DirMode                os.FileMode = 0755 | os.ModeDir
	RecursiveRequiredError             = "recursive flag must be set for directory operations"
	MergeRequiredError                 = "directory already exists at %q, set overwrite flag to delete the existing contents or set merge flag to merge the contents"
	OverwriteRequiredError             = "file already exists at %q, set overwrite flag to delete the existing file"
)

type FileShareClient interface {
	// Stat returns the file info at the given parsed connection path
	Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error)
	// Read returns the file info at the given path, if it's a directory, then the list of entries
	Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error)
	// ReadStream returns a stream of file data at the given path. If it's a directory, then the list of entries
	ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData]
	// ListEntries returns the list of entries at the given path, or nothing if the path is a file
	ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error)
	// ListEntriesStream returns a stream of entries at the given path
	ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]
	// PutFile writes the given data to the file at the given path
	PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error
	// AppendFile appends the given data to the file at the given path
	AppendFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error
	// Mkdir creates a directory at the given path
	Mkdir(ctx context.Context, conn *connparse.Connection) error
	// Move moves the file within the same connection
	MoveInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error
	// Copy copies the file within the same connection. Returns whether the copy source was a directory
	CopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error)
	// CopyRemote copies the file between different connections. Returns whether the copy source was a directory
	CopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, srcClient FileShareClient, opts *wshrpc.FileCopyOpts) (bool, error)
	// Delete deletes the entry at the given path
	Delete(ctx context.Context, conn *connparse.Connection, recursive bool) error
	// Join joins the given parts to the connection path
	Join(ctx context.Context, conn *connparse.Connection, parts ...string) (*wshrpc.FileInfo, error)
	// GetConnectionType returns the type of connection for the fileshare
	GetConnectionType() string
	// GetCapability returns the capability of the fileshare
	GetCapability() wshrpc.FileShareCapability
}
