package comp

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
)

func compsToCompReturn(comps []string, hasMore bool) *CompReturn {
	var rtn CompReturn
	rtn.HasMore = hasMore
	for _, comp := range comps {
		rtn.Entries = append(rtn.Entries, CompEntry{Word: comp})
	}
	return &rtn
}

func doCompGen(ctx context.Context, compCtx CompContext, prefix string, compType string, forDisplay bool) (*CompReturn, error) {
	if !packet.IsValidCompGenType(compType) {
		return nil, false, fmt.Errorf("/compgen invalid type '%s'", compType)
	}
	msh := remote.GetRemoteById(compCtx.RemotePtr.RemoteId)
	if msh == nil {
		return nil, false, fmt.Errorf("invalid remote '%s', not found", compCtx.RemotePtr)
	}
	cgPacket := packet.MakeCompGenPacket()
	cgPacket.ReqId = uuid.New().String()
	cgPacket.CompType = compType
	cgPacket.Prefix = prefix
	cgPacket.Cwd = compCtx.State.Cwd
	resp, err := msh.PacketRpc(ctx, cgPacket)
	if err != nil {
		return nil, false, err
	}
	if err = resp.Err(); err != nil {
		return nil, false, err
	}
	comps := getStrArr(resp.Data, "comps")
	hasMore := getBool(resp.Data, "hasmore")
	return compsToCompReturn(conmps, hasMore), nil
}

func SimpleCompFile(ctx context.Context, point SimpleCompPoint, compCtx CompContext, args []interface{}) (*CompReturn, error) {
	pword := point.Words[p.CompWord]
	prefix := ""
	crtn, err := doCompGen(ctx, prefix, "file")
	if err != nil {
		return nil, err
	}
	return crtn, nil
}
