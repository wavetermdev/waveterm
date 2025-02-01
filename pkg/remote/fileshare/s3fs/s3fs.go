// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package s3fs

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/wavetermdev/waveterm/pkg/remote/awsconn"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
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
	return nil, errors.ErrUnsupported
}

func (c S3Client) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	if conn.Host == "" || conn.Host == "/" {
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 1)
		defer close(rtn)
		entries, err := c.ListEntries(ctx, conn, nil)
		if err != nil {
			rtn <- wshutil.RespErr[wshrpc.FileData](err)
			return rtn
		}
		rtn <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: entries}}
		return rtn
	} else {
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 1)
		defer close(rtn)
		rtn <- wshutil.RespErr[wshrpc.FileData](errors.ErrUnsupported)
		return rtn
	}
}

func (c S3Client) ReadTarStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileCopyOpts) <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet] {
	return wshutil.SendErrCh[iochantypes.Packet](errors.ErrUnsupported)
}

func (c S3Client) ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	var entries []*wshrpc.FileInfo
	rtnCh := c.ListEntriesStream(ctx, conn, opts)
	for respUnion := range rtnCh {
		log.Printf("respUnion: %v", respUnion)
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
	numToFetch := wshrpc.MaxDirSize
	if opts != nil && opts.Limit > 0 {
		numToFetch = min(opts.Limit, wshrpc.MaxDirSize)
	}
	numFetched := 0
	if conn.Host == "" || conn.Host == "/" {
		buckets, err := awsconn.ListBuckets(ctx, c.client)
		if err != nil {
			log.Printf("error listing buckets: %v", err)
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
				Bucket: aws.String(conn.Host),
				Prefix: aws.String(conn.Path),
			}
			objectPaginator := s3.NewListObjectsV2Paginator(c.client, input)
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

			if parentPath != "" {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: []*wshrpc.FileInfo{
					{
						Path:  fmt.Sprintf("%s://%s", conn.Scheme, parentPath),
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
						log.Printf("Bucket %s does not exist.\n", conn.Host)
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
						if obj.Key != nil && len(*obj.Key) > len(conn.Path) {
							name := strings.TrimPrefix(*obj.Key, conn.Path)
							if strings.Count(name, "/") > 0 {
								name = strings.SplitN(name, "/", 2)[0]
								name = name + "/" // add trailing slash to indicate directory
								if entryMap[name] == nil {
									if _, ok := prevUsedDirKeys[name]; !ok {
										entryMap[name] = &wshrpc.FileInfo{
											Path:    conn.GetFullURI() + name,
											Name:    name,
											IsDir:   true,
											Dir:     conn.Path,
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
								Dir:     conn.Path,
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
	return nil, errors.ErrUnsupported
}

func (c S3Client) PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	return errors.ErrUnsupported
}

func (c S3Client) AppendFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	return errors.ErrUnsupported
}

func (c S3Client) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	return errors.ErrUnsupported
}

func (c S3Client) MoveInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	return errors.ErrUnsupported
}

func (c S3Client) CopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, srcClient fstype.FileShareClient, opts *wshrpc.FileCopyOpts) error {
	return errors.ErrUnsupported
}

func (c S3Client) CopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	return errors.ErrUnsupported
}

func (c S3Client) Delete(ctx context.Context, conn *connparse.Connection, recursive bool) error {
	return errors.ErrUnsupported
}

func (c S3Client) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (string, error) {
	return "", errors.ErrUnsupported
}

func (c S3Client) GetConnectionType() string {
	return connparse.ConnectionTypeS3
}
