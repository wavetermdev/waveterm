// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package s3fs

import (
	"context"
	"errors"
	"log"
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
	return wshutil.SendErrCh[wshrpc.FileData](errors.ErrUnsupported)
}

func (c S3Client) ReadTarStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileCopyOpts) <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet] {
	return wshutil.SendErrCh[iochantypes.Packet](errors.ErrUnsupported)
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
	if conn.Host == "" || conn.Host == "/" {
		buckets, err := awsconn.ListBuckets(ctx, c.client)
		if err != nil {
			return wshutil.SendErrCh[wshrpc.CommandRemoteListEntriesRtnData](err)
		}
		var entries []*wshrpc.FileInfo
		for _, bucket := range buckets {
			log.Printf("bucket: %v", *bucket.Name)
			if bucket.Name != nil {
				entries = append(entries, &wshrpc.FileInfo{
					Path:  *bucket.Name,
					IsDir: true,
				})
			}
		}
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 1)
		defer close(rtn)
		rtn <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: entries}}
		return rtn
	} else {
		rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 16)
		go func() {
			defer close(rtn)
			var err error
			var output *s3.ListObjectsV2Output
			input := &s3.ListObjectsV2Input{
				Bucket: aws.String(conn.Host),
				Prefix: aws.String(conn.Path),
			}
			objectPaginator := s3.NewListObjectsV2Paginator(c.client, input)
			for objectPaginator.HasMorePages() {
				output, err = objectPaginator.NextPage(ctx)
				if err != nil {
					var noBucket *types.NoSuchBucket
					if errors.As(err, &noBucket) {
						log.Printf("Bucket %s does not exist.\n", conn.Host)
						err = noBucket
					}
					rtn <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err)
					break
				} else {
					entryMap := make(map[string]*wshrpc.FileInfo, len(output.Contents))
					for _, obj := range output.Contents {
						if obj.Key != nil {
							name := strings.TrimPrefix(*obj.Key, conn.Path)
							if strings.Count(name, "/") > 1 {
								if entryMap[name] == nil {
									name = strings.SplitN(name, "/", 2)[0]
									entryMap[name] = &wshrpc.FileInfo{
										Name:  name + "/", // add trailing slash to indicate directory
										IsDir: true,
										Dir:   conn.Path,
										Size:  -1,
									}
								}
								continue
							}
							size := int64(0)
							if obj.Size != nil {
								size = *obj.Size
							}
							entryMap[name] = &wshrpc.FileInfo{
								Name:  name,
								IsDir: false,
								Dir:   conn.Path,
								Size:  size,
							}
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
