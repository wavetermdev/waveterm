// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package comp

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote"
)

var globalLock = &sync.Mutex{}
var simpleCompMap = map[string]SimpleCompGenFnType{
	CGTypeCommand:  simpleCompCommand,
	CGTypeFile:     simpleCompFile,
	CGTypeDir:      simpleCompDir,
	CGTypeVariable: simpleCompVar,
}

type SimpleCompGenFnType = func(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error)

func RegisterSimpleCompFn(compType string, fn SimpleCompGenFnType) {
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, ok := simpleCompMap[compType]; ok {
		panic(fmt.Sprintf("simpleCompFn %q already registered", compType))
	}
	simpleCompMap[compType] = fn
}

func getSimpleCompFn(compType string) SimpleCompGenFnType {
	globalLock.Lock()
	defer globalLock.Unlock()
	return simpleCompMap[compType]
}

func DoSimpleComp(ctx context.Context, compType string, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	compFn := getSimpleCompFn(compType)
	if compFn == nil {
		return nil, fmt.Errorf("no simple comp fn for %q", compType)
	}
	crtn, err := compFn(ctx, prefix, compCtx, args)
	if err != nil {
		return nil, err
	}
	crtn.CompType = compType
	return crtn, nil
}

func compsToCompReturn(comps []string, hasMore bool) *CompReturn {
	var rtn CompReturn
	rtn.HasMore = hasMore
	for _, comp := range comps {
		rtn.Entries = append(rtn.Entries, CompEntry{Word: comp})
	}
	return &rtn
}

func doCompGen(ctx context.Context, prefix string, compType string, compCtx CompContext) (*CompReturn, error) {
	if !packet.IsValidCompGenType(compType) {
		return nil, fmt.Errorf("/_compgen invalid type '%s'", compType)
	}
	wsh := remote.GetRemoteById(compCtx.RemotePtr.RemoteId)
	if wsh == nil {
		return nil, fmt.Errorf("invalid remote '%s', not found", compCtx.RemotePtr)
	}
	cgPacket := packet.MakeCompGenPacket()
	cgPacket.ReqId = uuid.New().String()
	cgPacket.CompType = compType
	cgPacket.Prefix = prefix
	cgPacket.Cwd = compCtx.Cwd
	resp, err := wsh.PacketRpc(ctx, cgPacket)
	if err != nil {
		return nil, err
	}
	if err = resp.Err(); err != nil {
		return nil, err
	}
	comps := utilfn.GetStrArr(resp.Data, "comps")
	hasMore := utilfn.GetBool(resp.Data, "hasmore")
	return compsToCompReturn(comps, hasMore), nil
}

func simpleCompFile(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, CGTypeFile, compCtx)
}

func simpleCompDir(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, CGTypeDir, compCtx)
}

func simpleCompVar(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, CGTypeVariable, compCtx)
}

func simpleCompCommand(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, CGTypeCommand, compCtx)
}
