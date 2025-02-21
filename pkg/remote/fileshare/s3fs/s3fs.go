// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package s3fs

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/wavetermdev/waveterm/pkg/remote/awsconn"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fspath"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fsutil"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/pathtree"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/util/tarcopy"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type S3Client struct {
	client *s3.Client
}

var _ fstype.FileShareClient = S3Client{}

func NewS3Client(config *aws.Config) *S3Client {
	return &S3Client{
		client: s3.NewFromConfig(*config),
	}
}

func (c S3Client) Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error) {
	rtnCh := c.ReadStream(ctx, conn, data)
	return fsutil.ReadStreamToFileData(ctx, rtnCh)
}

func (c S3Client) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	bucket := conn.Host
	objectKey := conn.Path
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 16)
	go func() {
		defer close(rtn)
		finfo, err := c.Stat(ctx, conn)
		if err != nil {
			rtn <- wshutil.RespErr[wshrpc.FileData](err)
			return
		}
		rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Info: finfo}}
		if finfo.NotFound {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: []*wshrpc.FileInfo{
				{
					Path:     finfo.Dir,
					Dir:      fspath.Dir(finfo.Dir),
					Name:     "..",
					IsDir:    true,
					Size:     0,
					ModTime:  time.Now().Unix(),
					MimeType: "directory",
				},
			}}}
			return
		}
		if finfo.IsDir {
			listEntriesCh := c.ListEntriesStream(ctx, conn, nil)
			defer func() {
				utilfn.DrainChannelSafe(listEntriesCh, "s3fs.ReadStream")
			}()
			for respUnion := range listEntriesCh {
				if respUnion.Error != nil {
					rtn <- wshutil.RespErr[wshrpc.FileData](respUnion.Error)
					return
				}
				resp := respUnion.Response
				if len(resp.FileInfo) > 0 {
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: resp.FileInfo}}
				}
			}
		} else {
			var result *s3.GetObjectOutput
			var err error
			if data.At != nil {
				log.Printf("reading %v with offset %d and size %d", conn.GetFullURI(), data.At.Offset, data.At.Size)
				result, err = c.client.GetObject(ctx, &s3.GetObjectInput{
					Bucket: aws.String(bucket),
					Key:    aws.String(objectKey),
					Range:  aws.String(fmt.Sprintf("bytes=%d-%d", data.At.Offset, data.At.Offset+int64(data.At.Size)-1)),
				})
			} else {
				result, err = c.client.GetObject(ctx, &s3.GetObjectInput{
					Bucket: aws.String(bucket),
					Key:    aws.String(objectKey),
				})
			}
			if err != nil {
				log.Printf("error getting object %v:%v: %v", bucket, objectKey, err)
				var noKey *types.NoSuchKey
				if errors.As(err, &noKey) {
					err = noKey
				}
				rtn <- wshutil.RespErr[wshrpc.FileData](err)
				return
			}
			size := int64(0)
			if result.ContentLength != nil {
				size = *result.ContentLength
			}
			finfo := &wshrpc.FileInfo{
				Name:    objectKey,
				IsDir:   false,
				Size:    size,
				ModTime: result.LastModified.UnixMilli(),
				Path:    conn.GetFullURI(),
				Dir:     fsutil.GetParentPath(conn),
			}
			fileutil.AddMimeTypeToFileInfo(finfo.Path, finfo)
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Info: finfo}}
			if size == 0 {
				log.Printf("no data to read")
				return
			}
			defer utilfn.GracefulClose(result.Body, "s3fs", conn.GetFullURI())
			bytesRemaining := size
			for {
				select {
				case <-ctx.Done():
					rtn <- wshutil.RespErr[wshrpc.FileData](context.Cause(ctx))
					return
				default:
					buf := make([]byte, min(bytesRemaining, wshrpc.FileChunkSize))
					n, err := result.Body.Read(buf)
					if err != nil && !errors.Is(err, io.EOF) {
						rtn <- wshutil.RespErr[wshrpc.FileData](err)
						return
					}
					if n == 0 {
						break
					}
					bytesRemaining -= int64(n)
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Data64: base64.StdEncoding.EncodeToString(buf[:n])}}
					if bytesRemaining == 0 || errors.Is(err, io.EOF) {
						return
					}
				}
			}
		}
	}()
	return rtn
}

