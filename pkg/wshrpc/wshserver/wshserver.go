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

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/waveai"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wps"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

func (ws *WshServer) AuthenticateCommand(ctx context.Context, data string) error {
	w := wshutil.GetWshRpcFromContext(ctx)
	if w == nil {
		return fmt.Errorf("no wshrpc in context")
	}
	newCtx, err := wshutil.ValidateAndExtractRpcContextFromToken(data)
	if err != nil {
		return fmt.Errorf("error validating token: %w", err)
	}
	if newCtx == nil {
		return fmt.Errorf("no context found in jwt token")
	}
	w.SetRpcContext(*newCtx)
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

func (ws *WshServer) StreamCpuDataCommand(ctx context.Context, request wshrpc.CpuDataRequest) chan wshrpc.RespOrErrorUnion[wshrpc.CpuDataType] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.CpuDataType])
	go func() {
		defer close(rtn)
		MakePlotData(ctx, request.Id)
		// we can use the err from MakePlotData to determine if a routine is already running
		// but we still need a way to close it or get data from it
		for {
			now := time.Now()
			percent, err := cpu.Percent(0, false)
			if err != nil {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CpuDataType]{Error: err}
			}
			var value float64
			if len(percent) > 0 {
				value = percent[0]
			} else {
				value = 0.0
			}
			cpuData := wshrpc.CpuDataType{Time: now.UnixMilli() / 1000, Value: value}
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.CpuDataType]{Response: cpuData}
			time.Sleep(time.Second * 1)
			// this will end the goroutine if the block is closed
			err = SavePlotData(ctx, request.Id, "")
			if err != nil {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CpuDataType]{Error: err}
				return
			}
			blockData, getBlockDataErr := wstore.DBMustGet[*wstore.Block](ctx, request.Id)
			if getBlockDataErr != nil {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CpuDataType]{Error: getBlockDataErr}
				return
			}
			count := blockData.Meta.GetInt(wstore.MetaKey_Count, 0)
			if count != request.Count {
				rtn <- wshrpc.RespOrErrorUnion[wshrpc.CpuDataType]{Error: fmt.Errorf("new instance created. canceling old goroutine")}
				return
			}

		}
	}()

	return rtn
}

func MakePlotData(ctx context.Context, blockId string) error {
	block, err := wstore.DBMustGet[*wstore.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(wstore.MetaKey_View, "")
	if viewName != "cpuplot" {
		return fmt.Errorf("invalid view type: %s", viewName)
	}
	return filestore.WFS.MakeFile(ctx, blockId, "cpuplotdata", nil, filestore.FileOptsType{})
}

func SavePlotData(ctx context.Context, blockId string, history string) error {
	block, err := wstore.DBMustGet[*wstore.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(wstore.MetaKey_View, "")
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
	controllerName := blockData.Meta.GetString(wstore.MetaKey_Controller, "")
	if controllerName != "" {
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

func (ws *WshServer) SetViewCommand(ctx context.Context, data wshrpc.CommandBlockSetViewData) error {
	log.Printf("SETVIEW: %s | %q\n", data.BlockId, data.View)
	ctx = wstore.ContextWithUpdates(ctx)
	block, err := wstore.DBGet[*wstore.Block](ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	block.Meta[wstore.MetaKey_View] = data.View
	err = wstore.DBUpdate(ctx, block)
	if err != nil {
		return fmt.Errorf("error updating block: %w", err)
	}
	updates := wstore.ContextGetUpdatesRtn(ctx)
	sendWStoreUpdatesToEventBus(updates)
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
		ORef:      waveobj.MakeORef(wstore.OType_Block, data.ZoneId).String(),
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

func (ws *WshServer) EventRecvCommand(ctx context.Context, data wshrpc.WaveEvent) error {
	return nil
}

func (ws *WshServer) EventPublishCommand(ctx context.Context, data wshrpc.WaveEvent) error {
	wrpc := wshutil.GetWshRpcFromContext(ctx)
	if wrpc == nil {
		return fmt.Errorf("no wshrpc in context")
	}
	if data.Sender == "" {
		data.Sender = wrpc.ClientId()
	}
	wps.Broker.Publish(data)
	return nil
}

func (ws *WshServer) EventSubCommand(ctx context.Context, data wshrpc.SubscriptionRequest) error {
	wrpc := wshutil.GetWshRpcFromContext(ctx)
	if wrpc == nil {
		return fmt.Errorf("no wshrpc in context")
	}
	wps.Broker.Subscribe(wrpc, data)
	return nil
}

func (ws *WshServer) EventUnsubCommand(ctx context.Context, data wshrpc.SubscriptionRequest) error {
	wrpc := wshutil.GetWshRpcFromContext(ctx)
	if wrpc == nil {
		return fmt.Errorf("no wshrpc in context")
	}
	wps.Broker.Unsubscribe(wrpc, data)
	return nil
}

func (ws *WshServer) EventUnsubAllCommand(ctx context.Context) error {
	wrpc := wshutil.GetWshRpcFromContext(ctx)
	if wrpc == nil {
		return fmt.Errorf("no wshrpc in context")
	}
	wps.Broker.UnsubscribeAll(wrpc)
	return nil
}