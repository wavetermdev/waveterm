// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fstype

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type FileShareClient interface {
	// Stat returns the file info at the given parsed connection path
	Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error)
	// Read returns the file info at the given path, if it's a directory, then the list of entries
	Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error)
	// ReadStream returns a stream of file data at the given path. If it's a directory, then the list of entries
	ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData]
	// ReadTarStream returns a stream of tar data at the given path
	ReadTarStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileCopyOpts) <-chan wshrpc.RespOrErrorUnion[[]byte]
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
	// Move moves the file from srcConn to destConn
	Move(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error
	// Copy copies the file from srcConn to destConn
	Copy(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error
	// Delete deletes the entry at the given path
	Delete(ctx context.Context, conn *connparse.Connection) error
	// Join joins the given parts to the connection path
	Join(ctx context.Context, conn *connparse.Connection, parts ...string) (string, error)
	// GetConnectionType returns the type of connection for the fileshare
	GetConnectionType() string
}
