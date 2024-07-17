// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"net"
	"os"
	"reflect"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

type WshServer struct{}

var WshServerImpl = WshServer{}
var contextRType = reflect.TypeOf((*context.Context)(nil)).Elem()

type WshServerMethodDecl struct {
	Command                 string
	CommandType             string
	MethodName              string
	Method                  reflect.Value
	CommandDataType         reflect.Type
	DefaultResponseDataType reflect.Type
	RequestDataTypes        []reflect.Type // for streaming requests
	ResponseDataTypes       []reflect.Type // for streaming responses
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
}

func GetWshServerMethod(command string, commandType string, methodName string, methodFunc any) *WshServerMethodDecl {
	methodVal := reflect.ValueOf(methodFunc)
	methodType := methodVal.Type()
	if methodType.Kind() != reflect.Func {
		panic(fmt.Sprintf("methodVal must be a function got [%v]", methodType))
	}
	if methodType.In(0) != contextRType {
		panic(fmt.Sprintf("methodVal must have a context as the first argument %v", methodType))
	}
	var defResponseType reflect.Type
	if methodType.NumOut() > 1 {
		defResponseType = methodType.Out(0)
	}
	rtn := &WshServerMethodDecl{
		Command:                 command,
		CommandType:             commandType,
		MethodName:              methodName,
		Method:                  methodVal,
		CommandDataType:         methodType.In(1),
		DefaultResponseDataType: defResponseType,
	}
	return rtn
}

func (ws *WshServer) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	log.Printf("MESSAGE: %s | %q\n", data.ORef, data.Message)
	return nil
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

func decodeRtnVals(rtnVals []reflect.Value) (any, error) {
	switch len(rtnVals) {
	case 0:
		return nil, nil
	case 1:
		errIf := rtnVals[0].Interface()
		if errIf == nil {
			return nil, nil
		}
		return nil, errIf.(error)
	case 2:
		errIf := rtnVals[1].Interface()
		if errIf == nil {
			return rtnVals[0].Interface(), nil
		}
		return rtnVals[0].Interface(), errIf.(error)
	default:
		return nil, fmt.Errorf("too many return values: %d", len(rtnVals))
	}
}

func mainWshServerHandler(handler *wshutil.RpcResponseHandler) {
	command := handler.GetCommand()
	methodDecl := WshServerCommandToDeclMap[command]
	if methodDecl == nil {
		handler.SendResponseError(fmt.Errorf("command %q not found", command))
		return
	}
	var callParams []reflect.Value
	callParams = append(callParams, reflect.ValueOf(handler.Context()))
	if methodDecl.CommandDataType != nil {
		commandData := reflect.New(methodDecl.CommandDataType).Interface()
		err := utilfn.ReUnmarshal(commandData, handler.GetCommandRawData())
		if err != nil {
			handler.SendResponseError(fmt.Errorf("error re-marshalling command data: %w", err))
			return
		}
		wshrpc.HackRpcContextIntoData(commandData, handler.GetRpcContext())
		callParams = append(callParams, reflect.ValueOf(commandData).Elem())
	}
	rtnVals := methodDecl.Method.Call(callParams)
	rtnData, rtnErr := decodeRtnVals(rtnVals)
	if rtnErr != nil {
		handler.SendResponseError(rtnErr)
		return
	} else {
		handler.SendResponse(rtnData, true)
	}
}

func MakeUnixListener(sockName string) (net.Listener, error) {
	os.Remove(sockName) // ignore error
	rtn, err := net.Listen("unix", sockName)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", sockName, err)
	}
	os.Chmod(sockName, 0700)
	log.Printf("Server listening on %s\n", sockName)
	return rtn, nil
}

func runWshRpcWithStream(conn net.Conn) {
	defer conn.Close()
	inputCh := make(chan []byte, DefaultInputChSize)
	outputCh := make(chan []byte, DefaultOutputChSize)
	go wshutil.AdaptMsgChToStream(outputCh, conn)
	go wshutil.AdaptStreamToMsgCh(conn, inputCh)
	wshutil.MakeWshRpc(inputCh, outputCh, wshutil.RpcContext{}, mainWshServerHandler)
}

func RunWshRpcOverListener(listener net.Listener) {
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				log.Printf("error accepting connection: %v\n", err)
				continue
			}
			go runWshRpcWithStream(conn)
		}
	}()
}

func RunDomainSocketWshServer() error {
	sockName := wavebase.GetDomainSocketName()
	listener, err := MakeUnixListener(sockName)
	if err != nil {
		return fmt.Errorf("error starging unix listener for wsh-server: %w", err)
	}
	defer listener.Close()
	RunWshRpcOverListener(listener)
	return nil
}

func MakeWshServer(inputCh chan []byte, outputCh chan []byte, initialCtx wshutil.RpcContext) {
	wshutil.MakeWshRpc(inputCh, outputCh, initialCtx, mainWshServerHandler)
}
