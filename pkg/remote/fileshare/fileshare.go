package fileshare

import "github.com/wavetermdev/waveterm/pkg/wshrpc"

type FullFile struct {
	Info   *wshrpc.FileInfo `json:"info"`
	Data64 string           `json:"data64"` // base64 encoded
}

type FileShare interface {
	// Stat returns the file info at the given path
	Stat(path string) (*wshrpc.FileInfo, error)
	// Read returns the file info at the given path, if it's a dir, then the file data will be a serialized array of FileInfo
	Read(path string) (*FullFile, error)
	// PutFile writes the given data to the file at the given path
	PutFile(path string, data64 string) error
	// Mkdir creates a directory at the given path
	Mkdir(path string) error
	// Move moves the file from srcPath to destPath
	Move(srcPath, destPath string, recursive bool) error
	// Copy copies the file from srcPath to destPath
	Copy(srcPath, destPath string, recursive bool) error
	// Delete deletes the entry at the given path
	Delete(path string) error
	// ListEntries returns a list of entries in the given directory
	ListEntries(path string) ([]wshrpc.FileInfo, error)
	// GetFileShareName returns the name of the fileshare
	GetFileShareName() string
}

func CreateFileShare(connection string) FileShare {
	return nil
}
