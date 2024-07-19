// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// this file contains the implementation of the wsh server methods

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"reflect"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

var RespStreamTest_MethodDecl = &WshServerMethodDecl{
	Command:                 "streamtest",
	CommandType:             wshutil.RpcType_ResponseStream,
	MethodName:              "RespStreamTest",
	Method:                  reflect.ValueOf(WshServerImpl.RespStreamTest),
	CommandDataType:         nil,
	DefaultResponseDataType: reflect.TypeOf((int)(0)),
}

var WshServerCommandToDeclMap = map[string]*WshServerMethodDecl{
	wshrpc.Command_Message:     GetWshServerMethod(wshrpc.Command_Message, wshutil.RpcType_Call, "MessageCommand", WshServerImpl.MessageCommand),
	wshrpc.Command_SetView:     GetWshServerMethod(wshrpc.Command_SetView, wshutil.RpcType_Call, "BlockSetViewCommand", WshServerImpl.BlockSetViewCommand),
	wshrpc.Command_SetMeta:     GetWshServerMethod(wshrpc.Command_SetMeta, wshutil.RpcType_Call, "SetMetaCommand", WshServerImpl.SetMetaCommand),
	wshrpc.Command_GetMeta:     GetWshServerMethod(wshrpc.Command_GetMeta, wshutil.RpcType_Call, "GetMetaCommand", WshServerImpl.GetMetaCommand),
	wshrpc.Command_ResolveIds:  GetWshServerMethod(wshrpc.Command_ResolveIds, wshutil.RpcType_Call, "ResolveIdsCommand", WshServerImpl.ResolveIdsCommand),
	wshrpc.Command_CreateBlock: GetWshServerMethod(wshrpc.Command_CreateBlock, wshutil.RpcType_Call, "CreateBlockCommand", WshServerImpl.CreateBlockCommand),
	wshrpc.Command_Restart:     GetWshServerMethod(wshrpc.Command_Restart, wshutil.RpcType_Call, "BlockRestartCommand", WshServerImpl.BlockRestartCommand),
	wshrpc.Command_BlockInput:  GetWshServerMethod(wshrpc.Command_BlockInput, wshutil.RpcType_Call, "BlockInputCommand", WshServerImpl.BlockInputCommand),
	wshrpc.Command_AppendFile:  GetWshServerMethod(wshrpc.Command_AppendFile, wshutil.RpcType_Call, "AppendFileCommand", WshServerImpl.AppendFileCommand),
	wshrpc.Command_AppendIJson: GetWshServerMethod(wshrpc.Command_AppendIJson, wshutil.RpcType_Call, "AppendIJsonCommand", WshServerImpl.AppendIJsonCommand),
	wshrpc.Command_DeleteBlock: GetWshServerMethod(wshrpc.Command_DeleteBlock, wshutil.RpcType_Call, "DeleteBlockCommand", WshServerImpl.DeleteBlockCommand),
	"streamtest":               RespStreamTest_MethodDecl,
}

// for testing
func (ws *WshServer) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	log.Printf("MESSAGE: %s | %q\n", data.ORef, data.Message)
	return nil
}

// for testing
func (ws *WshServer) RespStreamTest(ctx context.Context) chan wshrpc.RespOrErrorUnion[int] {
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

func (ws *WshServer) GetMetaCommand(ctx context.Context, data wshrpc.CommandGetMetaData) (wshrpc.MetaDataType, error) {
	log.Printf("calling meta: %s\n", data.ORef)
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
	oref := data.ORef
	if oref.IsEmpty() {
		return fmt.Errorf("no oref")
	}
	log.Printf("SETMETA: %s | %v\n", oref, data.Meta)
	obj, err := wstore.DBGetORef(ctx, oref)
	if err != nil {
		return fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil
	}
	meta := waveobj.GetMeta(obj)
	if meta == nil {
		meta = make(map[string]any)
	}
	for k, v := range data.Meta {
		if v == nil {
			delete(meta, k)
			continue
		}
		meta[k] = v
	}
	waveobj.SetMeta(obj, meta)
	err = wstore.DBUpdate(ctx, obj)
	if err != nil {
		return fmt.Errorf("error updating block: %w", err)
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
		Data: wstore.WaveObjUpdate{
			UpdateType: wstore.UpdateType_Update,
			OType:      waveObj.GetOType(),
			OID:        waveobj.GetOID(waveObj),
			Obj:        waveObj,
		},
	})
}

