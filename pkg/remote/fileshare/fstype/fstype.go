package fstype

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type FullFile struct {
	Info   *wshrpc.FileInfo `json:"info"`
	Data64 string           `json:"data64"` // base64 encoded
}

type FileShareClient interface {
	// Stat returns the file info at the given parsed connection path
	Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error)
	// Read returns the file info at the given path, if it's a dir, then the list of entries
	Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error)
	// ListEntries returns the list of entries at the given path, or nothing if the path is a file
	ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error)
	// PutFile writes the given data to the file at the given path
	PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error
	// Mkdir creates a directory at the given path
	Mkdir(ctx context.Context, conn *connparse.Connection) error
	// Move moves the file from srcPath to destPath
	Move(ctx context.Context, srcConn, destConn *connparse.Connection, recursive bool) error
	// Copy copies the file from srcPath to destPath
	Copy(ctx context.Context, srcConn, destConn *connparse.Connection, recursive bool) error
	// Delete deletes the entry at the given path
	Delete(ctx context.Context, conn *connparse.Connection) error
	// GetConnectionType returns the type of connection for the fileshare
	GetConnectionType() string
}