func (c S3Client) ReadTarStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileCopyOpts) <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet] {
	recursive := opts != nil && opts.Recursive
	bucket := conn.Host
	if bucket == "" || bucket == "/" {
		return wshutil.SendErrCh[iochantypes.Packet](fmt.Errorf("bucket must be specified"))
	}

	// whether the operation is on the whole bucket
	wholeBucket := conn.Path == "" || conn.Path == fspath.Separator

	// get the object if it's a single file operation
	var singleFileResult *s3.GetObjectOutput
	// this ensures we don't leak the object if we error out before copying it
	closeSingleFileResult := true
	defer func() {
		// in case we error out before the object gets copied, make sure to close it
		if singleFileResult != nil && closeSingleFileResult {
			utilfn.GracefulClose(singleFileResult.Body, "s3fs", conn.Path)
		}
	}()
	var err error
	if !wholeBucket {
		singleFileResult, err = c.client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(conn.Path), // does not care if the path has a prefixed slash
		})
		if err != nil {
			// if the object doesn't exist, we can assume the prefix is a directory and continue
			var noKey *types.NoSuchKey
			var notFound *types.NotFound
			if !errors.As(err, &noKey) && !errors.As(err, &notFound) {
				return wshutil.SendErrCh[iochantypes.Packet](err)
			}
		}
	}

	// whether the operation is on a single file
	singleFile := singleFileResult != nil

	if !singleFile && !recursive {
		return wshutil.SendErrCh[iochantypes.Packet](fmt.Errorf(fstype.RecursiveRequiredError))
	}

	// whether to include the directory itself in the tar
	includeDir := (wholeBucket && conn.Path == "") || (singleFileResult == nil && conn.Path != "" && !strings.HasSuffix(conn.Path, fspath.Separator))

	timeout := fstype.DefaultTimeout
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	readerCtx, cancel := context.WithTimeout(context.Background(), timeout)

	// the prefix that should be removed from the tar paths
	tarPathPrefix := conn.Path

	if wholeBucket {
		// we treat the bucket name as the root directory. If we're not including the directory itself, we need to remove the bucket name from the tar paths
		if includeDir {
			tarPathPrefix = ""
		} else {
			tarPathPrefix = bucket
		}
	} else if singleFile || includeDir {
		// if we're including the directory itself, we need to remove the last part of the path
		tarPathPrefix = fsutil.GetParentPathString(tarPathPrefix)
	}

	rtn, writeHeader, fileWriter, tarClose := tarcopy.TarCopySrc(readerCtx, tarPathPrefix)
	go func() {
		defer func() {
			tarClose()
			cancel()
		}()

		// below we get the objects concurrently so we need to store the results in a map
		objMap := make(map[string]*s3.GetObjectOutput)
		// close the objects when we're done
		defer func() {
			for key, obj := range objMap {
				utilfn.GracefulClose(obj.Body, "s3fs", key)
			}
		}()

		// tree to keep track of the paths we've added and insert fake directories for subpaths
		tree := pathtree.NewTree(tarPathPrefix, "/")

		if singleFile {
			objMap[conn.Path] = singleFileResult
			tree.Add(conn.Path)
		} else {
			// list the objects in the bucket and add them to a tree that we can then walk to write the tar entries
			var input *s3.ListObjectsV2Input
			if wholeBucket {
				// get all the objects in the bucket
				input = &s3.ListObjectsV2Input{
					Bucket: aws.String(bucket),
				}
			} else {
				objectPrefix := conn.Path
				if !strings.HasSuffix(objectPrefix, fspath.Separator) {
					objectPrefix = objectPrefix + fspath.Separator
				}
				input = &s3.ListObjectsV2Input{
					Bucket: aws.String(bucket),
					Prefix: aws.String(objectPrefix),
				}
			}

			errs := make([]error, 0)
			// mutex to protect the tree and objMap since we're fetching objects concurrently
			treeMapMutex := sync.Mutex{}
			// wait group to await the finished fetches
			wg := sync.WaitGroup{}
			getObjectAndFileInfo := func(obj *types.Object) {
				defer wg.Done()
				result, err := c.client.GetObject(ctx, &s3.GetObjectInput{
					Bucket: aws.String(bucket),
					Key:    obj.Key,
				})
				if err != nil {
					errs = append(errs, err)
					return
				}
				path := *obj.Key
				if wholeBucket {
					path = fspath.Join(bucket, path)
				}
				treeMapMutex.Lock()
				defer treeMapMutex.Unlock()
				objMap[path] = result
				tree.Add(path)
			}

			if err := c.listFilesPrefix(ctx, input, func(obj *types.Object) (bool, error) {
				wg.Add(1)
				go getObjectAndFileInfo(obj)
				return true, nil
			}); err != nil {
				rtn <- wshutil.RespErr[iochantypes.Packet](err)
				return
			}
			wg.Wait()
			if len(errs) > 0 {
				rtn <- wshutil.RespErr[iochantypes.Packet](errors.Join(errs...))
				return
			}
		}

		// Walk the tree and write the tar entries
		if err := tree.Walk(func(path string, numChildren int) error {
			mapEntry, isFile := objMap[path]

			// default vals assume entry is dir, since mapEntry might not exist
			modTime := int64(time.Now().Unix())
			mode := fstype.DirMode
			size := int64(numChildren)

			if isFile {
				mode = fstype.FileMode
				size = *mapEntry.ContentLength
				if mapEntry.LastModified != nil {
					modTime = mapEntry.LastModified.UnixMilli()
				}
			}

			finfo := &wshrpc.FileInfo{
				Name:    path,
				IsDir:   !isFile,
				Size:    size,
				ModTime: modTime,
				Mode:    mode,
			}
			if err := writeHeader(fileutil.ToFsFileInfo(finfo), path, singleFile); err != nil {
				return err
			}
			if isFile {
				if n, err := io.Copy(fileWriter, mapEntry.Body); err != nil {
					return err
				} else if n != size {
					return fmt.Errorf("error copying %v; expected to read %d bytes, but read %d", path, size, n)
				}
			}
			return nil
		}); err != nil {
			log.Printf("error walking tree: %v", err)
			rtn <- wshutil.RespErr[iochantypes.Packet](err)
			return
		}
	}()
	// we've handed singleFileResult off to the tar writer, so we don't want to close it
	closeSingleFileResult = false
	return rtn
}

