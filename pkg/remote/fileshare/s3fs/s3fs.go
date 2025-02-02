// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package s3fs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/wavetermdev/waveterm/pkg/remote/awsconn"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/util/tarcopy"
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
	return fileutil.ReadStreamToFileData(ctx, rtnCh)
}

func (c S3Client) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	bucket := conn.Host
	objectKey := conn.Path
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 16)
	go func() {
		defer close(rtn)
		if bucket == "" || bucket == "/" || objectKey == "" || objectKey == "/" {
			entries, err := c.ListEntries(ctx, conn, nil)
			if err != nil {
				rtn <- wshutil.RespErr[wshrpc.FileData](err)
				return
			}
			entryBuf := make([]*wshrpc.FileInfo, 0, wshrpc.DirChunkSize)
			for _, entry := range entries {
				entryBuf = append(entryBuf, entry)
				if len(entryBuf) == wshrpc.DirChunkSize {
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: entryBuf}}
					entryBuf = make([]*wshrpc.FileInfo, 0, wshrpc.DirChunkSize)
				}
			}
			if len(entryBuf) > 0 {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: entryBuf}}
			}
			return
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
				log.Printf("reading %v", conn.GetFullURI())
				result, err = c.client.GetObject(ctx, &s3.GetObjectInput{
					Bucket: aws.String(bucket),
					Key:    aws.String(objectKey),
				})
			}
			if err != nil {
				log.Printf("error getting object %v:%v: %v", bucket, objectKey, err)
				var noKey *types.NoSuchKey
				if errors.As(err, &noKey) {
					log.Printf("Can't get object %s from bucket %s. No such key exists.\n", objectKey, bucket)
					err = noKey
				} else {
					log.Printf("Couldn't get object %v:%v. Here's why: %v\n", bucket, objectKey, err)
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
			}
			log.Printf("file info: %v", finfo)
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Info: finfo}}
			if size == 0 {
				log.Printf("no data to read")
				return
			}
			defer result.Body.Close()
			bytesRemaining := size
			for {
				log.Printf("bytes remaining: %d", bytesRemaining)
				select {
				case <-ctx.Done():
					log.Printf("context done")
					rtn <- wshutil.RespErr[wshrpc.FileData](ctx.Err())
					return
				default:
					buf := make([]byte, min(bytesRemaining, wshrpc.FileChunkSize))
					n, err := result.Body.Read(buf)
					if err != nil && !errors.Is(err, io.EOF) {
						rtn <- wshutil.RespErr[wshrpc.FileData](err)
						return
					}
					log.Printf("read %d bytes", n)
					if n == 0 {
						break
					}
					bytesRemaining -= int64(n)
					rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Data64: string(buf)}}
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

	bucket := conn.Host
	if bucket == "" || bucket == "/" {
		return wshutil.SendErrCh[iochantypes.Packet](fmt.Errorf("bucket must be specified"))
	}

	objectPrefix := conn.Path

	wholeBucket := objectPrefix == "" || objectPrefix == "/"
	singleFile := false
	includeDir := false
	if !wholeBucket {
		finfo, err := c.Stat(ctx, conn)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return wshutil.SendErrCh[iochantypes.Packet](err)
		}
		if finfo != nil && !finfo.IsDir {
			singleFile = true
		} else if strings.HasSuffix(objectPrefix, "/") {
			includeDir = true
		}
	}

	timeout := fstype.DefaultTimeout

	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}

	readerCtx, cancel := context.WithTimeout(context.Background(), timeout)

	pathPrefix := conn.Path
	if includeDir || singleFile {
		pathPrefix = getParentPath(conn)
	}

	rtn, writeHeader, fileWriter, tarClose := tarcopy.TarCopySrc(readerCtx, pathPrefix)

	go func() {
		defer func() {
			tarClose()
			cancel()
		}()

		if singleFile {
			result, err := c.client.GetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(conn.Path),
			})

			if err != nil {
				rtn <- wshutil.RespErr[iochantypes.Packet](err)
				return
			}

			defer result.Body.Close()

			finfo := &wshrpc.FileInfo{
				Name:    conn.Path,
				IsDir:   false,
				Size:    *result.ContentLength,
				ModTime: result.LastModified.UnixMilli(),
			}

			if err := writeHeader(fileutil.ToFsFileInfo(finfo), conn.Path); err != nil {
				rtn <- wshutil.RespErr[iochantypes.Packet](err)
				return
			}

			if _, err := io.Copy(fileWriter, result.Body); err != nil {
				rtn <- wshutil.RespErr[iochantypes.Packet](err)
				return
			}
		} else {
			var err error
			var output *s3.ListObjectsV2Output
			var input *s3.ListObjectsV2Input
			if wholeBucket {
				input = &s3.ListObjectsV2Input{
					Bucket: aws.String(bucket),
				}
			} else {
				objectPrefix := conn.Path
				if !strings.HasSuffix(objectPrefix, "/") {
					objectPrefix = objectPrefix + "/"
				}
				input = &s3.ListObjectsV2Input{
					Bucket: aws.String(bucket),
					Prefix: aws.String(objectPrefix),
				}
			}
			objectPaginator := s3.NewListObjectsV2Paginator(c.client, input)
			for objectPaginator.HasMorePages() {
				output, err = objectPaginator.NextPage(ctx)
				if err != nil {
					rtn <- wshutil.RespErr[iochantypes.Packet](err)
					return
				}
				nextObjs := make(map[int]struct {
					finfo  *wshrpc.FileInfo
					result *s3.GetObjectOutput
				}, len(output.Contents))
				errs := make([]error, 0)
				wg := sync.WaitGroup{}
				defer func() {
					for _, obj := range nextObjs {
						if obj.result != nil {
							obj.result.Body.Close()
						}
					}
				}()
				getObjectAndFileInfo := func(obj *types.Object, index int) {
					defer wg.Done()
					result, err := c.client.GetObject(ctx, &s3.GetObjectInput{
						Bucket: aws.String(bucket),
						Key:    obj.Key,
					})
					if err != nil {
						errs = append(errs, err)
						return
					}
					finfo := &wshrpc.FileInfo{
						Name:    *obj.Key,
						IsDir:   false,
						Size:    *obj.Size,
						ModTime: result.LastModified.UnixMilli(),
					}
					nextObjs[index] = struct {
						finfo  *wshrpc.FileInfo
						result *s3.GetObjectOutput
					}{
						finfo:  finfo,
						result: result,
					}
				}
				for _, obj := range output.Contents {
					wg.Add(1)
					go getObjectAndFileInfo(&obj, len(nextObjs))
				}
				wg.Wait()
				if len(errs) > 0 {
					rtn <- wshutil.RespErr[iochantypes.Packet](errors.Join(errs...))
					return
				}
				for _, obj := range nextObjs {
					if err := writeHeader(fileutil.ToFsFileInfo(obj.finfo), obj.finfo.Name); err != nil {
						rtn <- wshutil.RespErr[iochantypes.Packet](err)
						return
					}
					if _, err := io.Copy(fileWriter, obj.result.Body); err != nil {
						rtn <- wshutil.RespErr[iochantypes.Packet](err)
						return
					}
				}
			}
		}
	}()

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

