package fileshare

import (
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type S3Client struct {
	client *s3.Client
}

var _ FileShareClient = S3Client{}

func NewS3Client(config aws.Config) *S3Client {
	return &S3Client{
		client: s3.NewFromConfig(config),
	}
}

func (c S3Client) Read(path string) (*FullFile, error) {
	return nil, nil
}

func (c S3Client) Stat(path string) (*wshrpc.FileInfo, error) {
	return nil, nil
}

func (c S3Client) PutFile(path string, data64 string) error {
	return nil
}

func (c S3Client) Mkdir(path string) error {
	return nil
}

func (c S3Client) Move(srcPath, destPath string, recursive bool) error {
	return nil
}

func (c S3Client) Copy(srcPath, destPath string, recursive bool) error {
	return nil
}

func (c S3Client) Delete(path string) error {
	return nil
}

func (c S3Client) ListEntries(path string) ([]wshrpc.FileInfo, error) {
	return nil, nil
}

func (c S3Client) GetFileShareName() string {
	return "S3Client"
}
