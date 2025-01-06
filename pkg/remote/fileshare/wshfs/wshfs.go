package wshfs

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"

	"github.com/wavetermdev/waveterm/pkg/remote/fileshare"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type WshClient struct {
	connRoute string
}

var _ fileshare.FileShare = WshClient{}

func NewClient(connection string) *WshClient {
	return &WshClient{
		connRoute: wshutil.MakeConnectionRouteId(connection),
	}
}

func (c WshClient) Read(path string) (*fileshare.FullFile, error) {
	client := wshserver.GetMainRpcClient()
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: path}
	rtnCh := wshclient.RemoteStreamFileCommand(client, streamFileData, &wshrpc.RpcOpts{Route: c.connRoute})
	fullFile := &fileshare.FullFile{}
	firstPk := true
	isDir := false
	var fileBuf bytes.Buffer
	var fileInfoArr []*wshrpc.FileInfo
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		resp := respUnion.Response
		if firstPk {
			firstPk = false
			// first packet has the fileinfo
			if len(resp.FileInfo) != 1 {
				return nil, fmt.Errorf("stream file protocol error, first pk fileinfo len=%d", len(resp.FileInfo))
			}
			fullFile.Info = resp.FileInfo[0]
			if fullFile.Info.IsDir {
				isDir = true
			}
			continue
		}
		if isDir {
			if len(resp.FileInfo) == 0 {
				continue
			}
			fileInfoArr = append(fileInfoArr, resp.FileInfo...)
		} else {
			if resp.Data64 == "" {
				continue
			}
			decoder := base64.NewDecoder(base64.StdEncoding, bytes.NewReader([]byte(resp.Data64)))
			_, err := io.Copy(&fileBuf, decoder)
			if err != nil {
				return nil, fmt.Errorf("stream file, failed to decode base64 data %q: %w", resp.Data64, err)
			}
		}
	}
	if isDir {
		fiBytes, err := json.Marshal(fileInfoArr)
		if err != nil {
			return nil, fmt.Errorf("unable to serialize files %s", path)
		}
		fullFile.Data64 = base64.StdEncoding.EncodeToString(fiBytes)
	} else {
		// we can avoid this re-encoding if we ensure the remote side always encodes chunks of 3 bytes so we don't get padding chars
		fullFile.Data64 = base64.StdEncoding.EncodeToString(fileBuf.Bytes())
	}
	return fullFile, nil
}

func (c WshClient) Stat(path string) (*wshrpc.FileInfo, error) {
	client := wshserver.GetMainRpcClient()
	return wshclient.RemoteFileInfoCommand(client, path, &wshrpc.RpcOpts{Route: c.connRoute})
}

func (c WshClient) PutFile(path string, data64 string) error {
	client := wshserver.GetMainRpcClient()
	writeData := wshrpc.CommandRemoteWriteFileData{Path: path, Data64: data64}
	return wshclient.RemoteWriteFileCommand(client, writeData, &wshrpc.RpcOpts{Route: c.connRoute})
}

func (c WshClient) Mkdir(path string) error {
	client := wshserver.GetMainRpcClient()
	return wshclient.RemoteMkdirCommand(client, path, &wshrpc.RpcOpts{Route: c.connRoute})
}

func (c WshClient) Move(srcPath, destPath string, recursive bool) error {
	client := wshserver.GetMainRpcClient()
	return wshclient.RemoteFileRenameCommand(client, [2]string{srcPath, destPath}, &wshrpc.RpcOpts{Route: c.connRoute})
}

func (c WshClient) Copy(srcPath, destPath string, recursive bool) error {
	return nil
}

func (c WshClient) Delete(path string) error {
	client := wshserver.GetMainRpcClient()
	return wshclient.RemoteFileDeleteCommand(client, path, &wshrpc.RpcOpts{Route: c.connRoute})
}

func (c WshClient) ListEntries(path string) ([]wshrpc.FileInfo, error) {
	return nil, nil
}

func (c WshClient) GetFileShareName() string {
	return "S3Client"
}
