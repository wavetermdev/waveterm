package fsutil

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/pathtree"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var slashRe = regexp.MustCompile(`/`)

func GetParentPath(conn *connparse.Connection) string {
	hostAndPath := conn.GetPathWithHost()
	return GetParentPathString(hostAndPath)
}

func GetParentPathString(hostAndPath string) string {
	if hostAndPath == "" || hostAndPath == "/" {
		return "/"
	}

	// Remove trailing slash if present
	if strings.HasSuffix(hostAndPath, "/") {
		hostAndPath = hostAndPath[:len(hostAndPath)-1]
	}

	lastSlash := strings.LastIndex(hostAndPath, "/")
	if lastSlash <= 0 {
		return "/"
	}
	return hostAndPath[:lastSlash+1]
}

const minURILength = 10 // Minimum length for a valid URI (e.g., "s3://bucket")

func GetPathPrefix(conn *connparse.Connection) string {
	fullUri := conn.GetFullURI()
	if fullUri == "" {
		return ""
	}
	pathPrefix := fullUri
	lastSlash := strings.LastIndex(fullUri, "/")
	if lastSlash > minURILength && lastSlash < len(fullUri)-1 {
		pathPrefix = fullUri[:lastSlash+1]
	}
	return pathPrefix
}

/*
if srcFileStat.IsDir() {
			srcPathPrefix := filepath.Dir(srcPathCleaned)
			if strings.HasSuffix(srcUri, "/") {
				srcPathPrefix = srcPathCleaned
			}
			err = filepath.Walk(srcPathCleaned, func(path string, info fs.FileInfo, err error) error {
				if err != nil {
					return err
				}
				srcFilePath := path
				destFilePath := filepath.Join(destPathCleaned, strings.TrimPrefix(path, srcPathPrefix))
				var file *os.File
				if !info.IsDir() {
					file, err = os.Open(srcFilePath)
					if err != nil {
						return fmt.Errorf("cannot open file %q: %w", srcFilePath, err)
					}
					defer utilfn.GracefulClose(file, "RemoteFileCopyCommand", srcFilePath)
				}
				_, err = copyFileFunc(destFilePath, info, file)
				return err
			})
			if err != nil {
				return fmt.Errorf("cannot copy %q to %q: %w", srcUri, destUri, err)
			}
		} else {
			file, err := os.Open(srcPathCleaned)
			if err != nil {
				return fmt.Errorf("cannot open file %q: %w", srcPathCleaned, err)
			}
			defer utilfn.GracefulClose(file, "RemoteFileCopyCommand", srcPathCleaned)
			var destFilePath string
			if destHasSlash {
				destFilePath = filepath.Join(destPathCleaned, filepath.Base(srcPathCleaned))
			} else {
				destFilePath = destPathCleaned
			}
			_, err = copyFileFunc(destFilePath, srcFileStat, file)
			if err != nil {
				return fmt.Errorf("cannot copy %q to %q: %w", srcUri, destUri, err)
			}
		}
*/

type CopyFunc func(ctx context.Context, srcPath, destPath string) error
type ListEntriesPrefix func(ctx context.Context, prefix string) ([]string, error)

func PrefixCopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, c fstype.FileShareClient, opts *wshrpc.FileCopyOpts, listEntriesPrefix ListEntriesPrefix, copyFunc CopyFunc) error {
	// merge := opts != nil && opts.Merge
	overwrite := opts != nil && opts.Overwrite
	srcHasSlash := strings.HasSuffix(srcConn.Path, "/")
	srcFileName, err := cleanPathPrefix(srcConn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning source path: %w", err)
	}
	// destHasSlash := strings.HasSuffix(destConn.Path, "/")
	// destFileName, err := cleanPathPrefix(destConn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning destination path: %w", err)
	}
	destInfo, err := c.Stat(ctx, destConn)
	destExists := err == nil && !destInfo.NotFound
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("error getting destination file info: %w", err)
	}
	destEntries := make(map[string]any)
	destParentPrefix := GetParentPath(destConn) + "/"
	if destExists {
		log.Printf("destInfo: %v", destInfo)
		if destInfo.IsDir {
			if !overwrite {
				return fmt.Errorf("destination already exists, overwrite not specified: %v", destConn.GetFullURI())
			}
			err = c.Delete(ctx, destConn, false)
			if err != nil {
				return fmt.Errorf("error deleting conflicting destination file: %w", err)
			} else {
				entries, err := listEntriesPrefix(ctx, destParentPrefix)
				if err != nil {
					return fmt.Errorf("error listing destination directory: %w", err)
				}
				for _, entry := range entries {
					destEntries[entry] = struct{}{}
				}
			}
		}
	}

	srcInfo, err := c.Stat(ctx, srcConn)
	if err != nil {
		return fmt.Errorf("error getting source file info: %w", err)
	}
	if srcInfo.IsDir {
		srcPathPrefix := srcFileName
		if !srcHasSlash {
			srcPathPrefix += "/"
		}
		entries, err := listEntriesPrefix(ctx, srcPathPrefix)
		if err != nil {
			return fmt.Errorf("error listing source directory: %w", err)
		}
		tree := pathtree.NewTree(srcPathPrefix, "/")
		// srcName := path.Base(srcFileName)
		// TODO: Finish implementing logic to match local copy in wshremote
		for _, entry := range entries {
			tree.Add(entry)
		}
		if err = tree.Walk(func(path string, numChildren int) error {
			log.Printf("path: %s, numChildren: %d", path, numChildren)
			/*

				relativePath := strings.TrimPrefix(entry, srcPathPrefix)
				if !srcHasSlash {
					relativePath = srcName + "/" + relativePath
				}
				destPath := destParentPrefix + relativePath
				if _, ok := destEntries[destPath]; ok {
					if !overwrite {
						return fmt.Errorf("destination already exists, overwrite not specified: %v", destConn.GetFullURI())
					}
				}*/
			return nil
		}); err != nil {
			return fmt.Errorf("error walking source directory: %w", err)
		}
	} else {
		return fmt.Errorf("copy between different hosts not supported")
	}
	return nil
}

// cleanPathPrefix corrects paths for prefix filesystems (i.e. ones that don't have directories)
func cleanPathPrefix(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}
	if strings.HasPrefix(path, "/") {
		path = path[1:]
	}
	if strings.HasPrefix(path, "~") || strings.HasPrefix(path, ".") || strings.HasPrefix(path, "..") {
		return "", fmt.Errorf("path cannot start with ~, ., or ..")
	}
	var newParts []string
	for _, part := range strings.Split(path, "/") {
		if part == ".." {
			if len(newParts) > 0 {
				newParts = newParts[:len(newParts)-1]
			}
		} else if part != "." {
			newParts = append(newParts, part)
		}
	}
	return strings.Join(newParts, "/"), nil
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
