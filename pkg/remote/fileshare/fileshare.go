package fileshare

type FileShare interface {
	// GetFile returns the file at the given path
	GetFile(path string) ([]byte, error)
	// PutFile writes the given data to the file at the given path
	PutFile(path string, data []byte) error
	// DeleteFile deletes the file at the given path
	DeleteFile(path string) error
	// ListFiles returns a list of files in the given directory
	ListFiles(path string) ([]string, error)
	// GetFileShareName returns the name of the fileshare
	GetFileShareName() string
}