var slashRe = regexp.MustCompile(`/`)

func (c S3Client) ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	bucket := conn.Host
	objectKeyPrefix := conn.Path
	if objectKeyPrefix != "" && !strings.HasSuffix(objectKeyPrefix, "/") {
		objectKeyPrefix = objectKeyPrefix + "/"
	}
	numToFetch := wshrpc.MaxDirSize
	if opts != nil && opts.Limit > 0 {
		numToFetch = min(opts.Limit, wshrpc.MaxDirSize)
	}
	numFetched := 0
	if bucket == "" || bucket == "/" {
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
					Path:    fmt.Sprintf("%s://%s/", conn.Scheme, *bucket.Name), // add trailing slash to indicate directory
					Name:    *bucket.Name,
					ModTime: bucket.CreationDate.UnixMilli(),
					IsDir:   true,
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
			var err error
			var output *s3.ListObjectsV2Output
			input := &s3.ListObjectsV2Input{
				Bucket: aws.String(bucket),
				Prefix: aws.String(objectKeyPrefix),
			}
			objectPaginator := s3.NewListObjectsV2Paginator(c.client, input)
			parentPath := getParentPathUri(conn)
			if parentPath != "" {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: []*wshrpc.FileInfo{
					{
						Path:  parentPath,
						Name:  "..",
						IsDir: true,
						Size:  -1,
					},
				}}}
			}
			for objectPaginator.HasMorePages() {
				output, err = objectPaginator.NextPage(ctx)
				if err != nil {
					var noBucket *types.NoSuchBucket
					if !awsconn.CheckAccessDeniedErr(&err) && errors.As(err, &noBucket) {
						err = noBucket
					}
					rtn <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err)
					break
				} else {
					entryMap := make(map[string]*wshrpc.FileInfo, len(output.Contents))
					for _, obj := range output.Contents {
						if numFetched >= numToFetch {
							break
						}
						lastModTime := int64(0)
						if obj.LastModified != nil {
							lastModTime = obj.LastModified.UnixMilli()
						}
						if obj.Key != nil && len(*obj.Key) > len(objectKeyPrefix) {
							name := strings.TrimPrefix(*obj.Key, objectKeyPrefix)
							if strings.Count(name, "/") > 0 {
								name = strings.SplitN(name, "/", 2)[0]
								name = name + "/" // add trailing slash to indicate directory
								if entryMap[name] == nil {
									if _, ok := prevUsedDirKeys[name]; !ok {
										entryMap[name] = &wshrpc.FileInfo{
											Path:    conn.GetFullURI() + name,
											Name:    name,
											IsDir:   true,
											Dir:     objectKeyPrefix,
											ModTime: lastModTime,
											Size:    -1,
										}
										prevUsedDirKeys[name] = struct{}{}
										numFetched++
									}
								} else if entryMap[name].ModTime < lastModTime {
									entryMap[name].ModTime = lastModTime
								}
								continue
							}

							size := int64(0)
							if obj.Size != nil {
								size = *obj.Size
							}
							entryMap[name] = &wshrpc.FileInfo{
								Name:    name,
								IsDir:   false,
								Dir:     objectKeyPrefix,
								Path:    conn.GetFullURI() + name,
								ModTime: lastModTime,
								Size:    size,
							}
							numFetched++
						}
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
				}
				if numFetched >= numToFetch {
					return
				}
			}
		}()
		return rtn
	}
}