func (c S3Client) ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	var entries []*wshrpc.FileInfo
	rtnCh := c.ListEntriesStream(ctx, conn, opts)
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		resp := respUnion.Response
		entries = append(entries, resp.FileInfo...)
	}
	return entries, nil
}

func (c S3Client) ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	bucket := conn.Host
	objectKeyPrefix := conn.Path
	if objectKeyPrefix != "" && !strings.HasSuffix(objectKeyPrefix, fspath.Separator) {
		objectKeyPrefix = objectKeyPrefix + "/"
	}
	numToFetch := wshrpc.MaxDirSize
	if opts != nil && opts.Limit > 0 {
		numToFetch = min(opts.Limit, wshrpc.MaxDirSize)
	}
	numFetched := 0
	if bucket == "" || bucket == fspath.Separator {
		buckets, err := awsconn.ListBuckets(ctx, c.client)
		if err != nil {
			return wshutil.SendErrCh[wshrpc.CommandRemoteListEntriesRtnData](err)
		}
		var entries []*wshrpc.FileInfo
		for _, bucket := range buckets {
			if numFetched >= numToFetch {
				break
			}
			if bucket.Name != nil {
				entries = append(entries, &wshrpc.FileInfo{
					Path:     *bucket.Name,
					Name:     *bucket.Name,
					Dir:      fspath.Separator,
					ModTime:  bucket.CreationDate.UnixMilli(),
					IsDir:    true,
					MimeType: "directory",
				})
				numFetched++
			}
		}
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 1)
		defer close(rtn)
		rtn <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: entries}}
		return rtn
	} else {
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 16)
		// keep track of "directories" that have been used to avoid duplicates between pages
		prevUsedDirKeys := make(map[string]any)
		go func() {
			defer close(rtn)
			entryMap := make(map[string]*wshrpc.FileInfo)
			if err := c.listFilesPrefix(ctx, &s3.ListObjectsV2Input{
				Bucket: aws.String(bucket),
				Prefix: aws.String(objectKeyPrefix),
			}, func(obj *types.Object) (bool, error) {
				if numFetched >= numToFetch {
					return false, nil
				}
				lastModTime := int64(0)
				if obj.LastModified != nil {
					lastModTime = obj.LastModified.UnixMilli()
				}
				// get the first level directory name or file name
				name, isDir := fspath.FirstLevelDir(strings.TrimPrefix(*obj.Key, objectKeyPrefix))
				path := fspath.Join(conn.GetPathWithHost(), name)
				if isDir {
					if entryMap[name] == nil {
						if _, ok := prevUsedDirKeys[name]; !ok {
							entryMap[name] = &wshrpc.FileInfo{
								Path:    path,
								Name:    name,
								IsDir:   true,
								Dir:     objectKeyPrefix,
								ModTime: lastModTime,
								Size:    0,
							}
							fileutil.AddMimeTypeToFileInfo(path, entryMap[name])

							prevUsedDirKeys[name] = struct{}{}
							numFetched++
						}
					} else if entryMap[name].ModTime < lastModTime {
						entryMap[name].ModTime = lastModTime
					}
					return true, nil
				}

				size := int64(0)
				if obj.Size != nil {
					size = *obj.Size
				}
				entryMap[name] = &wshrpc.FileInfo{
					Name:    name,
					IsDir:   false,
					Dir:     objectKeyPrefix,
					Path:    path,
					ModTime: lastModTime,
					Size:    size,
				}
				fileutil.AddMimeTypeToFileInfo(path, entryMap[name])
				numFetched++
				return true, nil
			}); err != nil {
				rtn <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err)
				return
			}
			entries := make([]*wshrpc.FileInfo, 0, wshrpc.DirChunkSize)
			for _, entry := range entryMap {
				entries = append(entries, entry)
				if len(entries) == wshrpc.DirChunkSize {
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: entries}}
					entries = make([]*wshrpc.FileInfo, 0, wshrpc.DirChunkSize)
				}
			}
			if len(entries) > 0 {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: entries}}
			}
		}()
		return rtn
	}
}

