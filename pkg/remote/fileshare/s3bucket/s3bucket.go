package s3bucket

import (
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare"
)

type S3Bucket struct {
	client *s3.Client
}

var _ fileshare.FileShare = S3Bucket{}

func NewS3Bucket(config aws.Config) *S3Bucket {
	return &S3Bucket{
		client: s3.NewFromConfig(config),
	}
}

func (s S3Bucket) GetFile(path string) ([]byte, error) {
	return nil, nil
}

func (s S3Bucket) StatFile(path string) (any, error) {
	return nil, nil
}

func (s S3Bucket) PutFile(path string, data []byte) error {
	return nil
}

func (s S3Bucket) MoveFile(srcPath, destPath string) error {
	return nil
}

func (s S3Bucket) DeleteFile(path string) error {
	return nil
}

func (s S3Bucket) ListFiles(path string) ([]string, error) {
	return nil, nil
}

func (s S3Bucket) GetFileShareName() string {
	return "S3Bucket"
}
