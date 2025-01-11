// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package s3fs

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

func (c S3Client) Read(ctx context.Context, path string) (*fstype.FullFile, error) {
	return nil, nil
}

func (c S3Client) Stat(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	return nil, nil
}

func (c S3Client) PutFile(ctx context.Context, data wshrpc.FileData) error {
	return nil
}

func (c S3Client) Mkdir(ctx context.Context, path string) error {
	return nil
}

func (c S3Client) Move(ctx context.Context, srcPath, destPath string, recursive bool) error {
	return nil
}

func (c S3Client) Copy(ctx context.Context, srcPath, destPath string, recursive bool) error {
	return nil
}

func (c S3Client) Delete(ctx context.Context, path string) error {
	return nil
}

func (c S3Client) GetConnectionType() string {
	return remote.ConnectionTypeWsh
}