func (c S3Client) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	bucketName := conn.Host
	objectKey := conn.Path
	if bucketName == "" || bucketName == fspath.Separator {
		// root, refers to list all buckets
		return &wshrpc.FileInfo{
			Name:     fspath.Separator,
			IsDir:    true,
			Size:     0,
			ModTime:  0,
			Path:     fspath.Separator,
			Dir:      fspath.Separator,
			MimeType: "directory",
		}, nil
	}
	if objectKey == "" || objectKey == fspath.Separator {
		_, err := c.client.HeadBucket(ctx, &s3.HeadBucketInput{
			Bucket: aws.String(bucketName),
		})
		exists := true
		if err != nil {
			var apiError smithy.APIError
			if errors.As(err, &apiError) {
				switch apiError.(type) {
				case *types.NotFound:
					exists = false
				default:
				}
			}
		}

		if exists {
			return &wshrpc.FileInfo{
				Name:     bucketName,
				Path:     bucketName,
				Dir:      fspath.Separator,
				IsDir:    true,
				Size:     0,
				ModTime:  0,
				MimeType: "directory",
			}, nil
		} else {
			return &wshrpc.FileInfo{
				Name:     bucketName,
				Path:     bucketName,
				Dir:      fspath.Separator,
				NotFound: true,
				IsDir:    true,
			}, nil
		}
	}
	result, err := c.client.GetObjectAttributes(ctx, &s3.GetObjectAttributesInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(objectKey),
		ObjectAttributes: []types.ObjectAttributes{
			types.ObjectAttributesObjectSize,
		},
	})
	if err != nil {
		var noKey *types.NoSuchKey
		var notFound *types.NotFound
		if errors.As(err, &noKey) || errors.As(err, &notFound) {
			// try to list a single object to see if the prefix exists
			if !strings.HasSuffix(objectKey, fspath.Separator) {
				objectKey += fspath.Separator
			}
			entries, err := c.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
				Bucket:  aws.String(bucketName),
				Prefix:  aws.String(objectKey),
				MaxKeys: aws.Int32(1),
			})
			if err == nil {
				if entries.Contents != nil {
					return &wshrpc.FileInfo{
						Name:     objectKey,
						Path:     conn.GetPathWithHost(),
						Dir:      fsutil.GetParentPath(conn),
						IsDir:    true,
						Size:     0,
						Mode:     fstype.DirMode,
						MimeType: "directory",
					}, nil
				}
			} else if !errors.As(err, &noKey) && !errors.As(err, &notFound) {
				return nil, err
			}

			return &wshrpc.FileInfo{
				Name:     objectKey,
				Path:     conn.GetPathWithHost(),
				Dir:      fsutil.GetParentPath(conn),
				IsDir:    true,
				NotFound: true,
			}, nil
		}
		return nil, err
	}
	size := int64(0)
	if result.ObjectSize != nil {
		size = *result.ObjectSize
	}
	lastModified := int64(0)
	if result.LastModified != nil {
		lastModified = result.LastModified.UnixMilli()
	}
	rtn := &wshrpc.FileInfo{
		Name:    objectKey,
		Path:    conn.GetPathWithHost(),
		Dir:     fsutil.GetParentPath(conn),
		IsDir:   false,
		Size:    size,
		ModTime: lastModified,
	}
	fileutil.AddMimeTypeToFileInfo(rtn.Path, rtn)
	return rtn, nil
}

