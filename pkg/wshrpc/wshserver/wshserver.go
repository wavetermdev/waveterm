// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// this file contains the implementation of the wsh server methods

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/skratchdot/open-golang/open"
	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filebackup"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/suggestion"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveai"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wsl"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var InvalidWslDistroNames = []string{"docker-desktop", "docker-desktop-data"}

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

var WshServerImpl = WshServer{}

func (ws *WshServer) GetJwtPublicKeyCommand(ctx context.Context) (string, error) {
	return wavejwt.GetPublicKeyBase64(), nil
}

func (ws *WshServer) TestCommand(ctx context.Context, data string) error {
	defer func() {
		panichandler.PanicHandler("TestCommand", recover())
	}()
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	log.Printf("TEST src:%s | %s\n", rpcSource, data)
	return nil
}

// for testing
func (ws *WshServer) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	log.Printf("MESSAGE: %s\n", data.Message)
	return nil
}

// for testing
func (ws *WshServer) StreamTestCommand(ctx context.Context) chan wshrpc.RespOrErrorUnion[int] {
	rtn := make(chan wshrpc.RespOrErrorUnion[int])
	go func() {
		defer func() {
			panichandler.PanicHandler("StreamTestCommand", recover())
		}()
		for i := 1; i <= 5; i++ {
			rtn <- wshrpc.RespOrErrorUnion[int]{Response: i}
			time.Sleep(1 * time.Second)
		}
		close(rtn)
	}()
	return rtn
}

func (ws *WshServer) StreamWaveAiCommand(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	return waveai.RunAICommand(ctx, request)
}

func MakePlotData(ctx context.Context, blockId string) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(waveobj.MetaKey_View, "")
	if viewName != "cpuplot" && viewName != "sysinfo" {
		return fmt.Errorf("invalid view type: %s", viewName)
	}
	return filestore.WFS.MakeFile(ctx, blockId, "cpuplotdata", nil, wshrpc.FileOpts{})
}

func SavePlotData(ctx context.Context, blockId string, history string) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(waveobj.MetaKey_View, "")
	if viewName != "cpuplot" && viewName != "sysinfo" {
		return fmt.Errorf("invalid view type: %s", viewName)
	}
	// todo: interpret the data being passed
	// for now, this is just to throw an error if the block was closed
	historyBytes, err := json.Marshal(history)
	if err != nil {
		return fmt.Errorf("unable to serialize plot data: %v", err)
	}
	// ignore MakeFile error (already exists is ok)
	return filestore.WFS.WriteFile(ctx, blockId, "cpuplotdata", historyBytes)
}

func (ws *WshServer) GetMetaCommand(ctx context.Context, data wshrpc.CommandGetMetaData) (waveobj.MetaMapType, error) {
	obj, err := wstore.DBGetORef(ctx, data.ORef)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil, fmt.Errorf("object not found: %s", data.ORef)
	}
	return waveobj.GetMeta(obj), nil
}

func (ws *WshServer) SetMetaCommand(ctx context.Context, data wshrpc.CommandSetMetaData) error {
	log.Printf("SetMetaCommand: %s | %v\n", data.ORef, data.Meta)
	oref := data.ORef
	// Validate metadata before persistence
	if err := waveobj.ValidateMetadata(oref, data.Meta); err != nil {
		return fmt.Errorf("metadata validation failed: %w", err)
	}
	err := wstore.UpdateObjectMeta(ctx, oref, data.Meta, false)
	if err != nil {
		return fmt.Errorf("error updating object meta: %w", err)
	}
	wcore.SendWaveObjUpdate(oref)
	return nil
}

func (ws *WshServer) GetRTInfoCommand(ctx context.Context, data wshrpc.CommandGetRTInfoData) (*waveobj.ObjRTInfo, error) {
	return wstore.GetRTInfo(data.ORef), nil
}

func (ws *WshServer) SetRTInfoCommand(ctx context.Context, data wshrpc.CommandSetRTInfoData) error {
	if data.Delete {
		wstore.DeleteRTInfo(data.ORef)
		return nil
	}
	wstore.SetRTInfo(data.ORef, data.Data)
	return nil
}

func (ws *WshServer) ResolveIdsCommand(ctx context.Context, data wshrpc.CommandResolveIdsData) (wshrpc.CommandResolveIdsRtnData, error) {
	rtn := wshrpc.CommandResolveIdsRtnData{}
	rtn.ResolvedIds = make(map[string]waveobj.ORef)
	var firstErr error
	for _, simpleId := range data.Ids {
		oref, err := resolveSimpleId(ctx, data, simpleId)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if oref == nil {
			continue
		}
		rtn.ResolvedIds[simpleId] = *oref
	}
	if firstErr != nil && len(data.Ids) == 1 {
		return rtn, firstErr
	}
	return rtn, nil
}

