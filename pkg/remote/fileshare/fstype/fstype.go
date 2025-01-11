package fstype

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type FullFile struct {
	Info   *wshrpc.FileInfo `json:"info"`
	Data64 string           `json:"data64"` // base64 encoded
}

type FileShareClient interface {
	// Stat returns the file info at the given path
	Stat(ctx context.Context, path string) (*wshrpc.FileInfo, error)
	// Read returns the file info at the given path, if it's a dir, then the file data will be a serialized array of FileInfo
	Read(ctx context.Context, path string) (*FullFile, error)
	// PutFile writes the given data to the file at the given path
	PutFile(ctx context.Context, data wshrpc.FileData) error
	// Mkdir creates a directory at the given path
	Mkdir(ctx context.Context, path string) error
	// Move moves the file from srcPath to destPath
	Move(ctx context.Context, srcPath, destPath string, recursive bool) error
	// Copy copies the file from srcPath to destPath
	Copy(ctx context.Context, srcPath, destPath string, recursive bool) error
	// Delete deletes the entry at the given path
	Delete(ctx context.Context, path string) error
	// GetConnectionType returns the type of connection for the fileshare
	GetConnectionType() string
}
