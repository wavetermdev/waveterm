// Copyright 2024, Command Line Inc.
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
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/waveai"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wconfig"
	"github.com/wavetermdev/thenextwave/pkg/wcore"
	"github.com/wavetermdev/thenextwave/pkg/wlayout"
	"github.com/wavetermdev/thenextwave/pkg/wps"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const SimpleId_This = "this"

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

var WshServerImpl = WshServer{}

func (ws *WshServer) TestCommand(ctx context.Context, data string) error {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("panic in TestCommand: %v", r)
		}
	}()
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	log.Printf("TEST src:%s | %s\n", rpcSource, data)
	if rpcSource == "" {
		return nil
	}
	go func() {
		mainClient := GetMainRpcClient()
		wshclient.MessageCommand(mainClient, wshrpc.CommandMessageData{Message: "test message"}, &wshrpc.RpcOpts{NoResponse: true, Route: rpcSource})
		resp, err := wshclient.RemoteFileInfoCommand(mainClient, "~/work/wails/thenextwave/README.md", &wshrpc.RpcOpts{Route: rpcSource})
		if err != nil {
			log.Printf("error getting remote file info: %v", err)
			return
		}
		log.Printf("remote file info: %#v\n", resp)
		rch := wshclient.RemoteStreamFileCommand(mainClient, wshrpc.CommandRemoteStreamFileData{Path: "~/work/wails/thenextwave/README.md"}, &wshrpc.RpcOpts{Route: rpcSource})
		for msg := range rch {
			if msg.Error != nil {
				log.Printf("error in stream: %v", msg.Error)
				break
			}
			if msg.Response.FileInfo != nil {
				log.Printf("stream resp (fileinfo): %v\n", msg.Response.FileInfo)
			}
			if msg.Response.Data64 != "" {
				log.Printf("stream resp (data): %v\n", len(msg.Response.Data64))
			}
		}
	}()
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
		for i := 1; i <= 5; i++ {
			rtn <- wshrpc.RespOrErrorUnion[int]{Response: i}
			time.Sleep(1 * time.Second)
		}
		close(rtn)
	}()
	return rtn
}

func (ws *WshServer) StreamWaveAiCommand(ctx context.Context, request wshrpc.OpenAiStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType] {
	if request.Opts.BaseURL == "" && request.Opts.APIToken == "" {
		return waveai.RunCloudCompletionStream(ctx, request)
	}
	return waveai.RunLocalCompletionStream(ctx, request)
}

func MakePlotData(ctx context.Context, blockId string) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(waveobj.MetaKey_View, "")
	if viewName != "cpuplot" {
		return fmt.Errorf("invalid view type: %s", viewName)
	}
	return filestore.WFS.MakeFile(ctx, blockId, "cpuplotdata", nil, filestore.FileOptsType{})
}

func SavePlotData(ctx context.Context, blockId string, history string) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(waveobj.MetaKey_View, "")
	if viewName != "cpuplot" {
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
	log.Printf("SETMETA: %s | %v\n", data.ORef, data.Meta)
	oref := data.ORef
	err := wstore.UpdateObjectMeta(ctx, oref, data.Meta)
	if err != nil {
		return fmt.Errorf("error updating object meta: %w", err)
	}
	sendWaveObjUpdate(oref)
	return nil
}

func sendWaveObjUpdate(oref waveobj.ORef) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	// send a waveobj:update event
	waveObj, err := wstore.DBGetORef(ctx, oref)
	if err != nil {
		log.Printf("error getting object for update event: %v", err)
		return
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_WaveObjUpdate,
		ORef:      oref.String(),
		Data: waveobj.WaveObjUpdate{
			UpdateType: waveobj.UpdateType_Update,
			OType:      waveObj.GetOType(),
			OID:        waveobj.GetOID(waveObj),
			Obj:        waveObj,
		},
	})
}

func resolveSimpleId(ctx context.Context, data wshrpc.CommandResolveIdsData, simpleId string) (*waveobj.ORef, error) {
	if simpleId == SimpleId_This {
		if data.BlockId == "" {
			return nil, fmt.Errorf("no blockid in request")
		}
		return &waveobj.ORef{OType: waveobj.OType_Block, OID: data.BlockId}, nil
	}
	if strings.Contains(simpleId, ":") {
		rtn, err := waveobj.ParseORef(simpleId)
		if err != nil {
			return nil, fmt.Errorf("error parsing simple id: %w", err)
		}
		return &rtn, nil
	}
	return wstore.DBResolveEasyOID(ctx, simpleId)
}

