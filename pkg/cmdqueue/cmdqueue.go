// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmdqueue

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"runtime/debug"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second
const CmdQueueSize = 100

func RunCmd(ctx context.Context, cmd wshutil.BlockCommand, cmdCtx wshutil.CmdContextType) (rtnData wshutil.ResponseDataType, rtnErr error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC: %v\n", r)
			debug.PrintStack()
			rtnData = nil
			rtnErr = fmt.Errorf("panic: %v", r)
			return
		}
	}()
	blockId := cmdCtx.BlockId
	bcCmd, ok := cmd.(wshutil.BlockControllerCommand)
	if ok && bcCmd.GetBlockId() != "" {
		blockId = bcCmd.GetBlockId()
	}
	if strings.HasPrefix(cmd.GetCommand(), "controller:") {
		// send to block controller
		bc := blockcontroller.GetBlockController(blockId)
		if bc == nil {
			return nil, fmt.Errorf("block controller not found for block %q", blockId)
		}
		bc.InputCh <- cmd
		return nil, nil
	}
	switch typedCmd := cmd.(type) {
	case *wshutil.BlockGetMetaCommand:
		return handleGetMeta(ctx, typedCmd)
	case *wshutil.ResolveIdsCommand:
		return handleResolveIds(ctx, typedCmd)
	case *wshutil.BlockSetMetaCommand:
		return handleSetMeta(ctx, typedCmd, cmdCtx)
	case *wshutil.BlockSetViewCommand:
		return handleSetView(ctx, typedCmd, cmdCtx)
	case *wshutil.BlockMessageCommand:
		log.Printf("MESSAGE: %s | %q\n", blockId, typedCmd.Message)
		return nil, nil
	case *wshutil.BlockAppendFileCommand:
		log.Printf("APPENDFILE: %s | %q | len:%d\n", blockId, typedCmd.FileName, len(typedCmd.Data))
		err := handleAppendBlockFile(blockId, typedCmd.FileName, typedCmd.Data)
		if err != nil {
			return nil, fmt.Errorf("error appending blockfile: %w", err)
		}
		return nil, nil
	case *wshutil.BlockAppendIJsonCommand:
		log.Printf("APPENDIJSON: %s | %q\n", blockId, typedCmd.FileName)
		err := handleAppendIJsonFile(blockId, typedCmd.FileName, typedCmd.Data, true)
		if err != nil {
			return nil, fmt.Errorf("error appending blockfile(ijson): %w", err)
		}
		return nil, nil
	case *wshutil.CreateBlockCommand:
		return handleCreateBlock(ctx, typedCmd, cmdCtx)
	default:
		return nil, fmt.Errorf("unknown command: %q", cmd.GetCommand())
	}
}

func handleSetView(ctx context.Context, cmd *wshutil.BlockSetViewCommand, cmdCtx wshutil.CmdContextType) (map[string]any, error) {
	log.Printf("SETVIEW: %s | %q\n", cmdCtx.BlockId, cmd.View)
	block, err := wstore.DBGet[*wstore.Block](ctx, cmdCtx.BlockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block: %w", err)
	}
	block.View = cmd.View
	err = wstore.DBUpdate(ctx, block)
	if err != nil {
		return nil, fmt.Errorf("error updating block: %w", err)
	}
	// send a waveobj:update event
	updatedBlock, err := wstore.DBGet[*wstore.Block](ctx, cmdCtx.BlockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "waveobj:update",
		ORef:      waveobj.MakeORef(wstore.OType_Block, cmdCtx.BlockId).String(),
		Data: wstore.WaveObjUpdate{
			UpdateType: wstore.UpdateType_Update,
			OType:      wstore.OType_Block,
			OID:        cmdCtx.BlockId,
			Obj:        updatedBlock,
		},
	})
	return nil, nil
}

