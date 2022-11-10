package comp

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/utilfn"
)

var globalLock = &sync.Mutex{}
var simpleCompMap = map[string]SimpleCompGenFnType{
	"file":      simpleCompFile,
	"directory": simpleCompDir,
	"variable":  simpleCompVar,
	"command":   simpleCompCommand,
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
	return compFn(ctx, prefix, compCtx, args)
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
		return nil, fmt.Errorf("/compgen invalid type '%s'", compType)
	}
	msh := remote.GetRemoteById(compCtx.RemotePtr.RemoteId)
	if msh == nil {
		return nil, fmt.Errorf("invalid remote '%s', not found", compCtx.RemotePtr)
	}
	cgPacket := packet.MakeCompGenPacket()
	cgPacket.ReqId = uuid.New().String()
	cgPacket.CompType = compType
	cgPacket.Prefix = prefix
	cgPacket.Cwd = compCtx.State.Cwd
	resp, err := msh.PacketRpc(ctx, cgPacket)
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
	return doCompGen(ctx, prefix, "file", compCtx)
}

func simpleCompDir(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, "directory", compCtx)
}

func simpleCompVar(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, "variable", compCtx)
}

func simpleCompCommand(ctx context.Context, prefix string, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	return doCompGen(ctx, prefix, "command", compCtx)
}
