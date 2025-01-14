package fileshare

import (
	"context"
	"fmt"
	"log"

	"github.com/wavetermdev/waveterm/pkg/remote/awsconn"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/s3fs"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wavefs"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// CreateFileShareClient creates a fileshare client based on the connection string
// Returns the client and the parsed connection
func CreateFileShareClient(ctx context.Context, connection string) (fstype.FileShareClient, *connparse.Connection) {
	conn, err := connparse.ParseURI(connection)
	if err != nil {
		log.Printf("error parsing connection: %v", err)
		return nil, nil
	}
	if conn.Host == connparse.ConnHostLocal {
		handler := wshutil.GetRpcResponseHandlerFromContext(ctx)
		if handler == nil {
			conn.Host = connparse.ConnHostWaveSrv
		}
		conn.Host = handler.GetSource()
	}
	conntype := conn.GetType()
	if conntype == connparse.ConnectionTypeS3 {
		config, err := awsconn.GetConfig(ctx, connection)
		if err != nil {
			log.Printf("error getting aws config: %v", err)
			return nil, nil
		}
		return s3fs.NewS3Client(config), conn
	} else if conntype == connparse.ConnectionTypeWave {
		return wavefs.NewWaveClient(), conn
	} else {
		return wshfs.NewWshClient(), conn
	}
}

func Read(ctx context.Context, path string) (*wshrpc.FileData, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf("error creating fileshare client, could not parse connection %s", path)
	}
	return client.Read(ctx, conn, wshrpc.FileData{})
}

func ListEntries(ctx context.Context, path string, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf("error creating fileshare client, could not parse connection %s", path)
	}
	return client.ListEntries(ctx, conn, opts)
}

func ListEntriesStream(ctx context.Context, path string, opts *wshrpc.FileListOpts) (<-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf("error creating fileshare client, could not parse connection %s", path)
	}
	return client.ListEntriesStream(ctx, conn, opts), nil
}

func Stat(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf("error creating fileshare client, could not parse connection %s", path)
	}
	return client.Stat(ctx, conn)
}

func PutFile(ctx context.Context, data wshrpc.FileData) error {
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return fmt.Errorf("error creating fileshare client, could not parse connection %s", data.Info.Path)
	}
	return client.PutFile(ctx, conn, wshrpc.FileData{
		Data64: data.Data64,
		Opts:   data.Opts,
		At:     data.At,
	})
}

func Mkdir(ctx context.Context, path string) error {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return fmt.Errorf("error creating fileshare client, could not parse connection %s", path)
	}
	return client.Mkdir(ctx, conn)
}

// TODO: Implement move across different fileshare types
func Move(ctx context.Context, srcPath, destPath string, recursive bool) error {
	srcClient, srcConn := CreateFileShareClient(ctx, srcPath)
	if srcConn == nil || srcClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse connection %s or %s", srcPath, destPath)
	}
	destConn, err := connparse.ParseURI(destPath)
	if err != nil {
		return fmt.Errorf("error parsing destination connection %s: %v", destPath, err)
	}
	return srcClient.Move(ctx, srcConn, destConn, recursive)
}

// TODO: Implement copy across different fileshare types
func Copy(ctx context.Context, srcPath, destPath string, recursive bool) error {
	return nil
}

func Delete(ctx context.Context, path string) error {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return fmt.Errorf("error creating fileshare client, could not parse connection %s", path)
	}
	return client.Delete(ctx, conn)
}