func handleGetMeta(ctx context.Context, cmd *wshutil.BlockGetMetaCommand) (map[string]any, error) {
	oref, err := waveobj.ParseORef(cmd.ORef)
	if err != nil {
		return nil, fmt.Errorf("error parsing oref: %w", err)
	}
	obj, err := wstore.DBGetORef(ctx, oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil, fmt.Errorf("object not found: %s", oref)
	}
	return waveobj.GetMeta(obj), nil
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

func handleResolveIds(ctx context.Context, cmd *wshutil.ResolveIdsCommand) (map[string]any, error) {
	rtn := make(map[string]any)
	for _, simpleId := range cmd.Ids {
		oref, err := resolveSimpleId(ctx, simpleId)
		if err != nil || oref == nil {
			continue
		}
		rtn[simpleId] = oref.String()
	}
	return rtn, nil
}

func handleSetMeta(ctx context.Context, cmd *wshutil.BlockSetMetaCommand, cmdCtx wshutil.CmdContextType) (map[string]any, error) {
	var oref *waveobj.ORef
	if cmd.ORef != "" {
		orefVal, err := waveobj.ParseORef(cmd.ORef)
		if err != nil {
			return nil, fmt.Errorf("error parsing oref: %w", err)
		}
		oref = &orefVal
	} else {
		orefVal := waveobj.MakeORef(wstore.OType_Block, cmdCtx.BlockId)
		oref = &orefVal
	}
	log.Printf("SETMETA: %s | %v\n", oref, cmd.Meta)
	obj, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil, nil
	}
	meta := waveobj.GetMeta(obj)
	if meta == nil {
		meta = make(map[string]any)
	}
	for k, v := range cmd.Meta {
		if v == nil {
			delete(meta, k)
			continue
		}
		meta[k] = v
	}
	waveobj.SetMeta(obj, meta)
	err = wstore.DBUpdate(ctx, obj)
	if err != nil {
		return nil, fmt.Errorf("error updating block: %w", err)
	}
	// send a waveobj:update event
	updatedBlock, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object (2): %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "waveobj:update",
		ORef:      oref.String(),
		Data: wstore.WaveObjUpdate{
			UpdateType: wstore.UpdateType_Update,
			OType:      updatedBlock.GetOType(),
			OID:        waveobj.GetOID(updatedBlock),
			Obj:        updatedBlock,
		},
	})
	return nil, nil
}

func handleAppendBlockFile(blockId string, blockFile string, data []byte) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.AppendData(ctx, blockId, blockFile, data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "blockfile",
		ORef:      waveobj.MakeORef(wstore.OType_Block, blockId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func handleAppendIJsonFile(blockId string, blockFile string, cmd map[string]any, tryCreate bool) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	if blockFile == blockcontroller.BlockFile_Html && tryCreate {
		err := filestore.WFS.MakeFile(ctx, blockId, blockFile, nil, filestore.FileOptsType{MaxSize: blockcontroller.DefaultHtmlMaxFileSize, IJson: true})
		if err != nil && err != fs.ErrExist {
			return fmt.Errorf("error creating blockfile[html]: %w", err)
		}
	}
	err := filestore.WFS.AppendIJson(ctx, blockId, blockFile, cmd)
	if err != nil {
		return fmt.Errorf("error appending to blockfile(ijson): %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "blockfile",
		ORef:      waveobj.MakeORef(wstore.OType_Block, blockId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString([]byte("{}")),
		},
	})
	return nil
}

func handleCreateBlock(ctx context.Context, cmd *wshutil.CreateBlockCommand, cmdCtx wshutil.CmdContextType) (map[string]any, error) {
	tabId := cmdCtx.TabId
	if cmd.TabId != "" {
		tabId = cmd.TabId
	}
	log.Printf("handleCreateBlock %s %v\n", tabId, cmd.BlockDef)
	blockData, err := wstore.CreateBlock(ctx, tabId, cmd.BlockDef, cmd.RtOpts)
	log.Printf("blockData: %v err:%v\n", blockData, err)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	if blockData.Controller != "" {
		err = blockcontroller.StartBlockController(ctx, cmd.TabId, blockData.OID, RunCmd)
		if err != nil {
			return nil, fmt.Errorf("error starting block controller: %w", err)
		}
	}
	return map[string]any{"blockId": blockData.OID}, nil
}