func (ws *WshServer) CreateBlockCommand(ctx context.Context, data wshrpc.CommandCreateBlockData) (*waveobj.ORef, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId := data.TabId
	blockData, err := wcore.CreateBlock(ctx, tabId, data.BlockDef, data.RtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	var layoutAction *waveobj.LayoutActionData
	if data.TargetBlockId != "" {
		switch data.TargetAction {
		case "replace":
			layoutAction = &waveobj.LayoutActionData{
				ActionType:    wcore.LayoutActionDataType_Replace,
				TargetBlockId: data.TargetBlockId,
				BlockId:       blockData.OID,
				Focused:       data.Focused,
			}
			err = wcore.DeleteBlock(ctx, data.TargetBlockId, false)
			if err != nil {
				return nil, fmt.Errorf("error deleting block (trying to do block replace): %w", err)
			}
		case "splitright":
			layoutAction = &waveobj.LayoutActionData{
				ActionType:    wcore.LayoutActionDataType_SplitHorizontal,
				BlockId:       blockData.OID,
				TargetBlockId: data.TargetBlockId,
				Position:      "after",
				Focused:       data.Focused,
			}
		case "splitleft":
			layoutAction = &waveobj.LayoutActionData{
				ActionType:    wcore.LayoutActionDataType_SplitHorizontal,
				BlockId:       blockData.OID,
				TargetBlockId: data.TargetBlockId,
				Position:      "before",
				Focused:       data.Focused,
			}
		case "splitup":
			layoutAction = &waveobj.LayoutActionData{
				ActionType:    wcore.LayoutActionDataType_SplitVertical,
				BlockId:       blockData.OID,
				TargetBlockId: data.TargetBlockId,
				Position:      "before",
				Focused:       data.Focused,
			}
		case "splitdown":
			layoutAction = &waveobj.LayoutActionData{
				ActionType:    wcore.LayoutActionDataType_SplitVertical,
				BlockId:       blockData.OID,
				TargetBlockId: data.TargetBlockId,
				Position:      "after",
				Focused:       data.Focused,
			}
		default:
			return nil, fmt.Errorf("invalid target action: %s", data.TargetAction)
		}
	} else {
		layoutAction = &waveobj.LayoutActionData{
			ActionType: wcore.LayoutActionDataType_Insert,
			BlockId:    blockData.OID,
			Magnified:  data.Magnified,
			Ephemeral:  data.Ephemeral,
			Focused:    data.Focused,
		}
	}
	err = wcore.QueueLayoutActionForTab(ctx, tabId, *layoutAction)
	if err != nil {
		return nil, fmt.Errorf("error queuing layout action: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	wps.Broker.SendUpdateEvents(updates)
	return &waveobj.ORef{OType: waveobj.OType_Block, OID: blockData.OID}, nil
}

func (ws *WshServer) CreateSubBlockCommand(ctx context.Context, data wshrpc.CommandCreateSubBlockData) (*waveobj.ORef, error) {
	parentBlockId := data.ParentBlockId
	blockData, err := wcore.CreateSubBlock(ctx, parentBlockId, data.BlockDef)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	blockRef := &waveobj.ORef{OType: waveobj.OType_Block, OID: blockData.OID}
	return blockRef, nil
}

func (ws *WshServer) ControllerStopCommand(ctx context.Context, blockId string) error {
	blockcontroller.DestroyBlockController(blockId)
	return nil
}

func (ws *WshServer) ControllerResyncCommand(ctx context.Context, data wshrpc.CommandControllerResyncData) error {
	ctx = genconn.ContextWithConnData(ctx, data.BlockId)
	ctx = termCtxWithLogBlockId(ctx, data.BlockId)
	return blockcontroller.ResyncController(ctx, data.TabId, data.BlockId, data.RtOpts, data.ForceRestart)
}

func (ws *WshServer) ControllerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	if block.JobId != "" {
		jobInputData := wshrpc.CommandJobInputData{
			JobId:       block.JobId,
			InputData64: data.InputData64,
			SigName:     data.SigName,
			TermSize:    data.TermSize,
		}
		return jobcontroller.SendInput(ctx, jobInputData)
	}

	inputUnion := &blockcontroller.BlockInputUnion{
		SigName:  data.SigName,
		TermSize: data.TermSize,
	}
	if len(data.InputData64) > 0 {
		inputBuf := make([]byte, base64.StdEncoding.DecodedLen(len(data.InputData64)))
		nw, err := base64.StdEncoding.Decode(inputBuf, []byte(data.InputData64))
		if err != nil {
			return fmt.Errorf("error decoding input data: %w", err)
		}
		inputUnion.InputData = inputBuf[:nw]
	}
	return blockcontroller.SendInput(data.BlockId, inputUnion)
}

func (ws *WshServer) ControllerAppendOutputCommand(ctx context.Context, data wshrpc.CommandControllerAppendOutputData) error {
	outputBuf := make([]byte, base64.StdEncoding.DecodedLen(len(data.Data64)))
	nw, err := base64.StdEncoding.Decode(outputBuf, []byte(data.Data64))
	if err != nil {
		return fmt.Errorf("error decoding output data: %w", err)
	}
	err = blockcontroller.HandleAppendBlockFile(data.BlockId, wavebase.BlockFile_Term, outputBuf[:nw])
	if err != nil {
		return fmt.Errorf("error appending to block file: %w", err)
	}
	return nil
}

func (ws *WshServer) FileCreateCommand(ctx context.Context, data wshrpc.FileData) error {
	data.Data64 = ""
	err := wshfs.PutFile(ctx, data)
	if err != nil {
		return fmt.Errorf("error creating file: %w", err)
	}
	return nil
}

func (ws *WshServer) FileMkdirCommand(ctx context.Context, data wshrpc.FileData) error {
	return wshfs.Mkdir(ctx, data.Info.Path)
}

func (ws *WshServer) FileDeleteCommand(ctx context.Context, data wshrpc.CommandDeleteFileData) error {
	return wshfs.Delete(ctx, data)
}

func (ws *WshServer) FileInfoCommand(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileInfo, error) {
	return wshfs.Stat(ctx, data.Info.Path)
}

func (ws *WshServer) FileListCommand(ctx context.Context, data wshrpc.FileListData) ([]*wshrpc.FileInfo, error) {
	return wshfs.ListEntries(ctx, data.Path, data.Opts)
}

func (ws *WshServer) FileListStreamCommand(ctx context.Context, data wshrpc.FileListData) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return wshfs.ListEntriesStream(ctx, data.Path, data.Opts)
}

func (ws *WshServer) FileWriteCommand(ctx context.Context, data wshrpc.FileData) error {
	return wshfs.PutFile(ctx, data)
}

func (ws *WshServer) FileReadCommand(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileData, error) {
	return wshfs.Read(ctx, data)
}

func (ws *WshServer) FileReadStreamCommand(ctx context.Context, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	return wshfs.ReadStream(ctx, data)
}

func (ws *WshServer) FileCopyCommand(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	return wshfs.Copy(ctx, data)
}

func (ws *WshServer) FileMoveCommand(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	return wshfs.Move(ctx, data)
}

func (ws *WshServer) FileAppendCommand(ctx context.Context, data wshrpc.FileData) error {
	return wshfs.Append(ctx, data)
}

func (ws *WshServer) FileJoinCommand(ctx context.Context, paths []string) (*wshrpc.FileInfo, error) {
	if len(paths) < 2 {
		if len(paths) == 0 {
			return nil, fmt.Errorf("no paths provided")
		}
		return wshfs.Stat(ctx, paths[0])
	}
	return wshfs.Join(ctx, paths[0], paths[1:]...)
}

func (ws *WshServer) FileRestoreBackupCommand(ctx context.Context, data wshrpc.CommandFileRestoreBackupData) error {
	expandedBackupPath, err := wavebase.ExpandHomeDir(data.BackupFilePath)
	if err != nil {
		return fmt.Errorf("failed to expand backup file path: %w", err)
	}
	expandedRestorePath, err := wavebase.ExpandHomeDir(data.RestoreToFileName)
	if err != nil {
		return fmt.Errorf("failed to expand restore file path: %w", err)
	}
	return filebackup.RestoreBackup(expandedBackupPath, expandedRestorePath)
}

func (ws *WshServer) GetTempDirCommand(ctx context.Context, data wshrpc.CommandGetTempDirData) (string, error) {
	tempDir := os.TempDir()
	if data.FileName != "" {
		// Reduce to a simple file name to avoid absolute paths or traversal
		name := filepath.Base(data.FileName)
		// Normalize/trim any stray separators and whitespace
		name = strings.Trim(name, `/\`+" ")
		if name == "" || name == "." {
			return tempDir, nil
		}
		return filepath.Join(tempDir, name), nil
	}
	return tempDir, nil
}

func (ws *WshServer) WriteTempFileCommand(ctx context.Context, data wshrpc.CommandWriteTempFileData) (string, error) {
	if data.FileName == "" {
		return "", fmt.Errorf("filename is required")
	}
	name := filepath.Base(data.FileName)
	if name == "" || name == "." || name == ".." {
		return "", fmt.Errorf("invalid filename")
	}
	tempDir, err := os.MkdirTemp("", "waveterm-")
	if err != nil {
		return "", fmt.Errorf("error creating temp directory: %w", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return "", fmt.Errorf("error decoding base64 data: %w", err)
	}
	tempPath := filepath.Join(tempDir, name)
	err = os.WriteFile(tempPath, decoded, 0600)
	if err != nil {
		return "", fmt.Errorf("error writing temp file: %w", err)
	}
	return tempPath, nil
}

func (ws *WshServer) DeleteSubBlockCommand(ctx context.Context, data wshrpc.CommandDeleteBlockData) error {
	if data.BlockId == "" {
		return fmt.Errorf("blockid is required")
	}
	err := wcore.DeleteBlock(ctx, data.BlockId, false)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	return nil
}

func (ws *WshServer) DeleteBlockCommand(ctx context.Context, data wshrpc.CommandDeleteBlockData) error {
	if data.BlockId == "" {
		return fmt.Errorf("blockid is required")
	}
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("error finding tab for block: %w", err)
	}
	if tabId == "" {
		return fmt.Errorf("no tab found for block")
	}
	err = wcore.DeleteBlock(ctx, data.BlockId, true)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	wcore.QueueLayoutActionForTab(ctx, tabId, waveobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_Remove,
		BlockId:    data.BlockId,
	})
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	wps.Broker.SendUpdateEvents(updates)
	return nil
}

func (ws *WshServer) WaitForRouteCommand(ctx context.Context, data wshrpc.CommandWaitForRouteData) (bool, error) {
	waitCtx, cancelFn := context.WithTimeout(ctx, time.Duration(data.WaitMs)*time.Millisecond)
	defer cancelFn()
	err := wshutil.DefaultRouter.WaitForRegister(waitCtx, data.RouteId)
	return err == nil, nil
}

func (ws *WshServer) EventRecvCommand(ctx context.Context, data wps.WaveEvent) error {
	return nil
}

func (ws *WshServer) EventPublishCommand(ctx context.Context, data wps.WaveEvent) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	if data.Sender == "" {
		data.Sender = rpcSource
	}
	wps.Broker.Publish(data)
	return nil
}

func (ws *WshServer) EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	wps.Broker.Subscribe(rpcSource, data)
	return nil
}

func (ws *WshServer) EventUnsubCommand(ctx context.Context, data string) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	wps.Broker.Unsubscribe(rpcSource, data)
	return nil
}

func (ws *WshServer) EventUnsubAllCommand(ctx context.Context) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	wps.Broker.UnsubscribeAll(rpcSource)
	return nil
}

func (ws *WshServer) EventReadHistoryCommand(ctx context.Context, data wshrpc.CommandEventReadHistoryData) ([]*wps.WaveEvent, error) {
	events := wps.Broker.ReadEventHistory(data.Event, data.Scope, data.MaxItems)
	return events, nil
}

func (ws *WshServer) SetConfigCommand(ctx context.Context, data wshrpc.MetaSettingsType) error {
	return wconfig.SetBaseConfigValue(data.MetaMapType)
}

func (ws *WshServer) SetConnectionsConfigCommand(ctx context.Context, data wshrpc.ConnConfigRequest) error {
	return wconfig.SetConnectionsConfigValue(data.Host, data.MetaMapType)
}

func (ws *WshServer) GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error) {
	watcher := wconfig.GetWatcher()
	return watcher.GetFullConfig(), nil
}

func (ws *WshServer) GetWaveAIModeConfigCommand(ctx context.Context) (wconfig.AIModeConfigUpdate, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	resolvedConfigs := aiusechat.ComputeResolvedAIModeConfigs(fullConfig)
	return wconfig.AIModeConfigUpdate{Configs: resolvedConfigs}, nil
}

func (ws *WshServer) ConnStatusCommand(ctx context.Context) ([]wshrpc.ConnStatus, error) {
	rtn := conncontroller.GetAllConnStatus()
	return rtn, nil
}

func (ws *WshServer) WslStatusCommand(ctx context.Context) ([]wshrpc.ConnStatus, error) {
	rtn := wslconn.GetAllConnStatus()
	return rtn, nil
}

func termCtxWithLogBlockId(ctx context.Context, logBlockId string) context.Context {
	if logBlockId == "" {
		return ctx
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, logBlockId)
	if err != nil {
		return ctx
	}
	connDebug := block.Meta.GetString(waveobj.MetaKey_TermConnDebug, "")
	if connDebug == "" {
		return ctx
	}
	return blocklogger.ContextWithLogBlockId(ctx, logBlockId, connDebug == "debug")
}

func (ws *WshServer) ConnEnsureCommand(ctx context.Context, data wshrpc.ConnExtData) error {
	ctx = genconn.ContextWithConnData(ctx, data.LogBlockId)
	ctx = termCtxWithLogBlockId(ctx, data.LogBlockId)
	if strings.HasPrefix(data.ConnName, "wsl://") {
		distroName := strings.TrimPrefix(data.ConnName, "wsl://")
		return wslconn.EnsureConnection(ctx, distroName)
	}
	return conncontroller.EnsureConnection(ctx, data.ConnName)
}

func (ws *WshServer) ConnDisconnectCommand(ctx context.Context, connName string) error {
	if conncontroller.IsLocalConnName(connName) {
		return nil
	}
	if strings.HasPrefix(connName, "wsl://") {
		distroName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return fmt.Errorf("distro not found: %s", connName)
		}
		return conn.Close()
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return fmt.Errorf("connection not found: %s", connName)
	}
	return conn.Close()
}

func (ws *WshServer) ConnConnectCommand(ctx context.Context, connRequest wshrpc.ConnRequest) error {
	if conncontroller.IsLocalConnName(connRequest.Host) {
		return nil
	}
	ctx = genconn.ContextWithConnData(ctx, connRequest.LogBlockId)
	ctx = termCtxWithLogBlockId(ctx, connRequest.LogBlockId)
	connName := connRequest.Host
	if strings.HasPrefix(connName, "wsl://") {
		distroName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return fmt.Errorf("connection not found: %s", connName)
		}
		return conn.Connect(ctx)
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return fmt.Errorf("connection not found: %s", connName)
	}
	return conn.Connect(ctx, &connRequest.Keywords)
}

func (ws *WshServer) ConnReinstallWshCommand(ctx context.Context, data wshrpc.ConnExtData) error {
	if conncontroller.IsLocalConnName(data.ConnName) {
		return nil
	}
	ctx = genconn.ContextWithConnData(ctx, data.LogBlockId)
	ctx = termCtxWithLogBlockId(ctx, data.LogBlockId)
	connName := data.ConnName
	if strings.HasPrefix(connName, "wsl://") {
		distroName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return fmt.Errorf("connection not found: %s", connName)
		}
		return conn.InstallWsh(ctx, "")
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return fmt.Errorf("connection not found: %s", connName)
	}
	return conn.InstallWsh(ctx, "")
}

func (ws *WshServer) ConnUpdateWshCommand(ctx context.Context, remoteInfo wshrpc.RemoteInfo) (bool, error) {
	handler := wshutil.GetRpcResponseHandlerFromContext(ctx)
	if handler == nil {
		return false, fmt.Errorf("could not determine handler from context")
	}
	connName := handler.GetRpcContext().Conn
	if connName == "" {
		return false, fmt.Errorf("invalid remote info: missing connection name")
	}

	log.Printf("checking wsh version for connection %s (current: %s)", connName, remoteInfo.ClientVersion)
	upToDate, _, _, err := conncontroller.IsWshVersionUpToDate(ctx, remoteInfo.ClientVersion)
	if err != nil {
		return false, fmt.Errorf("unable to compare wsh version: %w", err)
	}
	if upToDate {
		// no need to update
		log.Printf("wsh is already up to date for connection %s", connName)
		return false, nil
	}

	// todo: need to add user input code here for validation

	if strings.HasPrefix(connName, "wsl://") {
		return false, fmt.Errorf("connupdatewshcommand is not supported for wsl connections")
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return false, fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return false, fmt.Errorf("connection not found: %s", connName)
	}
	err = conn.UpdateWsh(ctx, connName, &remoteInfo)
	if err != nil {
		return false, fmt.Errorf("wsh update failed for connection %s: %w", connName, err)
	}

	// todo: need to add code for modifying configs?
	return true, nil
}

func (ws *WshServer) ConnListCommand(ctx context.Context) ([]string, error) {
	return conncontroller.GetConnectionsList()
}

func (ws *WshServer) WslListCommand(ctx context.Context) ([]string, error) {
	distros, err := wsl.RegisteredDistros(ctx)
	if err != nil {
		return nil, err
	}
	var distroNames []string
	for _, distro := range distros {
		distroName := distro.Name()
		if utilfn.ContainsStr(InvalidWslDistroNames, distroName) {
			continue
		}
		distroNames = append(distroNames, distroName)
	}
	return distroNames, nil
}

func (ws *WshServer) WslDefaultDistroCommand(ctx context.Context) (string, error) {
	distro, ok, err := wsl.DefaultDistro(ctx)
	if err != nil {
		return "", fmt.Errorf("unable to determine default distro: %w", err)
	}
	if !ok {
		return "", fmt.Errorf("unable to determine default distro")
	}
	return distro.Name(), nil
}

/**
 * Dismisses the WshFail Command in runtime memory on the backend
 */
func (ws *WshServer) DismissWshFailCommand(ctx context.Context, connName string) error {
	if strings.HasPrefix(connName, "wsl://") {
		distroName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return fmt.Errorf("connection not found: %s", connName)
		}
		conn.ClearWshError()
		conn.FireConnChangeEvent()
		return nil
	}
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return err
	}
	conn := conncontroller.GetConn(opts)
	if conn == nil {
		return fmt.Errorf("connection %s not found", connName)
	}
	conn.ClearWshError()
	conn.FireConnChangeEvent()
	return nil
}

func (ws *WshServer) FindGitBashCommand(ctx context.Context, rescan bool) (string, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	return shellutil.FindGitBash(&fullConfig, rescan), nil
}

func (ws *WshServer) DetectAvailableShellsCommand(ctx context.Context, data wshrpc.DetectShellsRequest) (wshrpc.DetectShellsResponse, error) {
	// Currently only local detection is supported
	// Remote connection detection would be a future enhancement
	if data.ConnectionName != "" {
		return wshrpc.DetectShellsResponse{
			Shells: nil,
			Error:  "remote shell detection not yet supported",
		}, nil
	}

	fullConfig := wconfig.GetWatcher().GetFullConfig()
	detectedShells, err := shellutil.DetectAllShells(&fullConfig, data.Rescan)

	var errStr string
	if err != nil {
		errStr = err.Error()
	}

	// Convert shellutil.DetectedShell to wshrpc.DetectedShell
	rpcShells := make([]wshrpc.DetectedShell, len(detectedShells))
	for i, shell := range detectedShells {
		rpcShells[i] = wshrpc.DetectedShell{
			ID:        shell.ID,
			Name:      shell.Name,
			ShellPath: shell.ShellPath,
			ShellType: shell.ShellType,
			Version:   shell.Version,
			Source:    shell.Source,
			Icon:      shell.Icon,
			IsDefault: shell.IsDefault,
		}
	}

	return wshrpc.DetectShellsResponse{
		Shells: rpcShells,
		Error:  errStr,
	}, nil
}

func (ws *WshServer) SetShellProfileCommand(ctx context.Context, data wshrpc.SetShellProfileRequest) error {
	profile := wconfig.ShellProfileType{
		DisplayName:  data.Profile.DisplayName,
		DisplayIcon:  data.Profile.DisplayIcon,
		DisplayOrder: data.Profile.DisplayOrder,
		ShellPath:    data.Profile.ShellPath,
		ShellOpts:    data.Profile.ShellOpts,
		ShellType:    data.Profile.ShellType,
		IsWsl:        data.Profile.IsWsl,
		WslDistro:    data.Profile.WslDistro,
		Autodetected: data.Profile.Autodetected,
		Hidden:       data.Profile.Hidden,
		Source:       data.Profile.Source,
		UserModified: data.Profile.UserModified,
	}
	return wconfig.SetShellProfile(data.ProfileID, profile)
}

func (ws *WshServer) DeleteShellProfileCommand(ctx context.Context, data wshrpc.DeleteShellProfileRequest) error {
	return wconfig.DeleteShellProfile(data.ProfileID)
}

func (ws *WshServer) MergeShellProfilesCommand(ctx context.Context, data wshrpc.MergeShellProfilesRequest) (wshrpc.MergeShellProfilesResponse, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	detectedShells, err := shellutil.DetectAllShells(&fullConfig, data.Rescan)

	if err != nil {
		return wshrpc.MergeShellProfilesResponse{
			Added: 0,
			Error: fmt.Sprintf("detection failed: %v", err),
		}, nil
	}

	// Convert DetectedShell to ShellProfileType
	profiles := make([]wconfig.ShellProfileType, len(detectedShells))
	for i, shell := range detectedShells {
		profiles[i] = wconfig.ShellProfileType{
			DisplayName:  shell.Name,
			DisplayIcon:  shell.Icon,
			ShellPath:    shell.ShellPath,
			ShellType:    shell.ShellType,
			Source:       shell.Source,
			Autodetected: true,
		}
		// Handle WSL shells
		if shell.Source == shellutil.ShellSource_Wsl {
			profiles[i].IsWsl = true
			// Extract distro name from shell name (e.g., "WSL: Ubuntu" -> "Ubuntu")
			distro := shell.Name
			if len(distro) > 5 && distro[:5] == "WSL: " {
				distro = distro[5:]
			}
			profiles[i].WslDistro = distro
		}
	}

	added, err := wconfig.MergeDetectedShellProfiles(profiles)
	if err != nil {
		return wshrpc.MergeShellProfilesResponse{
			Added: added,
			Error: err.Error(),
		}, nil
	}

	return wshrpc.MergeShellProfilesResponse{
		Added: added,
	}, nil
}

func waveFileToWaveFileInfo(wf *filestore.WaveFile) *wshrpc.WaveFileInfo {
	return &wshrpc.WaveFileInfo{
		ZoneId:    wf.ZoneId,
		Name:      wf.Name,
		Opts:      wf.Opts,
		CreatedTs: wf.CreatedTs,
		Size:      wf.Size,
		ModTs:     wf.ModTs,
		Meta:      wf.Meta,
	}
}

func (ws *WshServer) BlockInfoCommand(ctx context.Context, blockId string) (*wshrpc.BlockInfoData, error) {
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block: %w", err)
	}
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error finding tab for block: %w", err)
	}
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error finding window for tab: %w", err)
	}
	fileList, err := filestore.WFS.ListFiles(ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error listing blockfiles: %w", err)
	}
	var fileInfoList []*wshrpc.WaveFileInfo
	for _, wf := range fileList {
		fileInfoList = append(fileInfoList, waveFileToWaveFileInfo(wf))
	}
	return &wshrpc.BlockInfoData{
		BlockId:     blockId,
		TabId:       tabId,
		WorkspaceId: workspaceId,
		Block:       blockData,
		Files:       fileInfoList,
	}, nil
}

func (ws *WshServer) WaveInfoCommand(ctx context.Context) (*wshrpc.WaveInfoData, error) {
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client: %w", err)
	}
	return &wshrpc.WaveInfoData{
		Version:   wavebase.WaveVersion,
		ClientId:  client.OID,
		BuildTime: wavebase.BuildTime,
		ConfigDir: wavebase.GetWaveConfigDir(),
		DataDir:   wavebase.GetWaveDataDir(),
	}, nil
}

// BlocksListCommand returns every block visible in the requested
// scope (current workspace by default).
func (ws *WshServer) BlocksListCommand(
	ctx context.Context,
	req wshrpc.BlocksListRequest) ([]wshrpc.BlocksListEntry, error) {
	var results []wshrpc.BlocksListEntry

	// Resolve the set of workspaces to inspect
	var workspaceIDs []string
	if req.WorkspaceId != "" {
		workspaceIDs = []string{req.WorkspaceId}
	} else if req.WindowId != "" {
		win, err := wcore.GetWindow(ctx, req.WindowId)
		if err != nil {
			return nil, err
		}
		workspaceIDs = []string{win.WorkspaceId}
	} else {
		// "current" == first workspace in client focus list
		client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
		if err != nil {
			return nil, err
		}
		if len(client.WindowIds) == 0 {
			return nil, fmt.Errorf("no active window")
		}
		win, err := wcore.GetWindow(ctx, client.WindowIds[0])
		if err != nil {
			return nil, err
		}
		workspaceIDs = []string{win.WorkspaceId}
	}

	for _, wsID := range workspaceIDs {
		wsData, err := wcore.GetWorkspace(ctx, wsID)
		if err != nil {
			return nil, err
		}

		windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, wsID)
		if err != nil {
			log.Printf("error finding window for workspace %s: %v", wsID, err)
		}

		for _, tabID := range wsData.TabIds {
			tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabID)
			if err != nil {
				return nil, err
			}
			for _, blkID := range tab.BlockIds {
				blk, err := wstore.DBMustGet[*waveobj.Block](ctx, blkID)
				if err != nil {
					return nil, err
				}
				results = append(results, wshrpc.BlocksListEntry{
					WindowId:    windowId,
					WorkspaceId: wsID,
					TabId:       tabID,
					BlockId:     blkID,
					Meta:        blk.Meta,
				})
			}
		}
	}
	return results, nil
}

func (ws *WshServer) WorkspaceListCommand(ctx context.Context) ([]wshrpc.WorkspaceInfoData, error) {
	workspaceList, err := wcore.ListWorkspaces(ctx)
	if err != nil {
		return nil, fmt.Errorf("error listing workspaces: %w", err)
	}
	var rtn []wshrpc.WorkspaceInfoData
	for _, workspaceEntry := range workspaceList {
		workspaceData, err := wcore.GetWorkspace(ctx, workspaceEntry.WorkspaceId)
		if err != nil {
			return nil, fmt.Errorf("error getting workspace: %w", err)
		}
		rtn = append(rtn, wshrpc.WorkspaceInfoData{
			WindowId:      workspaceEntry.WindowId,
			WorkspaceData: workspaceData,
		})
	}
	return rtn, nil
}

func (ws *WshServer) WaveFileReadStreamCommand(ctx context.Context, data wshrpc.CommandWaveFileReadStreamData) (*wshrpc.WaveFileInfo, error) {
	const maxStreamFileSize = 5 * 1024 * 1024

	waveFile, err := filestore.WFS.Stat(ctx, data.ZoneId, data.Name)
	if err != nil {
		return nil, fmt.Errorf("error statting wavefile: %w", err)
	}

	dataLength := waveFile.DataLength()
	if dataLength > maxStreamFileSize {
		return nil, fmt.Errorf("file size %d exceeds maximum streaming size of %d bytes", dataLength, maxStreamFileSize)
	}

	wshRpc := wshutil.GetWshRpcFromContext(ctx)
	if wshRpc == nil || wshRpc.StreamBroker == nil {
		return nil, fmt.Errorf("no stream broker available")
	}

	writer, err := wshRpc.StreamBroker.CreateStreamWriter(&data.StreamMeta)
	if err != nil {
		return nil, fmt.Errorf("error creating stream writer: %w", err)
	}

	_, fileData, err := filestore.WFS.ReadFile(ctx, data.ZoneId, data.Name)
	if err != nil {
		writer.Close()
		return nil, fmt.Errorf("error reading wavefile: %w", err)
	}

	go func() {
		defer func() {
			panichandler.PanicHandler("WaveFileReadStreamCommand", recover())
		}()
		defer writer.Close()

		_, err := writer.Write(fileData)
		if err != nil {
			log.Printf("error writing to stream for wavefile %s:%s: %v\n", data.ZoneId, data.Name, err)
		}
	}()

	rtnInfo := &wshrpc.WaveFileInfo{
		ZoneId:    waveFile.ZoneId,
		Name:      waveFile.Name,
		Opts:      waveFile.Opts,
		CreatedTs: waveFile.CreatedTs,
		Size:      waveFile.Size,
		ModTs:     waveFile.ModTs,
		Meta:      waveFile.Meta,
	}
	return rtnInfo, nil
}

func (ws *WshServer) GetWaveAIChatCommand(ctx context.Context, data wshrpc.CommandGetWaveAIChatData) (*uctypes.UIChat, error) {
	aiChat := chatstore.DefaultChatStore.Get(data.ChatId)
	if aiChat == nil {
		return nil, nil
	}
	uiChat, err := aiusechat.ConvertAIChatToUIChat(aiChat)
	if err != nil {
		return nil, fmt.Errorf("error converting AI chat to UI chat: %w", err)
	}
	return uiChat, nil
}

func (ws *WshServer) GetWaveAIRateLimitCommand(ctx context.Context) (*uctypes.RateLimitInfo, error) {
	return aiusechat.GetGlobalRateLimit(), nil
}

func (ws *WshServer) WaveAIToolApproveCommand(ctx context.Context, data wshrpc.CommandWaveAIToolApproveData) error {
	return aiusechat.UpdateToolApproval(data.ToolCallId, data.Approval)
}

func (ws *WshServer) WaveAIGetToolDiffCommand(ctx context.Context, data wshrpc.CommandWaveAIGetToolDiffData) (*wshrpc.CommandWaveAIGetToolDiffRtnData, error) {
	originalContent, modifiedContent, err := aiusechat.CreateWriteTextFileDiff(ctx, data.ChatId, data.ToolCallId)
	if err != nil {
		return nil, err
	}

	return &wshrpc.CommandWaveAIGetToolDiffRtnData{
		OriginalContents64: base64.StdEncoding.EncodeToString(originalContent),
		ModifiedContents64: base64.StdEncoding.EncodeToString(modifiedContent),
	}, nil
}

func (ws *WshServer) WshActivityCommand(ctx context.Context, data map[string]int) error {
	// Telemetry removed - this is now a no-op
	return nil
}

func (ws *WshServer) ActivityCommand(ctx context.Context, activity wshrpc.ActivityUpdate) error {
	// Telemetry removed - this is now a no-op
	return nil
}

func (ws *WshServer) GetVarCommand(ctx context.Context, data wshrpc.CommandVarData) (*wshrpc.CommandVarResponseData, error) {
	_, fileData, err := filestore.WFS.ReadFile(ctx, data.ZoneId, data.FileName)
	if err == fs.ErrNotExist {
		return &wshrpc.CommandVarResponseData{Key: data.Key, Exists: false}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("error reading blockfile: %w", err)
	}
	envMap := envutil.EnvToMap(string(fileData))
	value, ok := envMap[data.Key]
	return &wshrpc.CommandVarResponseData{Key: data.Key, Exists: ok, Val: value}, nil
}

func (ws *WshServer) GetAllVarsCommand(ctx context.Context, data wshrpc.CommandVarData) ([]wshrpc.CommandVarResponseData, error) {
	_, fileData, err := filestore.WFS.ReadFile(ctx, data.ZoneId, data.FileName)
	if err == fs.ErrNotExist {
		return []wshrpc.CommandVarResponseData{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("error reading blockfile: %w", err)
	}
	envMap := envutil.EnvToMap(string(fileData))
	keys := make([]string, 0, len(envMap))
	for k := range envMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	result := make([]wshrpc.CommandVarResponseData, 0, len(keys))
	for _, k := range keys {
		result = append(result, wshrpc.CommandVarResponseData{
			Key:    k,
			Val:    envMap[k],
			Exists: true,
		})
	}
	return result, nil
}

func (ws *WshServer) SetVarCommand(ctx context.Context, data wshrpc.CommandVarData) error {
	_, fileData, err := filestore.WFS.ReadFile(ctx, data.ZoneId, data.FileName)
	if err == fs.ErrNotExist {
		fileData = []byte{}
		err = filestore.WFS.MakeFile(ctx, data.ZoneId, data.FileName, nil, wshrpc.FileOpts{})
		if err != nil {
			return fmt.Errorf("error creating blockfile: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("error reading blockfile: %w", err)
	}
	envMap := envutil.EnvToMap(string(fileData))
	if data.Remove {
		delete(envMap, data.Key)
	} else {
		envMap[data.Key] = data.Val
	}
	envStr := envutil.MapToEnv(envMap)
	return filestore.WFS.WriteFile(ctx, data.ZoneId, data.FileName, []byte(envStr))
}

func (ws *WshServer) PathCommand(ctx context.Context, data wshrpc.PathCommandData) (string, error) {
	pathType := data.PathType
	openInternal := data.Open
	openExternal := data.OpenExternal
	var path string
	switch pathType {
	case "config":
		path = wavebase.GetWaveConfigDir()
	case "data":
		path = wavebase.GetWaveDataDir()
	case "log":
		path = filepath.Join(wavebase.GetWaveDataDir(), "waveapp.log")
	}

	if openInternal && openExternal {
		return "", fmt.Errorf("open and openExternal cannot both be true")
	}

	if openInternal {
		_, err := ws.CreateBlockCommand(ctx, wshrpc.CommandCreateBlockData{
			TabId: data.TabId,
			BlockDef: &waveobj.BlockDef{Meta: map[string]any{
				waveobj.MetaKey_View: "preview",
				waveobj.MetaKey_File: path,
			}},
			Ephemeral: true,
			Focused:   true,
		})

		if err != nil {
			return path, fmt.Errorf("error opening path: %w", err)
		}
	} else if openExternal {
		err := open.Run(path)
		if err != nil {
			return path, fmt.Errorf("error opening path: %w", err)
		}
	}
	return path, nil
}

func (ws *WshServer) FetchSuggestionsCommand(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	return suggestion.FetchSuggestions(ctx, data)
}

func (ws *WshServer) DisposeSuggestionsCommand(ctx context.Context, widgetId string) error {
	suggestion.DisposeSuggestions(ctx, widgetId)
	return nil
}

func (ws *WshServer) GetTabCommand(ctx context.Context, tabId string) (*waveobj.Tab, error) {
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	return tab, nil
}

func (ws *WshServer) GetAllTabIndicatorsCommand(ctx context.Context) (map[string]*wshrpc.TabIndicator, error) {
	return wcore.GetAllTabIndicators(), nil
}

func (ws *WshServer) GetSecretsCommand(ctx context.Context, names []string) (map[string]string, error) {
	result := make(map[string]string)
	for _, name := range names {
		value, exists, err := secretstore.GetSecret(name)
		if err != nil {
			return nil, fmt.Errorf("error getting secret %q: %w", name, err)
		}
		if exists {
			result[name] = value
		}
	}
	return result, nil
}

func (ws *WshServer) GetSecretsNamesCommand(ctx context.Context) ([]string, error) {
	names, err := secretstore.GetSecretNames()
	if err != nil {
		return nil, fmt.Errorf("error getting secret names: %w", err)
	}
	return names, nil
}

func (ws *WshServer) SetSecretsCommand(ctx context.Context, secrets map[string]*string) error {
	for name, value := range secrets {
		if value == nil {
			err := secretstore.DeleteSecret(name)
			if err != nil {
				return fmt.Errorf("error deleting secret %q: %w", name, err)
			}
		} else {
			err := secretstore.SetSecret(name, *value)
			if err != nil {
				return fmt.Errorf("error setting secret %q: %w", name, err)
			}
		}
	}
	return nil
}

func (ws *WshServer) GetSecretsLinuxStorageBackendCommand(ctx context.Context) (string, error) {
	backend, err := secretstore.GetLinuxStorageBackend()
	if err != nil {
		return "", fmt.Errorf("error getting linux storage backend: %w", err)
	}
	return backend, nil
}

func (ws *WshServer) JobCmdExitedCommand(ctx context.Context, data wshrpc.CommandJobCmdExitedData) error {
	return jobcontroller.HandleCmdJobExited(ctx, data.JobId, data)
}

func (ws *WshServer) JobControllerListCommand(ctx context.Context) ([]*waveobj.Job, error) {
	return wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
}

func (ws *WshServer) JobControllerDeleteJobCommand(ctx context.Context, jobId string) error {
	return jobcontroller.DeleteJob(ctx, jobId)
}

func (ws *WshServer) JobControllerStartJobCommand(ctx context.Context, data wshrpc.CommandJobControllerStartJobData) (string, error) {
	params := jobcontroller.StartJobParams{
		ConnName: data.ConnName,
		Cmd:      data.Cmd,
		Args:     data.Args,
		Env:      data.Env,
		TermSize: data.TermSize,
	}
	return jobcontroller.StartJob(ctx, params)
}

func (ws *WshServer) JobControllerExitJobCommand(ctx context.Context, jobId string) error {
	return jobcontroller.TerminateJobManager(ctx, jobId)
}

func (ws *WshServer) JobControllerDisconnectJobCommand(ctx context.Context, jobId string) error {
	return jobcontroller.DisconnectJob(ctx, jobId)
}

func (ws *WshServer) JobControllerReconnectJobCommand(ctx context.Context, jobId string) error {
	return jobcontroller.ReconnectJob(ctx, jobId, nil)
}

func (ws *WshServer) JobControllerReconnectJobsForConnCommand(ctx context.Context, connName string) error {
	return jobcontroller.ReconnectJobsForConn(ctx, connName, nil)
}

func (ws *WshServer) JobControllerConnectedJobsCommand(ctx context.Context) ([]string, error) {
	return jobcontroller.GetConnectedJobIds(), nil
}

func (ws *WshServer) JobControllerAttachJobCommand(ctx context.Context, data wshrpc.CommandJobControllerAttachJobData) error {
	return jobcontroller.AttachJobToBlock(ctx, data.JobId, data.BlockId)
}

func (ws *WshServer) JobControllerDetachJobCommand(ctx context.Context, jobId string) error {
	return jobcontroller.DetachJobFromBlock(ctx, jobId, true)
}

// OMP (Oh-My-Posh) integration handlers

func (ws *WshServer) OmpGetConfigInfoCommand(ctx context.Context) (wshrpc.CommandOmpGetConfigInfoRtnData, error) {
	result := wshrpc.CommandOmpGetConfigInfoRtnData{}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	result.ConfigPath = configPath
	result.Format = string(wshutil.DetectConfigFormat(configPath))
	result.Exists = true

	content, err := os.ReadFile(configPath)
	if err != nil {
		result.Readable = false
		result.Error = fmt.Sprintf("cannot read: %v", err)
		return result, nil
	}
	result.Readable = true

	fileInfo, _ := os.Stat(configPath)
	if fileInfo != nil && fileInfo.Mode().Perm()&0200 != 0 {
		result.Writable = true
	}

	result.CurrentPalette, _ = wshutil.ExtractPaletteFromConfig(content, result.Format)

	return result, nil
}

func (ws *WshServer) OmpWritePaletteCommand(ctx context.Context, data wshrpc.CommandOmpWritePaletteData) (wshrpc.CommandOmpWritePaletteRtnData, error) {
	result := wshrpc.CommandOmpWritePaletteRtnData{}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	if data.CreateBackup {
		backupPath := configPath + ".backup"
		content, err := os.ReadFile(configPath)
		if err == nil {
			// Preserve original file permissions for backup
			origInfo, statErr := os.Stat(configPath)
			backupMode := os.FileMode(0600) // Default to more restrictive
			if statErr == nil {
				backupMode = origInfo.Mode()
			}
			if err := os.WriteFile(backupPath, content, backupMode); err != nil {
				result.Error = fmt.Sprintf("backup failed: %v", err)
				return result, nil
			}
			result.BackupPath = backupPath
		}
	}

	newContent, err := wshutil.MergePaletteIntoConfig(configPath, data.Palette)
	if err != nil {
		result.Error = fmt.Sprintf("merge failed: %v", err)
		return result, nil
	}

	fileInfo, _ := os.Stat(configPath)
	mode := os.FileMode(0644)
	if fileInfo != nil {
		mode = fileInfo.Mode()
	}

	err = os.WriteFile(configPath, newContent, mode)
	if err != nil {
		result.Error = fmt.Sprintf("write failed: %v", err)
		return result, nil
	}

	result.Success = true
	return result, nil
}

func (ws *WshServer) OmpAnalyzeCommand(ctx context.Context, data wshrpc.CommandOmpAnalyzeData) (wshrpc.CommandOmpAnalyzeRtnData, error) {
	result := wshrpc.CommandOmpAnalyzeRtnData{}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		result.Error = fmt.Sprintf("cannot read config: %v", err)
		return result, nil
	}

	config, err := wshutil.ParseOmpConfig(content)
	if err != nil {
		result.Error = fmt.Sprintf("cannot parse config: %v", err)
		return result, nil
	}

	transparentSegments := wshutil.DetectTransparentSegments(config)

	// Convert to RPC type
	for _, seg := range transparentSegments {
		result.TransparentSegments = append(result.TransparentSegments, wshrpc.TransparentSegmentInfo{
			BlockIndex:   seg.BlockIndex,
			SegmentIndex: seg.SegmentIndex,
			SegmentType:  seg.SegmentType,
			Foreground:   seg.Foreground,
		})
	}

	result.HasTransparency = len(transparentSegments) > 0
	return result, nil
}

func (ws *WshServer) OmpApplyHighContrastCommand(ctx context.Context, data wshrpc.CommandOmpApplyHighContrastData) (wshrpc.CommandOmpApplyHighContrastRtnData, error) {
	result := wshrpc.CommandOmpApplyHighContrastRtnData{}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	// Create backup if requested
	if data.CreateBackup {
		backupPath, err := wshutil.CreateOmpBackup(configPath)
		if err != nil {
			result.Error = fmt.Sprintf("backup failed: %v", err)
			return result, nil
		}
		result.BackupPath = backupPath
	}

	// Read and parse current config
	content, err := os.ReadFile(configPath)
	if err != nil {
		result.Error = fmt.Sprintf("cannot read config: %v", err)
		return result, nil
	}

	config, err := wshutil.ParseOmpConfig(content)
	if err != nil {
		result.Error = fmt.Sprintf("cannot parse config: %v", err)
		return result, nil
	}

	// Apply high contrast mode
	modifiedConfig := wshutil.ApplyHighContrastMode(config)

	// Serialize the modified config
	newContent, err := wshutil.SerializeOmpConfig(modifiedConfig)
	if err != nil {
		result.Error = fmt.Sprintf("cannot serialize config: %v", err)
		return result, nil
	}

	// Write the modified config
	fileInfo, _ := os.Stat(configPath)
	mode := os.FileMode(0644)
	if fileInfo != nil {
		mode = fileInfo.Mode()
	}

	if err := os.WriteFile(configPath, newContent, mode); err != nil {
		result.Error = fmt.Sprintf("write failed: %v", err)
		return result, nil
	}

	result.Success = true
	result.ModifiedPath = configPath
	return result, nil
}

func (ws *WshServer) OmpRestoreBackupCommand(ctx context.Context, data wshrpc.CommandOmpRestoreBackupData) (wshrpc.CommandOmpRestoreBackupRtnData, error) {
	result := wshrpc.CommandOmpRestoreBackupRtnData{}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	if err := wshutil.RestoreOmpBackup(configPath); err != nil {
		result.Error = err.Error()
		return result, nil
	}

	result.Success = true
	return result, nil
}

// OmpReadConfigCommand reads the full OMP configuration for the configurator
func (ws *WshServer) OmpReadConfigCommand(ctx context.Context) (wshrpc.CommandOmpReadConfigRtnData, error) {
	result := wshrpc.CommandOmpReadConfigRtnData{}

	// Determine config source
	poshTheme := os.Getenv("POSH_THEME")
	if poshTheme != "" {
		result.Source = "POSH_THEME"
	} else {
		result.Source = "default"
	}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	result.ConfigPath = configPath

	// Detect format
	format := wshutil.DetectConfigFormat(configPath)
	result.Format = string(format)

	// Check if backup exists
	backupPath := wshutil.GetBackupPath(configPath)
	if _, err := os.Stat(backupPath); err == nil {
		result.BackupExists = true
	}

	// Read the file
	content, err := os.ReadFile(configPath)
	if err != nil {
		result.Error = fmt.Sprintf("Failed to read config: %v", err)
		return result, nil
	}

	// For JSON, parse and return structured config
	if format == wshutil.OmpFormatJSON {
		var config wshrpc.OmpConfigData
		if err := json.Unmarshal(content, &config); err != nil {
			result.Error = fmt.Sprintf("Failed to parse config: %v", err)
			result.RawContent = string(content)
			return result, nil
		}
		result.Config = &config
	} else {
		// For YAML/TOML, return raw content (not yet supported for editing)
		result.RawContent = string(content)
	}

	return result, nil
}

// OmpWriteConfigCommand writes the full OMP configuration
func (ws *WshServer) OmpWriteConfigCommand(ctx context.Context, data wshrpc.CommandOmpWriteConfigData) (wshrpc.CommandOmpWriteConfigRtnData, error) {
	result := wshrpc.CommandOmpWriteConfigRtnData{}

	if data.Config == nil {
		result.Error = "Config is required"
		return result, nil
	}

	configPath, err := wshutil.GetOmpConfigPath()
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	// Validate the path
	if err := wshutil.ValidateOmpConfigPath(configPath); err != nil {
		result.Error = err.Error()
		return result, nil
	}

	// Create backup if requested
	if data.CreateBackup {
		backupPath, err := wshutil.CreateOmpBackup(configPath)
		if err != nil {
			result.Error = fmt.Sprintf("Failed to create backup: %v", err)
			return result, nil
		}
		result.BackupPath = backupPath
	}

	// Serialize the config to JSON with nice formatting
	content, err := json.MarshalIndent(data.Config, "", "  ")
	if err != nil {
		result.Error = fmt.Sprintf("Failed to serialize config: %v", err)
		return result, nil
	}

	// Get original file permissions
	origInfo, err := os.Stat(configPath)
	mode := os.FileMode(0644)
	if err == nil {
		mode = origInfo.Mode()
	}

	// Write the file
	if err := os.WriteFile(configPath, content, mode); err != nil {
		result.Error = fmt.Sprintf("Failed to write config: %v", err)
		return result, nil
	}

	result.Success = true
	return result, nil
}

// OmpReinitCommand sends the OMP reinit command to a terminal block
func (ws *WshServer) OmpReinitCommand(ctx context.Context, data wshrpc.CommandOmpReinitData) error {
	if data.BlockId == "" {
		return fmt.Errorf("blockid is required")
	}

	// Get block data to validate it exists and is a terminal
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	// Validate block is a terminal view
	viewType := blockData.Meta.GetString(waveobj.MetaKey_View, "")
	if viewType != "term" {
		return fmt.Errorf("block %s is not a terminal (view=%s)", data.BlockId, viewType)
	}

	// Get shell path from block or connection to determine shell type
	shellPath := blockData.Meta.GetString(waveobj.MetaKey_TermLocalShellPath, "")
	if shellPath == "" {
		// Try to get from settings
		settings := wconfig.GetWatcher().GetFullConfig().Settings
		shellPath = settings.TermLocalShellPath
	}
	if shellPath == "" {
		// Use default detection
		shellPath = shellutil.DetectLocalShellPath()
	}

	shellType := shellutil.GetShellTypeFromShellPath(shellPath)

	// Generate the OMP reinit command based on shell type
	var reinitCmd string
	switch shellType {
	case shellutil.ShellType_pwsh:
		reinitCmd = "oh-my-posh init pwsh --config $env:POSH_THEME | Invoke-Expression"
	case shellutil.ShellType_bash:
		reinitCmd = `eval "$(oh-my-posh init bash --config $POSH_THEME)"`
	case shellutil.ShellType_zsh:
		reinitCmd = `eval "$(oh-my-posh init zsh --config $POSH_THEME)"`
	default:
		return fmt.Errorf("unsupported shell type for OMP reinit: %s", shellType)
	}

	// Send the reinit command to the terminal as input
	inputData := []byte(reinitCmd + "\n")
	inputUnion := &blockcontroller.BlockInputUnion{
		InputData: inputData,
	}

	err = blockcontroller.SendInput(data.BlockId, inputUnion)
	if err != nil {
		return fmt.Errorf("error sending OMP reinit command to terminal: %w", err)
	}

	return nil
}
