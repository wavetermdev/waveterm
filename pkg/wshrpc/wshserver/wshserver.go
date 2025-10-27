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
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/skratchdot/open-golang/open"
	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/awsconn"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare"
	"github.com/wavetermdev/waveterm/pkg/suggestion"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/util/iterfn"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/util/wavefileutil"
	"github.com/wavetermdev/waveterm/pkg/waveai"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcloud"
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

// TODO remove this after implementing in multiproxy, just for wsl
func (ws *WshServer) AuthenticateTokenCommand(ctx context.Context, data wshrpc.CommandAuthenticateTokenData) (wshrpc.CommandAuthenticateRtnData, error) {
	entry := shellutil.GetAndRemoveTokenSwapEntry(data.Token)
	if entry == nil {
		return wshrpc.CommandAuthenticateRtnData{}, fmt.Errorf("invalid token")
	}
	rtn := wshrpc.CommandAuthenticateRtnData{
		Env:            entry.Env,
		InitScriptText: entry.ScriptText,
	}
	return rtn, nil
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
	log.Printf("MESSAGE: %s | %q\n", data.ORef, data.Message)
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

func (ws *WshServer) SetViewCommand(ctx context.Context, data wshrpc.CommandBlockSetViewData) error {
	log.Printf("SETVIEW: %s | %q\n", data.BlockId, data.View)
	ctx = waveobj.ContextWithUpdates(ctx)
	block, err := wstore.DBGet[*waveobj.Block](ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	block.Meta[waveobj.MetaKey_View] = data.View
	err = wstore.DBUpdate(ctx, block)
	if err != nil {
		return fmt.Errorf("error updating block: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	wps.Broker.SendUpdateEvents(updates)
	return nil
}

func (ws *WshServer) ControllerStopCommand(ctx context.Context, blockId string) error {
	blockcontroller.StopBlockController(blockId)
	return nil
}

func (ws *WshServer) ControllerResyncCommand(ctx context.Context, data wshrpc.CommandControllerResyncData) error {
	ctx = genconn.ContextWithConnData(ctx, data.BlockId)
	ctx = termCtxWithLogBlockId(ctx, data.BlockId)
	return blockcontroller.ResyncController(ctx, data.TabId, data.BlockId, data.RtOpts, data.ForceRestart)
}

func (ws *WshServer) ControllerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
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
	err := fileshare.PutFile(ctx, data)
	if err != nil {
		return fmt.Errorf("error creating file: %w", err)
	}
	return nil
}

func (ws *WshServer) FileMkdirCommand(ctx context.Context, data wshrpc.FileData) error {
	return fileshare.Mkdir(ctx, data.Info.Path)
}

func (ws *WshServer) FileDeleteCommand(ctx context.Context, data wshrpc.CommandDeleteFileData) error {
	return fileshare.Delete(ctx, data)
}

func (ws *WshServer) FileInfoCommand(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileInfo, error) {
	return fileshare.Stat(ctx, data.Info.Path)
}

func (ws *WshServer) FileListCommand(ctx context.Context, data wshrpc.FileListData) ([]*wshrpc.FileInfo, error) {
	return fileshare.ListEntries(ctx, data.Path, data.Opts)
}

func (ws *WshServer) FileListStreamCommand(ctx context.Context, data wshrpc.FileListData) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return fileshare.ListEntriesStream(ctx, data.Path, data.Opts)
}

func (ws *WshServer) FileWriteCommand(ctx context.Context, data wshrpc.FileData) error {
	return fileshare.PutFile(ctx, data)
}

func (ws *WshServer) FileReadCommand(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileData, error) {
	return fileshare.Read(ctx, data)
}

func (ws *WshServer) FileReadStreamCommand(ctx context.Context, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	return fileshare.ReadStream(ctx, data)
}

func (ws *WshServer) FileCopyCommand(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	return fileshare.Copy(ctx, data)
}

func (ws *WshServer) FileMoveCommand(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	return fileshare.Move(ctx, data)
}

func (ws *WshServer) FileStreamTarCommand(ctx context.Context, data wshrpc.CommandRemoteStreamTarData) <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet] {
	return fileshare.ReadTarStream(ctx, data)
}

func (ws *WshServer) FileAppendCommand(ctx context.Context, data wshrpc.FileData) error {
	return fileshare.Append(ctx, data)
}

func (ws *WshServer) FileAppendIJsonCommand(ctx context.Context, data wshrpc.CommandAppendIJsonData) error {
	tryCreate := true
	if data.FileName == wavebase.BlockFile_VDom && tryCreate {
		err := filestore.WFS.MakeFile(ctx, data.ZoneId, data.FileName, nil, wshrpc.FileOpts{MaxSize: blockcontroller.DefaultHtmlMaxFileSize, IJson: true})
		if err != nil && err != fs.ErrExist {
			return fmt.Errorf("error creating blockfile[vdom]: %w", err)
		}
	}
	err := filestore.WFS.AppendIJson(ctx, data.ZoneId, data.FileName, data.Data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile(ijson): %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, data.ZoneId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   data.ZoneId,
			FileName: data.FileName,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString([]byte("{}")),
		},
	})
	return nil
}