func resolveSimpleId(ctx context.Context, simpleId string) (*waveobj.ORef, error) {
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
		oref, err := resolveSimpleId(ctx, simpleId)
		if err != nil || oref == nil {
			continue
		}
		rtn.ResolvedIds[simpleId] = *oref
	}
	return rtn, nil
}

func sendWStoreUpdatesToEventBus(updates wstore.UpdatesRtnType) {
	for _, update := range updates {
		eventbus.SendEvent(eventbus.WSEventType{
			EventType: eventbus.WSEvent_WaveObjUpdate,
			ORef:      waveobj.MakeORef(update.OType, update.OID).String(),
			Data:      update,
		})
	}
}

func (ws *WshServer) CreateBlockCommand(ctx context.Context, data wshrpc.CommandCreateBlockData) (*waveobj.ORef, error) {
	ctx = wstore.ContextWithUpdates(ctx)
	tabId := data.TabId
	if data.TabId != "" {
		tabId = data.TabId
	}
	blockData, err := wstore.CreateBlock(ctx, tabId, data.BlockDef, data.RtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	if blockData.Controller != "" {
		// TODO
		err = blockcontroller.StartBlockController(ctx, data.TabId, blockData.OID)
		if err != nil {
			return nil, fmt.Errorf("error starting block controller: %w", err)
		}
	}
	updates := wstore.ContextGetUpdatesRtn(ctx)
	sendWStoreUpdatesToEventBus(updates)
	windowId, err := wstore.DBFindWindowForTabId(ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error finding window for tab: %w", err)
	}
	if windowId == "" {
		return nil, fmt.Errorf("no window found for tab")
	}
	eventbus.SendEventToWindow(windowId, eventbus.WSEventType{
		EventType: eventbus.WSEvent_LayoutAction,
		Data: &eventbus.WSLayoutActionData{
			ActionType: "insert",
			TabId:      tabId,
			BlockId:    blockData.OID,
		},
	})
	return &waveobj.ORef{OType: wstore.OType_Block, OID: blockData.OID}, nil
}

func (ws *WshServer) BlockSetViewCommand(ctx context.Context, data wshrpc.CommandBlockSetViewData) error {
	log.Printf("SETVIEW: %s | %q\n", data.BlockId, data.View)
	ctx = wstore.ContextWithUpdates(ctx)
	block, err := wstore.DBGet[*wstore.Block](ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	block.View = data.View
	err = wstore.DBUpdate(ctx, block)
	if err != nil {
		return fmt.Errorf("error updating block: %w", err)
	}
	updates := wstore.ContextGetUpdatesRtn(ctx)
	sendWStoreUpdatesToEventBus(updates)
	return nil
}

func (ws *WshServer) BlockRestartCommand(ctx context.Context, data wshrpc.CommandBlockRestartData) error {
	bc := blockcontroller.GetBlockController(data.BlockId)
	if bc == nil {
		return fmt.Errorf("block controller not found for block %q", data.BlockId)
	}
	return bc.RestartController()
}

func (ws *WshServer) BlockInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
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

func (ws *WshServer) AppendFileCommand(ctx context.Context, data wshrpc.CommandAppendFileData) error {
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
		ORef:      waveobj.MakeORef(wstore.OType_Block, data.ZoneId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   data.ZoneId,
			FileName: data.FileName,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(dataBuf),
		},
	})
	return nil
}

func (ws *WshServer) AppendIJsonCommand(ctx context.Context, data wshrpc.CommandAppendIJsonData) error {
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
		ORef:      waveobj.MakeORef(wstore.OType_Block, data.ZoneId).String(),
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
	ctx = wstore.ContextWithUpdates(ctx)
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
	err = wstore.DeleteBlock(ctx, tabId, data.BlockId)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	eventbus.SendEventToWindow(windowId, eventbus.WSEventType{
		EventType: eventbus.WSEvent_LayoutAction,
		Data: &eventbus.WSLayoutActionData{
			ActionType: "delete",
			TabId:      tabId,
			BlockId:    data.BlockId,
		},
	})
	blockcontroller.StopBlockController(data.BlockId)
	updates := wstore.ContextGetUpdatesRtn(ctx)
	sendWStoreUpdatesToEventBus(updates)
	return nil
}
