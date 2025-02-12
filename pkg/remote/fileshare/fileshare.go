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
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	ErrorParsingConnection = "error creating fileshare client, could not parse connection %s"
)

// CreateFileShareClient creates a fileshare client based on the connection string
// Returns the client and the parsed connection
func CreateFileShareClient(ctx context.Context, connection string) (fstype.FileShareClient, *connparse.Connection) {
	conn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, connection)
	if err != nil {
		log.Printf("error parsing connection: %v", err)
		return nil, nil
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
	} else if conntype == connparse.ConnectionTypeWsh {
		return wshfs.NewWshClient(), conn
	} else {
		log.Printf("unsupported connection type: %s", conntype)
		return nil, nil
	}
}

func Read(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileData, error) {
	log.Printf("Read: %v", data.Info.Path)
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, data.Info.Path)
	}
	return client.Read(ctx, conn, data)
}

func ReadStream(ctx context.Context, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return wshutil.SendErrCh[wshrpc.FileData](fmt.Errorf(ErrorParsingConnection, data.Info.Path))
	}
	return client.ReadStream(ctx, conn, data)
}

func ReadTarStream(ctx context.Context, data wshrpc.CommandRemoteStreamTarData) <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet] {
	client, conn := CreateFileShareClient(ctx, data.Path)
	if conn == nil || client == nil {
		return wshutil.SendErrCh[iochantypes.Packet](fmt.Errorf(ErrorParsingConnection, data.Path))
	}
	return client.ReadTarStream(ctx, conn, data.Opts)
}

func ListEntries(ctx context.Context, path string, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.ListEntries(ctx, conn, opts)
}

func ListEntriesStream(ctx context.Context, path string, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return wshutil.SendErrCh[wshrpc.CommandRemoteListEntriesRtnData](fmt.Errorf(ErrorParsingConnection, path))
	}
	return client.ListEntriesStream(ctx, conn, opts)
}

func Stat(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Stat(ctx, conn)
}

func PutFile(ctx context.Context, data wshrpc.FileData) error {
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, data.Info.Path)
	}
	return client.PutFile(ctx, conn, data)
}

func Mkdir(ctx context.Context, path string) error {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Mkdir(ctx, conn)
}

func Move(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	srcClient, srcConn := CreateFileShareClient(ctx, data.SrcUri)
	if srcConn == nil || srcClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse source connection %s", data.SrcUri)
	}
	destClient, destConn := CreateFileShareClient(ctx, data.DestUri)
	if destConn == nil || destClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse destination connection %s", data.DestUri)
	}
	if srcConn.Host != destConn.Host {
		finfo, err := srcClient.Stat(ctx, srcConn)
		if err != nil {
			return fmt.Errorf("cannot stat %q: %w", data.SrcUri, err)
		}
		recursive := data.Opts != nil && data.Opts.Recursive
		if finfo.IsDir && data.Opts != nil && !recursive {
			return fmt.Errorf("cannot move directory %q to %q without recursive flag", data.SrcUri, data.DestUri)
		}
		err = destClient.CopyRemote(ctx, srcConn, destConn, srcClient, data.Opts)
		if err != nil {
			return fmt.Errorf("cannot copy %q to %q: %w", data.SrcUri, data.DestUri, err)
		}
		return srcClient.Delete(ctx, srcConn, recursive)
	} else {
		return srcClient.MoveInternal(ctx, srcConn, destConn, data.Opts)
	}
}

func Copy(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	srcClient, srcConn := CreateFileShareClient(ctx, data.SrcUri)
	if srcConn == nil || srcClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse source connection %s", data.SrcUri)
	}
	destClient, destConn := CreateFileShareClient(ctx, data.DestUri)
	if destConn == nil || destClient == nil {
		return fmt.Errorf("error creating fileshare client, could not parse destination connection %s", data.DestUri)
	}
	if srcConn.Host != destConn.Host {
		return destClient.CopyRemote(ctx, srcConn, destConn, srcClient, data.Opts)
	} else {
		return srcClient.CopyInternal(ctx, srcConn, destConn, data.Opts)
	}
}

func Delete(ctx context.Context, data wshrpc.CommandDeleteFileData) error {
	client, conn := CreateFileShareClient(ctx, data.Path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, data.Path)
	}
	return client.Delete(ctx, conn, data.Recursive)
}

func Join(ctx context.Context, path string, parts ...string) (*wshrpc.FileInfo, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return nil, fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.Join(ctx, conn, parts...)
}

func Append(ctx context.Context, data wshrpc.FileData) error {
	client, conn := CreateFileShareClient(ctx, data.Info.Path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, data.Info.Path)
	}
	return client.AppendFile(ctx, conn, data)
}

func GetCapability(ctx context.Context, path string) (wshrpc.FileShareCapability, error) {
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return wshrpc.FileShareCapability{}, fmt.Errorf(ErrorParsingConnection, path)
	}
	return client.GetCapability(), nil
}
