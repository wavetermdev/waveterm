package fileshare

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/awsconn"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/s3fs"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
)

func CreateFileShareClient(ctx context.Context, connection string) fstype.FileShareClient {
	connType := remote.ParseConnectionType(connection)
	if connType == remote.ConnectionTypeAws {
		config, err := awsconn.GetConfigForConnection(ctx, connection)
		if err != nil {
			log.Printf("error getting aws config: %v", err)
			return nil
		}
		return s3fs.NewS3Client(config)
	}
	return wshfs.NewWshClient(connection)
}
