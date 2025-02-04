// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package s3fs

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
	"path"
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
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/pathtree"
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
	var singleFileObj *s3.GetObjectOutput
	var err error
	if !wholeBucket {
		singleFileObj, err = c.client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(objectPrefix),
		})
		if err != nil {
			var noKey *types.NoSuchKey
			if errors.As(err, &noKey) {
				log.Printf("Can't get object %s from bucket %s. No such key exists.\n", objectPrefix, bucket)
				return wshutil.SendErrCh[iochantypes.Packet](noKey)
			}
			return wshutil.SendErrCh[iochantypes.Packet](err)
		}
	}
	singleFile := singleFileObj != nil
	includeDir := singleFileObj == nil && objectPrefix != "" && !strings.HasSuffix(objectPrefix, "/")

	timeout := fstype.DefaultTimeout
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	readerCtx, cancel := context.WithTimeout(context.Background(), timeout)

	tarPathPrefix := conn.Path
	if singleFile || includeDir {
		tarPathPrefix = path.Dir(objectPrefix)
		if tarPathPrefix != "" && !strings.HasSuffix(tarPathPrefix, "/") {
			tarPathPrefix = tarPathPrefix + "/"
		}
	}

	rtn, writeHeader, fileWriter, tarClose := tarcopy.TarCopySrc(readerCtx, tarPathPrefix)

	go func() {
		defer func() {
			tarClose()
			cancel()
		}()

		writeFileAndHeader := func(objOutput *s3.GetObjectOutput, objKey string) error {
			modTime := int64(0)
			if objOutput != nil && objOutput.LastModified != nil {
				modTime = objOutput.LastModified.UnixMilli()
			}
			size := int64(-1)
			if objOutput != nil && objOutput.ContentLength != nil {
				size = *objOutput.ContentLength
			}
			finfo := &wshrpc.FileInfo{
				Name:    objKey,
				IsDir:   objOutput == nil,
				Size:    size,
				ModTime: modTime,
				Mode:    0644,
			}
			if err := writeHeader(fileutil.ToFsFileInfo(finfo), objKey); err != nil {
				return err
			}
			if objOutput != nil {
				base64Reader := base64.NewDecoder(base64.StdEncoding, objOutput.Body)
				if _, err := io.Copy(fileWriter, base64Reader); err != nil {
					return err
				}
			}
			return nil
		}

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

			if err := writeFileAndHeader(result, conn.Path); err != nil {
				rtn <- wshutil.RespErr[iochantypes.Packet](err)
				return
			}
		} else {
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

			// Make sure that the tree and outputMap are thread-safe
			treeMutex := sync.Mutex{}
			tree := pathtree.NewTree(tarPathPrefix, "/")
			outputMap := make(map[string]*s3.GetObjectOutput)

			defer func() {
				for _, obj := range outputMap {
					if obj != nil {
						obj.Body.Close()
					}
				}
			}()

			// Fetch all the matching objects concurrently
			var output *s3.ListObjectsV2Output
			wg := sync.WaitGroup{}
			objectPaginator := s3.NewListObjectsV2Paginator(c.client, input)
			for objectPaginator.HasMorePages() {
				output, err = objectPaginator.NextPage(ctx)
				if err != nil {
					rtn <- wshutil.RespErr[iochantypes.Packet](err)
					return
				}
				errs := make([]error, 0)
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
					treeMutex.Lock()
					defer treeMutex.Unlock()
					outputMap[*obj.Key] = result
					tree.Add(*obj.Key)
				}
				for _, obj := range output.Contents {
					wg.Add(1)
					go getObjectAndFileInfo(&obj)
				}
				if len(errs) > 0 {
					rtn <- wshutil.RespErr[iochantypes.Packet](errors.Join(errs...))
					return
				}
			}

			wg.Wait()

			// Walk the tree and write the tar entries
			tree.Walk(func(path string, _ bool) error {
				mapEntry := outputMap[path]
				return writeFileAndHeader(mapEntry, path)
			})
		}
	}()
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

	destBucket := destConn.Host
	overwrite := opts != nil && opts.Overwrite
	merge := opts != nil && opts.Merge
	if destBucket == "" || destBucket == "/" {
		return fmt.Errorf("destination bucket must be specified")
	}

	var entries []*wshrpc.FileInfo
	_, err := c.Stat(ctx, destConn)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			entries, err = c.ListEntries(ctx, destConn, nil)
			if err != nil {
				return err
			}
			if len(entries) > 0 {
				if overwrite {
					err := c.Delete(ctx, destConn, true)
					if err != nil {
						return err
					}
				} else if !merge {
					return fmt.Errorf("more than one entry exists at prefix, neither force nor merge specified")
				}
			}
		} else {
			return err
		}
	} else if !overwrite {
		return fmt.Errorf("destination already exists, use force to overwrite: %v", destConn.GetFullURI())
	}

	destPrefix := destConn.Path
	// Make sure destPrefix has a trailing slash if the destination is a "directory"
	if destPrefix != "" && entries != nil && !strings.HasSuffix(destPrefix, "/") {
		destPrefix = destPrefix + "/"
	}

	readCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	ioch := srcClient.ReadTarStream(readCtx, srcConn, opts)
	err = tarcopy.TarCopyDest(readCtx, cancel, ioch, func(next *tar.Header, reader *tar.Reader) error {
		log.Printf("copying %v", next.Name)
		if next.Typeflag == tar.TypeDir {
			return nil
		}
		fileName, err := cleanPath(path.Join(destPrefix, next.Name))
		log.Printf("cleaned path: %v", fileName)
		if !overwrite {
			for _, entry := range entries {
				if entry.Name == fileName {
					return fmt.Errorf("destination already exists: %v", fileName)
				}
			}
		}
		_, err = c.client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:        aws.String(destBucket),
			Key:           aws.String(fileName),
			Body:          reader,
			ContentLength: aws.Int64(next.Size),
		})
		return err
	})
	if err != nil {
		cancel(err)
		return err
	}
	return nil
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

func getPathPrefix(conn *connparse.Connection) string {
	fullUri := conn.GetFullURI()
	pathPrefix := fullUri
	lastSlash := strings.LastIndex(fullUri, "/")
	if lastSlash > 10 && lastSlash < len(fullUri)-1 {
		pathPrefix = fullUri[:lastSlash+1]
	}
	return pathPrefix
}

func cleanPath(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}
	if strings.HasPrefix(path, "/") {
		path = path[1:]
	}
	if strings.HasPrefix(path, "~") || strings.HasPrefix(path, ".") || strings.HasPrefix(path, "..") {
		return "", fmt.Errorf("s3 path cannot start with ~, ., or ..")
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
