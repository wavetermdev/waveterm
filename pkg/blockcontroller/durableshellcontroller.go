// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type DurableShellController struct {
	Lock *sync.Mutex

	ControllerType string
	TabId          string
	BlockId        string
	BlockDef       *waveobj.BlockDef
	VersionTs      utilds.VersionTs

	InputSessionId string // random uuid
	inputSeqNum    int    // monotonic sequence number for inputs, starts at 1

	JobId           string
	ConnName        string
	LastKnownStatus string
}

func MakeDurableShellController(tabId string, blockId string, controllerType string) Controller {
	return &DurableShellController{
		Lock:            &sync.Mutex{},
		ControllerType:  controllerType,
		TabId:           tabId,
		BlockId:         blockId,
		LastKnownStatus: Status_Init,
		InputSessionId:  uuid.New().String(),
	}
}

func (dsc *DurableShellController) WithLock(f func()) {
	dsc.Lock.Lock()
	defer dsc.Lock.Unlock()
	f()
}

func (dsc *DurableShellController) getJobId() string {
	dsc.Lock.Lock()
	defer dsc.Lock.Unlock()
	return dsc.JobId
}

func (dsc *DurableShellController) getNextInputSeq() (string, int) {
	dsc.Lock.Lock()
	defer dsc.Lock.Unlock()
	dsc.inputSeqNum++
	return dsc.InputSessionId, dsc.inputSeqNum
}

func (dsc *DurableShellController) getJobStatus_withlock() string {
	if dsc.JobId == "" {
		dsc.LastKnownStatus = Status_Init
		return Status_Init
	}
	status, err := jobcontroller.GetJobManagerStatus(context.Background(), dsc.JobId)
	if err != nil {
		log.Printf("error getting job status for %s: %v, using last known status: %s", dsc.JobId, err, dsc.LastKnownStatus)
		return dsc.LastKnownStatus
	}
	dsc.LastKnownStatus = status
	return status
}

func (dsc *DurableShellController) getRuntimeStatus_withlock() BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	rtn.Version = dsc.VersionTs.GetVersionTs()
	rtn.BlockId = dsc.BlockId
	rtn.ShellProcStatus = dsc.getJobStatus_withlock()
	rtn.ShellProcConnName = dsc.ConnName
	return rtn
}

func (dsc *DurableShellController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	dsc.WithLock(func() {
		rtn = dsc.getRuntimeStatus_withlock()
	})
	return &rtn
}

func (dsc *DurableShellController) sendUpdate_withlock() {
	rtStatus := dsc.getRuntimeStatus_withlock()
	log.Printf("sending blockcontroller update %#v\n", rtStatus)
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_ControllerStatus,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Tab, dsc.TabId).String(),
			waveobj.MakeORef(waveobj.OType_Block, dsc.BlockId).String(),
		},
		Data: rtStatus,
	})
}

// Start initializes or reconnects to a durable shell for the block.
// Logic:
// - If block has no existing jobId: starts a new job and attaches it
// - If block has existing jobId with running job manager: reconnects to existing job
// - If block has existing jobId with non-running job manager:
//   - force=true: detaches old job and starts new one
//   - force=false: returns without starting (leaves block unstarted)
//
// After establishing jobId, ensures job connection is active (reconnects if needed)
func (dsc *DurableShellController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, dsc.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	connName := blockMeta.GetString(waveobj.MetaKey_Connection, "")
	if conncontroller.IsLocalConnName(connName) {
		return fmt.Errorf("durable shell controller requires a remote connection")
	}

	var jobId string
	if blockData.JobId != "" {
		status, err := jobcontroller.GetJobManagerStatus(ctx, blockData.JobId)
		if err != nil {
			return fmt.Errorf("error getting job manager status: %w", err)
		}
		if status == jobcontroller.JobManagerStatus_Running {
			jobId = blockData.JobId
		} else if !force {
			log.Printf("block %q has jobId %s but manager is not running (status: %s), not starting (force=false)\n", dsc.BlockId, blockData.JobId, status)
			return nil
		} else {
			log.Printf("block %q has jobId %s but manager is not running (status: %s), starting new job (force=true)\n", dsc.BlockId, blockData.JobId, status)
			// intentionally leave jobId empty to trigger starting a new job below
		}
	}

	if jobId == "" {
		log.Printf("block %q starting new durable shell\n", dsc.BlockId)
		newJobId, err := dsc.startNewJob(ctx, blockMeta, connName)
		if err != nil {
			return fmt.Errorf("failed to start new job: %w", err)
		}
		jobId = newJobId
	}

	dsc.WithLock(func() {
		dsc.JobId = jobId
		dsc.ConnName = connName
		dsc.sendUpdate_withlock()
	})

	err = jobcontroller.ReconnectJob(ctx, jobId, rtOpts)
	if err != nil {
		return fmt.Errorf("failed to reconnect to job: %w", err)
	}

	return nil
}

