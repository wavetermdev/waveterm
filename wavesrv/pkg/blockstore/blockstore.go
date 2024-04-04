package blockstore

type FileOptsType struct {
	MaxSize  int64
	Circular bool
	IJson    bool
}

type FileMeta = map[string]any

type FileInfo struct {
	BlockId   string
	Name      string
	Size      int64
	CreatedTs int64
	ModTs     int64
	Opts      FileOptsType
	Meta      FileMeta
}

// add ctx context.Context to all these methods
type BlockStore interface {
	MakeFile(blockId string, name string, meta FileMeta, opts FileOptsType) error
	WriteFile(blockId string, name string, meta FileMeta, data []byte) error
	AppendData(blockId string, name string, p []byte) error
	WriteAt(blockId string, name string, p []byte, off int64) (int, error)
	ReadAt(blockId string, name string, p []byte, off int64) (int, error)
	Stat(blockId string, name string) (FileInfo, error)
	CollapseIJson(blockId string, name string) error
	WriteMeta(blockId string, name string, meta FileMeta) error
	DeleteFile(blockId string, name string) error
	DeleteBlock(blockId string) error
	ListFiles(blockId string) []FileInfo
	FlushCache() error
	GetAllBlockIds() []string
}
