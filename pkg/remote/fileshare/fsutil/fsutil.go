package fsutil

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fspath"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/pathtree"
	"github.com/wavetermdev/waveterm/pkg/util/tarcopy"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func GetParentPath(conn *connparse.Connection) string {
	hostAndPath := conn.GetPathWithHost()
	return GetParentPathString(hostAndPath)
}

func GetParentPathString(hostAndPath string) string {
	if hostAndPath == "" || hostAndPath == fspath.Separator {
		return fspath.Separator
	}

	// Remove trailing slash if present
	if strings.HasSuffix(hostAndPath, fspath.Separator) {
		hostAndPath = hostAndPath[:len(hostAndPath)-1]
	}

	lastSlash := strings.LastIndex(hostAndPath, fspath.Separator)
	if lastSlash <= 0 {
		return fspath.Separator
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
	lastSlash := strings.LastIndex(fullUri, fspath.Separator)
	if lastSlash > minURILength && lastSlash < len(fullUri)-1 {
		pathPrefix = fullUri[:lastSlash+1]
	}
	return pathPrefix
}

func PrefixCopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, c fstype.FileShareClient, opts *wshrpc.FileCopyOpts, listEntriesPrefix func(ctx context.Context, host string, path string) ([]string, error), copyFunc func(ctx context.Context, host string, path string) error) error {
	log.Printf("PrefixCopyInternal: %v -> %v", srcConn.GetFullURI(), destConn.GetFullURI())
	merge := opts != nil && opts.Merge
	overwrite := opts != nil && opts.Overwrite
	if overwrite && merge {
		return fmt.Errorf("cannot specify both overwrite and merge")
	}
	srcHasSlash := strings.HasSuffix(srcConn.Path, fspath.Separator)
	srcPath, err := CleanPathPrefix(srcConn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning source path: %w", err)
	}
	destHasSlash := strings.HasSuffix(destConn.Path, fspath.Separator)
	destPath, err := CleanPathPrefix(destConn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning destination path: %w", err)
	}
	if !srcHasSlash {
		if !destHasSlash {
			destPath += fspath.Separator
		}
		destPath += fspath.Base(srcPath)
	}
	destConn.Path = destPath
	destInfo, err := c.Stat(ctx, destConn)
	destExists := err == nil && !destInfo.NotFound
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("error getting destination file info: %w", err)
	}

	srcInfo, err := c.Stat(ctx, srcConn)
	if err != nil {
		return fmt.Errorf("error getting source file info: %w", err)
	}
	if destExists {
		if overwrite {
			err = c.Delete(ctx, destConn, true)
			if err != nil {
				return fmt.Errorf("error deleting conflicting destination file: %w", err)
			}
		} else if destInfo.IsDir && srcInfo.IsDir {
			if !merge {
				return fmt.Errorf("destination and source are both directories, neither merge nor overwrite specified: %v", destConn.GetFullURI())
			}
		} else {
			return fmt.Errorf("destination already exists, overwrite not specified: %v", destConn.GetFullURI())
		}
	}
	if srcInfo.IsDir {
		if !srcHasSlash {
			srcPath += fspath.Separator
		}
		destPath += fspath.Separator
		log.Printf("Copying directory: %v -> %v", srcPath, destPath)
		entries, err := listEntriesPrefix(ctx, srcConn.Host, srcPath)
		if err != nil {
			return fmt.Errorf("error listing source directory: %w", err)
		}

		tree := pathtree.NewTree(srcPath, fspath.Separator)
		for _, entry := range entries {
			tree.Add(entry)
		}

		/* tree.Walk will return the full path in the source bucket for each item.
		prefixToRemove specifies how much of that path we want in the destination subtree.
		If the source path has a trailing slash, we don't want to include the source directory itself in the destination subtree.*/
		prefixToRemove := srcPath
		if !srcHasSlash {
			prefixToRemove = fspath.Dir(srcPath) + fspath.Separator
		}
		return tree.Walk(func(path string, numChildren int) error {
			// since this is a prefix filesystem, we only care about leafs
			if numChildren > 0 {
				return nil
			}
			destFilePath := destPath + strings.TrimPrefix(path, prefixToRemove)
			return copyFunc(ctx, path, destFilePath)
		})
	} else {
		return copyFunc(ctx, srcPath, destPath)
	}
}

func PrefixCopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, srcClient, destClient fstype.FileShareClient, destPutFile func(host string, path string, size int64, reader io.Reader) error, opts *wshrpc.FileCopyOpts) error {
	merge := opts != nil && opts.Merge
	overwrite := opts != nil && opts.Overwrite
	if overwrite && merge {
		return fmt.Errorf("cannot specify both overwrite and merge")
	}
	srcHasSlash := strings.HasSuffix(srcConn.Path, fspath.Separator)
	destHasSlash := strings.HasSuffix(destConn.Path, fspath.Separator)
	destPath, err := CleanPathPrefix(destConn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning destination path: %w", err)
	}
	if !srcHasSlash {
		if !destHasSlash {
			destPath += fspath.Separator
		}
		destPath += fspath.Base(srcConn.Path)
	}
	destConn.Path = destPath
	destInfo, err := destClient.Stat(ctx, destConn)
	destExists := err == nil && !destInfo.NotFound
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("error getting destination file info: %w", err)
	}

	srcInfo, err := srcClient.Stat(ctx, srcConn)
	if err != nil {
		return fmt.Errorf("error getting source file info: %w", err)
	}
	if destExists {
		if overwrite {
			err = destClient.Delete(ctx, destConn, true)
			if err != nil {
				return fmt.Errorf("error deleting conflicting destination file: %w", err)
			}
		} else if destInfo.IsDir && srcInfo.IsDir {
			if !merge {
				return fmt.Errorf("destination and source are both directories, neither merge nor overwrite specified: %v", destConn.GetFullURI())
			}
		} else {
			return fmt.Errorf("destination already exists, overwrite not specified: %v", destConn.GetFullURI())
		}
	}
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	log.Printf("Copying: %v -> %v", srcConn.GetFullURI(), destConn.GetFullURI())
	readCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	ioch := srcClient.ReadTarStream(readCtx, srcConn, opts)
	err = tarcopy.TarCopyDest(readCtx, cancel, ioch, func(next *tar.Header, reader *tar.Reader, singleFile bool) error {
		if next.Typeflag == tar.TypeDir {
			return nil
		}
		if singleFile && srcInfo.IsDir {
			return fmt.Errorf("protocol error: source is a directory, but only a single file is being copied")
		}
		fileName, err := CleanPathPrefix(fspath.Join(destPath, next.Name))
		if singleFile && !destHasSlash {
			fileName, err = CleanPathPrefix(destConn.Path)
		}
		if err != nil {
			return fmt.Errorf("error cleaning path: %w", err)
		}
		log.Printf("CopyRemote: writing file: %s; size: %d\n", fileName, next.Size)
		return destPutFile(destConn.Host, fileName, next.Size, reader)
	})
	if err != nil {
		cancel(err)
		return err
	}
	return nil
}

// CleanPathPrefix corrects paths for prefix filesystems (i.e. ones that don't have directories)
func CleanPathPrefix(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
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