func (ws *WshServer) ResolveIdsCommand(ctx context.Context, data wshrpc.CommandResolveIdsData) (wshrpc.CommandResolveIdsRtnData, error) {
	rtn := wshrpc.CommandResolveIdsRtnData{}
	rtn.ResolvedIds = make(map[string]waveobj.ORef)
	for _, simpleId := range data.Ids {
		oref, err := resolveSimpleId(ctx, data, simpleId)
		if err != nil || oref == nil {
			continue
		}
		rtn.ResolvedIds[simpleId] = *oref
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
	blockRef := &waveobj.ORef{OType: waveobj.OType_Block, OID: blockData.OID}
	windowId, err := wstore.DBFindWindowForTabId(ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error finding window for tab: %w", err)
	}
	if windowId == "" {
		return nil, fmt.Errorf("no window found for tab")
	}
	err = wlayout.QueueLayoutActionForTab(ctx, tabId, waveobj.LayoutActionData{
		ActionType: wlayout.LayoutActionDataType_Insert,
		BlockId:    blockRef.OID,
		Magnified:  data.Magnified,
		Focused:    true,
	})
	if err != nil {
		return nil, fmt.Errorf("error queuing layout action: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	eventbus.SendUpdateEvents(updates)
	return &waveobj.ORef{OType: waveobj.OType_Block, OID: blockRef.OID}, nil
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
	eventbus.SendUpdateEvents(updates)
	return nil
}

func (ws *WshServer) ControllerRestartCommand(ctx context.Context, data wshrpc.CommandBlockRestartData) error {
	bc := blockcontroller.GetBlockController(data.BlockId)
	if bc == nil {
		return fmt.Errorf("block controller not found for block %q", data.BlockId)
	}
	return bc.RestartController()
}

func (ws *WshServer) ControllerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
	bc := blockcontroller.GetBlockController(data.BlockId)
	if bc == nil {
		return fmt.Errorf("block controller not found for block %q", data.BlockId)
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
	return bc.SendInput(inputUnion)
}

func (ws *WshServer) FileWriteCommand(ctx context.Context, data wshrpc.CommandFileData) error {
	dataBuf, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return fmt.Errorf("error decoding data64: %w", err)
	}
	err = filestore.WFS.WriteFile(ctx, data.ZoneId, data.FileName, dataBuf)
	if err != nil {
		return fmt.Errorf("error writing to blockfile: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_BlockFile,
		ORef:      waveobj.MakeORef(waveobj.OType_Block, data.ZoneId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   data.ZoneId,
			FileName: data.FileName,
			FileOp:   eventbus.FileOp_Invalidate,
		},
	})
	return nil
}

func (ws *WshServer) FileReadCommand(ctx context.Context, data wshrpc.CommandFileData) (string, error) {
	_, dataBuf, err := filestore.WFS.ReadFile(ctx, data.ZoneId, data.FileName)
	if err != nil {
		return "", fmt.Errorf("error reading blockfile: %w", err)
	}
	return base64.StdEncoding.EncodeToString(dataBuf), nil
}

func (ws *WshServer) FileAppendCommand(ctx context.Context, data wshrpc.CommandFileData) error {
	dataBuf, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return fmt.Errorf("error decoding data64: %w", err)
	}
	err = filestore.WFS.AppendData(ctx, data.ZoneId, data.FileName, dataBuf)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_BlockFile,
		ORef:      waveobj.MakeORef(waveobj.OType_Block, data.ZoneId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   data.ZoneId,
			FileName: data.FileName,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(dataBuf),
		},
	})
	return nil
}

func (ws *WshServer) FileAppendIJsonCommand(ctx context.Context, data wshrpc.CommandAppendIJsonData) error {
	tryCreate := true
	if data.FileName == blockcontroller.BlockFile_Html && tryCreate {
		err := filestore.WFS.MakeFile(ctx, data.ZoneId, data.FileName, nil, filestore.FileOptsType{MaxSize: blockcontroller.DefaultHtmlMaxFileSize, IJson: true})
		if err != nil && err != fs.ErrExist {
			return fmt.Errorf("error creating blockfile[html]: %w", err)
		}
	}
	err := filestore.WFS.AppendIJson(ctx, data.ZoneId, data.FileName, data.Data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile(ijson): %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_BlockFile,
		ORef:      waveobj.MakeORef(waveobj.OType_Block, data.ZoneId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   data.ZoneId,
			FileName: data.FileName,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString([]byte("{}")),
		},
	})
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
	windowId, err := wstore.DBFindWindowForTabId(ctx, tabId)
	if err != nil {
		return fmt.Errorf("error finding window for tab: %w", err)
	}
	if windowId == "" {
		return fmt.Errorf("no window found for tab")
	}
	err = wcore.DeleteBlock(ctx, tabId, data.BlockId)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	wlayout.QueueLayoutActionForTab(ctx, tabId, waveobj.LayoutActionData{
		ActionType: wlayout.LayoutActionDataType_Remove,
		BlockId:    data.BlockId,
	})
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	eventbus.SendUpdateEvents(updates)
	return nil
}

func (ws *WshServer) EventRecvCommand(ctx context.Context, data wshrpc.WaveEvent) error {
	return nil
}

func (ws *WshServer) EventPublishCommand(ctx context.Context, data wshrpc.WaveEvent) error {
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

func (ws *WshServer) EventSubCommand(ctx context.Context, data wshrpc.SubscriptionRequest) error {
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

func (ws *WshServer) EventReadHistoryCommand(ctx context.Context, data wshrpc.CommandEventReadHistoryData) ([]*wshrpc.WaveEvent, error) {
	events := wps.Broker.ReadEventHistory(data.Event, data.Scope, data.MaxItems)
	return events, nil
}

func (ws *WshServer) SetConfigCommand(ctx context.Context, data waveobj.MetaMapType) error {
	return wconfig.SetBaseConfigValue(data)
}