func (ws *WshServer) FileJoinCommand(ctx context.Context, paths []string) (*wshrpc.FileInfo, error) {
	if len(paths) < 2 {
		if len(paths) == 0 {
			return nil, fmt.Errorf("no paths provided")
		}
		return fileshare.Stat(ctx, paths[0])
	}
	return fileshare.Join(ctx, paths[0], paths[1:]...)
}

func (ws *WshServer) FileShareCapabilityCommand(ctx context.Context, path string) (wshrpc.FileShareCapability, error) {
	return fileshare.GetCapability(ctx, path)
}

func (ws *WshServer) DeleteSubBlockCommand(ctx context.Context, data wshrpc.CommandDeleteBlockData) error {
	err := wcore.DeleteBlock(ctx, data.BlockId, false)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	return nil
}

func (ws *WshServer) DeleteBlockCommand(ctx context.Context, data wshrpc.CommandDeleteBlockData) error {
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
	log.Printf("SETCONFIG: %v\n", data)
	return wconfig.SetBaseConfigValue(data.MetaMapType)
}

func (ws *WshServer) SetConnectionsConfigCommand(ctx context.Context, data wshrpc.ConnConfigRequest) error {
	log.Printf("SET CONNECTIONS CONFIG: %v\n", data)
	return wconfig.SetConnectionsConfigValue(data.Host, data.MetaMapType)
}

func (ws *WshServer) GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error) {
	watcher := wconfig.GetWatcher()
	return watcher.GetFullConfig(), nil
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
	// TODO: if we add proper wsh connections via aws, we'll need to handle that here
	if strings.HasPrefix(data.ConnName, "aws:") {
		profiles := awsconn.ParseProfiles()
		for profile := range profiles {
			if strings.HasPrefix(data.ConnName, profile) {
				return nil
			}
		}
	}
	ctx = genconn.ContextWithConnData(ctx, data.LogBlockId)
	ctx = termCtxWithLogBlockId(ctx, data.LogBlockId)
	if strings.HasPrefix(data.ConnName, "wsl://") {
		distroName := strings.TrimPrefix(data.ConnName, "wsl://")
		return wslconn.EnsureConnection(ctx, distroName)
	}
	return conncontroller.EnsureConnection(ctx, data.ConnName)
}