func (dsc *DurableShellController) Stop(graceful bool, newStatus string, destroy bool) {
	if !destroy {
		return
	}
	jobId := dsc.getJobId()
	if jobId == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	jobcontroller.TerminateAndDetachJob(ctx, jobId)
}

func (dsc *DurableShellController) SendInput(inputUnion *BlockInputUnion) error {
	if inputUnion == nil {
		return nil
	}
	jobId := dsc.getJobId()
	if jobId == "" {
		return fmt.Errorf("no job attached to controller")
	}
	inputSessionId, seqNum := dsc.getNextInputSeq()
	data := wshrpc.CommandJobInputData{
		JobId:          jobId,
		InputSessionId: inputSessionId,
		SeqNum:         seqNum,
		TermSize:       inputUnion.TermSize,
		SigName:        inputUnion.SigName,
	}
	if len(inputUnion.InputData) > 0 {
		data.InputData64 = base64.StdEncoding.EncodeToString(inputUnion.InputData)
	}
	return jobcontroller.SendInput(context.Background(), data)
}

func (dsc *DurableShellController) startNewJob(ctx context.Context, blockMeta waveobj.MetaMapType, connName string) (string, error) {
	termSize := waveobj.TermSize{
		Rows: shellutil.DefaultTermRows,
		Cols: shellutil.DefaultTermCols,
	}
	cmdStr := blockMeta.GetString(waveobj.MetaKey_Cmd, "")
	cwd := blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", fmt.Errorf("invalid ssh remote name (%s): %w", connName, err)
	}
	conn := conncontroller.GetConn(opts)
	if conn == nil {
		return "", fmt.Errorf("connection %q not found", connName)
	}
	connRoute := wshutil.MakeConnectionRouteId(connName)
	remoteInfo, err := wshclient.RemoteGetInfoCommand(wshclient.GetBareRpcClient(), &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		return "", fmt.Errorf("unable to obtain remote info from connserver: %w", err)
	}
	shellType := shellutil.GetShellTypeFromShellPath(remoteInfo.Shell)
	swapToken := makeSwapToken(ctx, ctx, dsc.BlockId, blockMeta, connName, shellType)
	sockName := wavebase.GetPersistentRemoteSockName(wstore.GetClientId())
	rpcContext := wshrpc.RpcContext{
		ProcRoute: true,
		SockName:  sockName,
		BlockId:   dsc.BlockId,
		Conn:      connName,
	}
	jwtStr, err := wshutil.MakeClientJWTToken(rpcContext)
	if err != nil {
		return "", fmt.Errorf("error making jwt token: %w", err)
	}
	swapToken.RpcContext = &rpcContext
	swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
	cmdOpts := shellexec.CommandOptsType{
		Interactive: true,
		Login:       true,
		Cwd:         cwd,
		SwapToken:   swapToken,
		ForceJwt:    blockMeta.GetBool(waveobj.MetaKey_CmdJwt, false),
	}
	jobId, err := shellexec.StartRemoteShellJob(ctx, ctx, termSize, cmdStr, cmdOpts, conn, dsc.BlockId)
	if err != nil {
		return "", fmt.Errorf("failed to start durable shell: %w", err)
	}
	return jobId, nil
}