func (c S3Client) PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	if data.At != nil {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("file data offset and size not supported"))
	}
	bucket := conn.Host
	objectKey := conn.Path
	if bucket == "" || bucket == "/" || objectKey == "" || objectKey == "/" {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("bucket and object key must be specified"))
	}
	contentMaxLength := base64.StdEncoding.DecodedLen(len(data.Data64))
	var decodedBody []byte
	var contentLength int
	var err error
	if contentMaxLength > 0 {
		decodedBody = make([]byte, contentMaxLength)
		contentLength, err = base64.StdEncoding.Decode(decodedBody, []byte(data.Data64))
		if err != nil {
			return err
		}
	} else {
		decodedBody = []byte("\n")
		contentLength = 1
	}
	bodyReaderSeeker := bytes.NewReader(decodedBody[:contentLength])
	_, err = c.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(objectKey),
		Body:          bodyReaderSeeker,
		ContentLength: aws.Int64(int64(contentLength)),
	})
	if err != nil {
		log.Printf("PutFile: error putting object %v:%v: %v", bucket, objectKey, err)
	}
	return err
}

func (c S3Client) AppendFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	return errors.Join(errors.ErrUnsupported, fmt.Errorf("append file not supported"))
}

func (c S3Client) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	return errors.Join(errors.ErrUnsupported, fmt.Errorf("mkdir not supported"))
}

func (c S3Client) MoveInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	isDir, err := c.CopyInternal(ctx, srcConn, destConn, opts)
	if err != nil {
		return err
	}
	recursive := opts != nil && opts.Recursive
	return c.Delete(ctx, srcConn, recursive && isDir)
}

func (c S3Client) CopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, srcClient fstype.FileShareClient, opts *wshrpc.FileCopyOpts) (bool, error) {
	if srcConn.Scheme == connparse.ConnectionTypeS3 && destConn.Scheme == connparse.ConnectionTypeS3 {
		return c.CopyInternal(ctx, srcConn, destConn, opts)
	}
	destBucket := destConn.Host
	if destBucket == "" || destBucket == fspath.Separator {
		return false, fmt.Errorf("destination bucket must be specified")
	}
	return fsutil.PrefixCopyRemote(ctx, srcConn, destConn, srcClient, c, func(bucket, path string, size int64, reader io.Reader) error {
		_, err := c.client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:        aws.String(bucket),
			Key:           aws.String(path),
			Body:          reader,
			ContentLength: aws.Int64(size),
		})
		return err
	}, opts)
}