func (c S3Client) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	bucketName := conn.Host
	objectKey := conn.Path
	if bucketName == "" || bucketName == "/" {
		return &wshrpc.FileInfo{
			Name:    "/",
			IsDir:   true,
			Size:    -1,
			ModTime: 0,
			Path:    fmt.Sprintf("%s://", conn.Scheme),
		}, nil
	}
	if objectKey == "" || objectKey == "/" {
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
					err = nil
				default:
				}
			}
		}

		if exists {
			return &wshrpc.FileInfo{
				Name:    bucketName,
				IsDir:   true,
				Size:    -1,
				ModTime: 0,
			}, nil
		} else {
			return nil, fmt.Errorf("bucket %v does not exist", bucketName)
		}
	}
	result, err := c.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		var noKey *types.NoSuchKey
		var notFound *types.NotFound
		if errors.As(err, &noKey) || errors.As(err, &notFound) {
			err = fs.ErrNotExist
		} else {
			log.Printf("Couldn't get object %v:%v. Here's why: %v\n", bucketName, objectKey, err)
		}
		return nil, err
	}
	size := int64(0)
	if result.ContentLength != nil {
		size = *result.ContentLength
	}
	lastModified := int64(0)
	if result.LastModified != nil {
		lastModified = result.LastModified.UnixMilli()
	}
	return &wshrpc.FileInfo{
		Name:    objectKey,
		Path:    conn.GetFullURI(),
		Dir:     getParentPathUri(conn),
		IsDir:   false,
		Size:    size,
		ModTime: lastModified,
	}, nil
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
	_, err := c.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(objectKey),
		Body:   bytes.NewReader([]byte(data.Data64)),
	})
	return err
}

