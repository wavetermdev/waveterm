package fsutil

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fspath"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func GetParentPath(conn *connparse.Connection) string {
	hostAndPath := conn.GetPathWithHost()
	return GetParentPathString(hostAndPath)
}

func GetParentPathString(hostAndPath string) string {
	if hostAndPath == "" || hostAndPath == fspath.Separator {
		return ""
	}

	// Remove trailing slash if present
	if strings.HasSuffix(hostAndPath, fspath.Separator) {
		hostAndPath = hostAndPath[:len(hostAndPath)-1]
	}

	lastSlash := strings.LastIndex(hostAndPath, fspath.Separator)
	if lastSlash <= 0 {
		return ""
	}
	return hostAndPath[:lastSlash+1]
}

// CleanPathPrefix corrects paths for prefix filesystems (i.e. ones that don't have directories)
func CleanPathPrefix(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if strings.HasPrefix(path, fspath.Separator) {
		path = path[1:]
	}
	if strings.HasPrefix(path, "~") || strings.HasPrefix(path, ".") || strings.HasPrefix(path, "..") {
		return "", fmt.Errorf("path cannot start with ~, ., or ..")
	}
	var newParts []string
	for _, part := range strings.Split(path, fspath.Separator) {
		if part == ".." {
			if len(newParts) > 0 {
				newParts = newParts[:len(newParts)-1]
			}
		} else if part != "." {
			newParts = append(newParts, part)
		}
	}
	return fspath.Join(newParts...), nil
}

func ReadFileStream(ctx context.Context, readCh <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData], fileInfoCallback func(finfo wshrpc.FileInfo), dirCallback func(entries []*wshrpc.FileInfo) error, fileCallback func(data io.Reader) error) error {
	var fileData *wshrpc.FileData
	firstPk := true
	isDir := false
	drain := true
	defer func() {
		if drain {
			utilfn.DrainChannelSafe(readCh, "ReadFileStream")
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("context cancelled: %v", context.Cause(ctx))
		case respUnion, ok := <-readCh:
			if !ok {
				drain = false
				return nil
			}
			if respUnion.Error != nil {
				return respUnion.Error
			}
			resp := respUnion.Response
			if firstPk {
				firstPk = false
				// first packet has the fileinfo
				if resp.Info == nil {
					return fmt.Errorf("stream file protocol error, first pk fileinfo is empty")
				}
				fileData = &resp
				if fileData.Info.IsDir {
					isDir = true
				}
				fileInfoCallback(*fileData.Info)
				continue
			}
			if isDir {
				if len(resp.Entries) == 0 {
					continue
				}
				if resp.Data64 != "" {
					return fmt.Errorf("stream file protocol error, directory entry has data")
				}
				if err := dirCallback(resp.Entries); err != nil {
					return err
				}
			} else {
				if resp.Data64 == "" {
					continue
				}
				decoder := base64.NewDecoder(base64.StdEncoding, bytes.NewReader([]byte(resp.Data64)))
				if err := fileCallback(decoder); err != nil {
					return err
				}
			}
		}
	}
}

func ReadStreamToFileData(ctx context.Context, readCh <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData]) (*wshrpc.FileData, error) {
	var fileData *wshrpc.FileData
	var dataBuf bytes.Buffer
	var entries []*wshrpc.FileInfo
	err := ReadFileStream(ctx, readCh, func(finfo wshrpc.FileInfo) {
		fileData = &wshrpc.FileData{
			Info: &finfo,
		}
	}, func(fileEntries []*wshrpc.FileInfo) error {
		entries = append(entries, fileEntries...)
		return nil
	}, func(data io.Reader) error {
		if _, err := io.Copy(&dataBuf, data); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if fileData == nil {
		return nil, fmt.Errorf("stream file protocol error, no file info")
	}
	if !fileData.Info.IsDir {
		fileData.Data64 = base64.StdEncoding.EncodeToString(dataBuf.Bytes())
	} else {
		fileData.Entries = entries
	}
	return fileData, nil
}

func ReadFileStreamToWriter(ctx context.Context, readCh <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData], writer io.Writer) error {
	return ReadFileStream(ctx, readCh, func(finfo wshrpc.FileInfo) {
	}, func(entries []*wshrpc.FileInfo) error {
		return nil
	}, func(data io.Reader) error {
		_, err := io.Copy(writer, data)
		return err
	})
}
