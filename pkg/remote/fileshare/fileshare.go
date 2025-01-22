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

const (
	ErrorParsingConnection = "error creating fileshare client, could not parse connection %s"
)

// CreateFileShareClient creates a fileshare client based on the connection string
// Returns the client and the parsed connection
func CreateFileShareClient(ctx context.Context, connection string) (fstype.FileShareClient, *connparse.Connection) {
	log.Printf("CreateFileShareClient: connection=%s", connection)
	conn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, connection)
	if err != nil {
		log.Printf("error parsing connection: %v", err)
		return nil, nil
	}
	conntype := conn.GetType()
	log.Printf("CreateFileShareClient: conntype=%s", conntype)
	if conntype == connparse.ConnectionTypeS3 {
		config, err := awsconn.GetConfig(ctx, connection)
		if err != nil {
			log.Printf("error getting aws config: %v", err)
			return nil, nil
		}
		return s3fs.NewS3Client(config), conn
	} else if conntype == connparse.ConnectionTypeWave {
		return wavefs.NewWaveClient(), conn
	} else if conntype == connparse.ConnectionTypeWsh {
		return wshfs.NewWshClient(), conn
	} else {
		log.Printf("unsupported connection type: %s", conntype)
		return nil, nil
	}
}

func Read(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileData, error) {
	log.Printf("Read: path=%s", data.Info.Path)
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, data.Info.Path)
	}
	return client.Read(ctx, conn, data)
}

func ReadStream(ctx context.Context, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	log.Printf("ReadStream: path=%s", data.Info.Path)
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return wshutil.SendErrCh[wshrpc.FileData](fmt.Errorf(ErrorParsingConnection, data.Info.Path))
	}
	return client.ReadStream(ctx, conn, data)
}

func ReadTarStream(ctx context.Context, data wshrpc.CommandRemoteStreamTarData) <-chan wshrpc.RespOrErrorUnion[[]byte] {
	log.Printf("ReadTarStream: path=%s", data.Path)
	client, conn := CreateFileShareClient(ctx, data.Path)
	if conn == nil || client == nil {
		return wshutil.SendErrCh[[]byte](fmt.Errorf(ErrorParsingConnection, data.Path))
	}
	return client.ReadTarStream(ctx, conn, data.Opts)
}

func ListEntries(ctx context.Context, path string, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	log.Printf("ListEntries: path=%s", path)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.ListEntries(ctx, conn, opts)
}

func ListEntriesStream(ctx context.Context, path string, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	log.Printf("ListEntriesStream: path=%s", path)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return wshutil.SendErrCh[wshrpc.CommandRemoteListEntriesRtnData](fmt.Errorf(ErrorParsingConnection, path))
	}
	return client.ListEntriesStream(ctx, conn, opts)
}

func Stat(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	log.Printf("Stat: path=%s", path)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Stat(ctx, conn)
}

func PutFile(ctx context.Context, data wshrpc.FileData) error {
	log.Printf("PutFile: path=%s", data.Info.Path)
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, data.Info.Path)
	}
	return client.PutFile(ctx, conn, data)
}

func Mkdir(ctx context.Context, path string) error {
	log.Printf("Mkdir: path=%s", path)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Mkdir(ctx, conn)
}

func Move(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	log.Printf("Move: src=%s, dest=%s", data.SrcUri, data.DestUri)
	srcConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, data.SrcUri)
	if err != nil {
		return fmt.Errorf("error parsing source connection %s: %v", data.SrcUri, err)
	}
	destClient, destConn := CreateFileShareClient(ctx, data.DestUri)
	if destConn == nil || destClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse connection %s or %s", data.SrcUri, data.DestUri)
	}
	return destClient.Move(ctx, srcConn, destConn, data.Opts)
}

func Copy(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	log.Printf("Copy: src=%s, dest=%s", data.SrcUri, data.DestUri)
	srcConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, data.SrcUri)
	if err != nil {
		return fmt.Errorf("error parsing source connection %s: %v", data.SrcUri, err)
	}
	destClient, destConn := CreateFileShareClient(ctx, data.DestUri)
	if destConn == nil || destClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse connection %s or %s", data.SrcUri, data.DestUri)
	}
	return destClient.Copy(ctx, srcConn, destConn, data.Opts)
}

func Delete(ctx context.Context, path string) error {
	log.Printf("Delete: path=%s", path)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Delete(ctx, conn)
}

func Join(ctx context.Context, path string, parts ...string) (string, error) {
	log.Printf("Join: path=%s, parts=%v", path, parts)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return "", fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Join(ctx, conn, parts...)
}

func Append(ctx context.Context, data wshrpc.FileData) error {
	log.Printf("Append: path=%s", data.Info.Path)
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, data.Info.Path)
	}
	return client.AppendFile(ctx, conn, data)
}