func (c S3Client) AppendFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	return errors.Join(errors.ErrUnsupported, fmt.Errorf("append file not supported"))
}

func (c S3Client) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	return errors.Join(errors.ErrUnsupported, fmt.Errorf("mkdir not supported"))
}

func (c S3Client) MoveInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	err := c.CopyInternal(ctx, srcConn, destConn, opts)
	if err != nil {
		return err
	}
	return c.Delete(ctx, srcConn, true)
}

func (c S3Client) CopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, srcClient fstype.FileShareClient, opts *wshrpc.FileCopyOpts) error {
	return errors.ErrUnsupported
}

func (c S3Client) CopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	srcBucket := srcConn.Host
	srcKey := srcConn.Path
	destBucket := destConn.Host
	destKey := destConn.Path
	if srcBucket == "" || srcBucket == "/" || srcKey == "" || srcKey == "/" || destBucket == "" || destBucket == "/" || destKey == "" || destKey == "/" {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("source and destination bucket and object key must be specified"))
	}
	_, err := c.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(destBucket),
		Key:        aws.String(destKey),
		CopySource: aws.String(fmt.Sprintf("%s/%s", srcBucket, srcKey)),
	})
	return err
}

func (c S3Client) Delete(ctx context.Context, conn *connparse.Connection, recursive bool) error {
	bucket := conn.Host
	objectKey := conn.Path
	if bucket == "" || bucket == "/" {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("bucket must be specified"))
	}
	if objectKey == "" || objectKey == "/" {
		return errors.Join(errors.ErrUnsupported, fmt.Errorf("object key must be specified"))
	}
	if recursive {
		if !strings.HasSuffix(objectKey, "/") {
			objectKey = objectKey + "/"
		}
		entries, err := c.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket: aws.String(bucket),
			Prefix: aws.String(objectKey),
		})
		if err != nil {
			return err
		}
		if len(entries.Contents) == 0 {
			return nil
		}
		objects := make([]types.ObjectIdentifier, 0, len(entries.Contents))
		for _, obj := range entries.Contents {
			objects = append(objects, types.ObjectIdentifier{Key: obj.Key})
		}
		_, err = c.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(bucket),
			Delete: &types.Delete{
				Objects: objects,
			},
		})
		return err
	}
	_, err := c.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(objectKey),
	})
	return err
}

func (c S3Client) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (string, error) {
	var joinParts []string
	if conn.Host == "" || conn.Host == "/" {
		if conn.Path == "" || conn.Path == "/" {
			joinParts = parts
		} else {
			joinParts = append([]string{conn.Path}, parts...)
		}
	} else if conn.Path == "" || conn.Path == "/" {
		joinParts = append([]string{conn.Host}, parts...)
	} else {
		joinParts = append([]string{conn.Host, conn.Path}, parts...)
	}

	return fmt.Sprintf("%s://%s", conn.Scheme, strings.Join(joinParts, "/")), nil
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

func getParentPathUri(conn *connparse.Connection) string {
	parentPath := getParentPath(conn)
	if parentPath == "" {
		return ""
	}
	return fmt.Sprintf("%s://%s", conn.Scheme, parentPath)
}

func getParentPath(conn *connparse.Connection) string {
	var parentPath string
	hostAndPath := conn.GetPathWithHost()
	slashIndices := slashRe.FindAllStringIndex(hostAndPath, -1)
	if slashIndices != nil && len(slashIndices) > 0 {
		if slashIndices[len(slashIndices)-1][0] != len(hostAndPath)-1 {
			parentPath = hostAndPath[:slashIndices[len(slashIndices)-1][0]+1]
		} else if len(slashIndices) > 1 {
			parentPath = hostAndPath[:slashIndices[len(slashIndices)-2][0]+1]
		}
	}
	return parentPath
}