func (c S3Client) CopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error) {
	srcBucket := srcConn.Host
	destBucket := destConn.Host
	if srcBucket == "" || srcBucket == fspath.Separator || destBucket == "" || destBucket == fspath.Separator {
		return false, fmt.Errorf("source and destination bucket must be specified")
	}
	return fsutil.PrefixCopyInternal(ctx, srcConn, destConn, c, opts, func(ctx context.Context, bucket, prefix string) ([]string, error) {
		var entries []string
		err := c.listFilesPrefix(ctx, &s3.ListObjectsV2Input{
			Bucket: aws.String(bucket),
			Prefix: aws.String(prefix),
		}, func(obj *types.Object) (bool, error) {
			entries = append(entries, *obj.Key)
			return true, nil
		})
		return entries, err
	}, func(ctx context.Context, srcPath, destPath string) error {
		_, err := c.client.CopyObject(ctx, &s3.CopyObjectInput{
			Bucket:     aws.String(destBucket),
			Key:        aws.String(destPath),
			CopySource: aws.String(fspath.Join(srcBucket, srcPath)),
		})
		if err != nil {
			return fmt.Errorf("error copying %v:%v to %v:%v: %w", srcBucket, srcPath, destBucket, destPath, err)
		}
		return nil
	})
}

func (c S3Client) Delete(ctx context.Context, conn *connparse.Connection, recursive bool) error {
	bucket := conn.Host
	objectKey := conn.Path
	if bucket == "" || bucket == fspath.Separator {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("bucket must be specified"))
	}
	if objectKey == "" || objectKey == fspath.Separator {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("object key must be specified"))
	}
	var err error
	if recursive {
		log.Printf("Deleting objects with prefix %v:%v", bucket, objectKey)
		if !strings.HasSuffix(objectKey, fspath.Separator) {
			objectKey = objectKey + fspath.Separator
		}
		objects := make([]types.ObjectIdentifier, 0)
		err = c.listFilesPrefix(ctx, &s3.ListObjectsV2Input{
			Bucket: aws.String(bucket),
			Prefix: aws.String(objectKey),
		}, func(obj *types.Object) (bool, error) {
			objects = append(objects, types.ObjectIdentifier{Key: obj.Key})
			return true, nil
		})
		if err != nil {
			return err
		}
		if len(objects) == 0 {
			return nil
		}
		_, err = c.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(bucket),
			Delete: &types.Delete{
				Objects: objects,
			},
		})
	} else {
		log.Printf("Deleting object %v:%v", bucket, objectKey)
		_, err = c.client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(objectKey),
		})
	}
	if err != nil {
		return err
	}

	// verify the object was deleted
	finfo, err := c.Stat(ctx, conn)
	if err != nil {
		return err
	}
	if !finfo.NotFound {
		if finfo.IsDir {
			return fmt.Errorf(fstype.RecursiveRequiredError)
		}
		return fmt.Errorf("object was not successfully deleted %v:%v", bucket, objectKey)
	}
	return nil
}

func (c S3Client) listFilesPrefix(ctx context.Context, input *s3.ListObjectsV2Input, fileCallback func(*types.Object) (bool, error)) error {
	var err error
	var output *s3.ListObjectsV2Output
	objectPaginator := s3.NewListObjectsV2Paginator(c.client, input)
	for objectPaginator.HasMorePages() {
		output, err = objectPaginator.NextPage(ctx)
		if err != nil {
			var noBucket *types.NoSuchBucket
			if !awsconn.CheckAccessDeniedErr(&err) && errors.As(err, &noBucket) {
				err = noBucket
			}
			return err
		} else {
			for _, obj := range output.Contents {
				if cont, err := fileCallback(&obj); err != nil {
					return err
				} else if !cont {
					return nil
				}
			}
		}
	}
	return nil
}

func (c S3Client) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (*wshrpc.FileInfo, error) {
	var joinParts []string
	if conn.Path == "" || conn.Path == fspath.Separator {
		joinParts = parts
	} else {
		joinParts = append([]string{conn.Path}, parts...)
	}

	conn.Path = fspath.Join(joinParts...)
	return c.Stat(ctx, conn)
}

func (c S3Client) GetConnectionType() string {
	return connparse.ConnectionTypeS3
}

func (c S3Client) GetCapability() wshrpc.FileShareCapability {
	return wshrpc.FileShareCapability{
		CanAppend: false,
		CanMkdir:  false,
	}
}