func (ws *WshServer) ConnDisconnectCommand(ctx context.Context, connName string) error {
	// TODO: if we add proper wsh connections via aws, we'll need to handle that here
	if strings.HasPrefix(connName, "aws:") {
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
	// TODO: if we add proper wsh connections via aws, we'll need to handle that here
	if strings.HasPrefix(connRequest.Host, "aws:") {
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
	// TODO: if we add proper wsh connections via aws, we'll need to handle that here
	if strings.HasPrefix(data.ConnName, "aws:") {
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

func (ws *WshServer) ConnListAWSCommand(ctx context.Context) ([]string, error) {
	profilesMap := awsconn.ParseProfiles()
	return iterfn.MapKeysToSorted(profilesMap), nil
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
	fileInfoList := wavefileutil.WaveFileListToFileInfoList(fileList)
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

		for _, tabID := range append(wsData.PinnedTabIds, wsData.TabIds...) {
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

func (ws *WshServer) ListAllEditableAppsCommand(ctx context.Context) ([]string, error) {
	return waveappstore.ListAllEditableApps()
}

func (ws *WshServer) RecordTEventCommand(ctx context.Context, data telemetrydata.TEvent) error {
	err := telemetry.RecordTEvent(ctx, &data)
	if err != nil {
		log.Printf("error recording telemetry event: %v", err)
	}
	return err
}

func (ws WshServer) SendTelemetryCommand(ctx context.Context) error {
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("getting client data for telemetry: %v", err)
	}
	return wcloud.SendAllTelemetry(client.OID)
}

func (ws *WshServer) WaveAIEnableTelemetryCommand(ctx context.Context) error {
	// Enable telemetry in config
	meta := waveobj.MetaMapType{
		wconfig.ConfigKey_TelemetryEnabled: true,
	}
	err := wconfig.SetBaseConfigValue(meta)
	if err != nil {
		return fmt.Errorf("error setting telemetry enabled: %w", err)
	}

	// Get client for telemetry operations
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("getting client data for telemetry: %v", err)
	}

	// Send no-telemetry update to cloud (async)
	go func() {
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		err := wcloud.SendNoTelemetryUpdate(ctx, client.OID, false) // false means telemetry is enabled
		if err != nil {
			log.Printf("error sending no-telemetry update: %v", err)
		}
	}()

	// Record the telemetry event
	event := telemetrydata.MakeTEvent("waveai:enabletelemetry", telemetrydata.TEventProps{})
	err = telemetry.RecordTEvent(ctx, event)
	if err != nil {
		log.Printf("error recording waveai:enabletelemetry event: %v", err)
	}

	// Immediately send telemetry to cloud
	err = wcloud.SendAllTelemetry(client.OID)
	if err != nil {
		log.Printf("error sending telemetry after enabling: %v", err)
	}

	return nil
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
	return aiusechat.UpdateToolApproval(data.ToolCallId, data.Approval, data.KeepAlive)
}

var wshActivityRe = regexp.MustCompile(`^[a-z:#]+$`)

func (ws *WshServer) WshActivityCommand(ctx context.Context, data map[string]int) error {
	if len(data) == 0 {
		return nil
	}
	props := telemetrydata.TEventProps{}
	for key, value := range data {
		if len(key) > 20 {
			delete(data, key)
		}
		if !wshActivityRe.MatchString(key) {
			delete(data, key)
		}
		if value != 1 {
			delete(data, key)
		}
		if strings.HasSuffix(key, "#error") {
			props.WshHadError = true
		} else {
			props.WshCmd = key
		}
	}
	activityUpdate := wshrpc.ActivityUpdate{
		WshCmds: data,
	}
	telemetry.GoUpdateActivityWrap(activityUpdate, "wsh-activity")
	telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
		Event: "wsh:run",
		Props: props,
	})
	return nil
}

func (ws *WshServer) ActivityCommand(ctx context.Context, activity wshrpc.ActivityUpdate) error {
	telemetry.GoUpdateActivityWrap(activity, "wshrpc-activity")
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
		_, err := ws.CreateBlockCommand(ctx, wshrpc.CommandCreateBlockData{BlockDef: &waveobj.BlockDef{Meta: map[string]any{
			waveobj.MetaKey_View: "preview",
			waveobj.MetaKey_File: path,
		}}, Ephemeral: true, Focused: true, TabId: data.TabId})

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
