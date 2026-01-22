// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// file-related types and methods for wsh rpc calls
package wshrpc

import (
	"context"
	"os"

	"github.com/wavetermdev/waveterm/pkg/ijson"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
)

type WshRpcFileInterface interface {
	FileMkdirCommand(ctx context.Context, data FileData) error
	FileCreateCommand(ctx context.Context, data FileData) error
	FileDeleteCommand(ctx context.Context, data CommandDeleteFileData) error
	FileAppendCommand(ctx context.Context, data FileData) error
	FileAppendIJsonCommand(ctx context.Context, data CommandAppendIJsonData) error
	FileWriteCommand(ctx context.Context, data FileData) error
	FileReadCommand(ctx context.Context, data FileData) (*FileData, error)
	FileReadStreamCommand(ctx context.Context, data FileData) <-chan RespOrErrorUnion[FileData]
	FileStreamTarCommand(ctx context.Context, data CommandRemoteStreamTarData) <-chan RespOrErrorUnion[iochantypes.Packet]
	FileMoveCommand(ctx context.Context, data CommandFileCopyData) error
	FileCopyCommand(ctx context.Context, data CommandFileCopyData) error
	FileInfoCommand(ctx context.Context, data FileData) (*FileInfo, error)
	FileListCommand(ctx context.Context, data FileListData) ([]*FileInfo, error)
	FileJoinCommand(ctx context.Context, paths []string) (*FileInfo, error)
	FileListStreamCommand(ctx context.Context, data FileListData) <-chan RespOrErrorUnion[CommandRemoteListEntriesRtnData]
	FileShareCapabilityCommand(ctx context.Context, path string) (FileShareCapability, error)
}

type WshRpcRemoteFileInterface interface {
	RemoteStreamFileCommand(ctx context.Context, data CommandRemoteStreamFileData) chan RespOrErrorUnion[FileData]
	RemoteTarStreamCommand(ctx context.Context, data CommandRemoteStreamTarData) <-chan RespOrErrorUnion[iochantypes.Packet]
	RemoteFileCopyCommand(ctx context.Context, data CommandFileCopyData) (bool, error)
	RemoteListEntriesCommand(ctx context.Context, data CommandRemoteListEntriesData) chan RespOrErrorUnion[CommandRemoteListEntriesRtnData]
	RemoteFileInfoCommand(ctx context.Context, path string) (*FileInfo, error)
	RemoteFileTouchCommand(ctx context.Context, path string) error
	RemoteFileMoveCommand(ctx context.Context, data CommandFileCopyData) error
	RemoteFileDeleteCommand(ctx context.Context, data CommandDeleteFileData) error
	RemoteWriteFileCommand(ctx context.Context, data FileData) error
	RemoteFileJoinCommand(ctx context.Context, paths []string) (*FileInfo, error)
	RemoteMkdirCommand(ctx context.Context, path string) error
}

type FileDataAt struct {
	Offset int64 `json:"offset"`
	Size   int   `json:"size,omitempty"`
}

type FileData struct {
	Info    *FileInfo   `json:"info,omitempty"`
	Data64  string      `json:"data64,omitempty"`
	Entries []*FileInfo `json:"entries,omitempty"`
	At      *FileDataAt `json:"at,omitempty"` // if set, this turns read/write ops to ReadAt/WriteAt ops (len is only used for ReadAt)
}

type FileInfo struct {
	Path          string      `json:"path"`          // cleaned path (may have "~")
	Dir           string      `json:"dir,omitempty"` // returns the directory part of the path (if this is a a directory, it will be equal to Path).  "~" will be expanded, and separators will be normalized to "/"
	Name          string      `json:"name,omitempty"`
	NotFound      bool        `json:"notfound,omitempty"`
	Opts          *FileOpts   `json:"opts,omitempty"`
	Size          int64       `json:"size,omitempty"`
	Meta          *FileMeta   `json:"meta,omitempty"`
	Mode          os.FileMode `json:"mode,omitempty"`
	ModeStr       string      `json:"modestr,omitempty"`
	ModTime       int64       `json:"modtime,omitempty"`
	IsDir         bool        `json:"isdir,omitempty"`
	SupportsMkdir bool        `json:"supportsmkdir,omitempty"`
	MimeType      string      `json:"mimetype,omitempty"`
	ReadOnly      bool        `json:"readonly,omitempty"` // this is not set for fileinfo's returned from directory listings
}

type FileOpts struct {
	MaxSize     int64 `json:"maxsize,omitempty"`
	Circular    bool  `json:"circular,omitempty"`
	IJson       bool  `json:"ijson,omitempty"`
	IJsonBudget int   `json:"ijsonbudget,omitempty"`
	Truncate    bool  `json:"truncate,omitempty"`
	Append      bool  `json:"append,omitempty"`
}

type FileMeta = map[string]any

type FileListStreamResponse <-chan RespOrErrorUnion[CommandRemoteListEntriesRtnData]

type FileListData struct {
	Path string        `json:"path"`
	Opts *FileListOpts `json:"opts,omitempty"`
}

type FileListOpts struct {
	All    bool `json:"all,omitempty"`
	Offset int  `json:"offset,omitempty"`
	Limit  int  `json:"limit,omitempty"`
}

type FileCreateData struct {
	Path string         `json:"path"`
	Meta map[string]any `json:"meta,omitempty"`
	Opts *FileOpts      `json:"opts,omitempty"`
}

type CommandAppendIJsonData struct {
	ZoneId   string        `json:"zoneid"`
	FileName string        `json:"filename"`
	Data     ijson.Command `json:"data"`
}

type CommandDeleteFileData struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

type CommandFileCopyData struct {
	SrcUri  string        `json:"srcuri"`
	DestUri string        `json:"desturi"`
	Opts    *FileCopyOpts `json:"opts,omitempty"`
}

type CommandRemoteStreamTarData struct {
	Path string        `json:"path"`
	Opts *FileCopyOpts `json:"opts,omitempty"`
}

type FileCopyOpts struct {
	Overwrite bool  `json:"overwrite,omitempty"`
	Recursive bool  `json:"recursive,omitempty"` // only used for move, always true for copy
	Merge     bool  `json:"merge,omitempty"`
	Timeout   int64 `json:"timeout,omitempty"`
}

type CommandRemoteStreamFileData struct {
	Path      string `json:"path"`
	ByteRange string `json:"byterange,omitempty"`
}

type CommandRemoteListEntriesData struct {
	Path string        `json:"path"`
	Opts *FileListOpts `json:"opts,omitempty"`
}

type CommandRemoteListEntriesRtnData struct {
	FileInfo []*FileInfo `json:"fileinfo,omitempty"`
}

type FileShareCapability struct {
	CanAppend bool `json:"canappend"`
	CanMkdir  bool `json:"canmkdir"`
}
