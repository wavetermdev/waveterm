// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type ShellJobController struct {
	Lock *sync.Mutex

	ControllerType string
	TabId          string
	BlockId        string
	BlockDef       *waveobj.BlockDef
	VersionTs      utilds.VersionTs

	JobId           string
	LastKnownStatus string
}

func MakeShellJobController(tabId string, blockId string, controllerType string) Controller {
	return &ShellJobController{
		Lock:            &sync.Mutex{},
		ControllerType:  controllerType,
		TabId:           tabId,
		BlockId:         blockId,
		LastKnownStatus: Status_Init,
	}
}

func (sjc *ShellJobController) WithLock(f func()) {
	sjc.Lock.Lock()
	defer sjc.Lock.Unlock()
	f()
}

func (sjc *ShellJobController) getJobId() string {
	sjc.Lock.Lock()
	defer sjc.Lock.Unlock()
	return sjc.JobId
}

func (sjc *ShellJobController) getJobStatus_withlock() string {
	if sjc.JobId == "" {
		sjc.LastKnownStatus = Status_Init
		return Status_Init
	}
	status, err := jobcontroller.GetJobManagerStatus(context.Background(), sjc.JobId)
	if err != nil {
		log.Printf("error getting job status for %s: %v, using last known status: %s", sjc.JobId, err, sjc.LastKnownStatus)
		return sjc.LastKnownStatus
	}
	sjc.LastKnownStatus = status
	return status
}

func (sjc *ShellJobController) getRuntimeStatus_withlock() BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	rtn.Version = sjc.VersionTs.GetVersionTs()
	rtn.BlockId = sjc.BlockId
	rtn.ShellProcStatus = sjc.getJobStatus_withlock()
	return rtn
}

func (sjc *ShellJobController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	sjc.WithLock(func() {
		rtn = sjc.getRuntimeStatus_withlock()
	})
	return &rtn
}

func (sjc *ShellJobController) sendUpdate_withlock() {
	rtStatus := sjc.getRuntimeStatus_withlock()
	log.Printf("sending blockcontroller update %#v\n", rtStatus)
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_ControllerStatus,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Tab, sjc.TabId).String(),
			waveobj.MakeORef(waveobj.OType_Block, sjc.BlockId).String(),
		},
		Data: rtStatus,
	})
}

// Start initializes or reconnects to a shell job for the block.
// Logic:
// - If block has no existing jobId: starts a new job and attaches it
// - If block has existing jobId with running job manager: reconnects to existing job
// - If block has existing jobId with non-running job manager:
//   - force=true: detaches old job and starts new one
//   - force=false: returns without starting (leaves block unstarted)
// After establishing jobId, ensures job connection is active (reconnects if needed)
func (sjc *ShellJobController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, sjc.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	connName := blockMeta.GetString(waveobj.MetaKey_Connection, "")
	if conncontroller.IsLocalConnName(connName) {
		return fmt.Errorf("shell job controller requires a remote connection")
	}

	var jobId string
	if blockData.JobId != "" {
		status, err := jobcontroller.GetJobManagerStatus(ctx, blockData.JobId)
		if err != nil {
			return fmt.Errorf("error getting job manager status: %w", err)
		}
		if status != jobcontroller.JobStatus_Running {
			if force {
				log.Printf("block %q has jobId %s but manager is not running (status: %s), detaching (force=true)\n", sjc.BlockId, blockData.JobId, status)
				jobcontroller.DetachJobFromBlock(ctx, blockData.JobId, false)
			} else {
				log.Printf("block %q has jobId %s but manager is not running (status: %s), not starting (force=false)\n", sjc.BlockId, blockData.JobId, status)
				return nil
			}
		} else {
			jobId = blockData.JobId
		}
	}

	if jobId == "" {
		log.Printf("block %q starting new shell job\n", sjc.BlockId)
		newJobId, err := sjc.startNewJob(ctx, blockMeta, connName)
		if err != nil {
			return fmt.Errorf("failed to start new job: %w", err)
		}
		jobId = newJobId

		err = jobcontroller.AttachJobToBlock(ctx, jobId, sjc.BlockId)
		if err != nil {
			log.Printf("error attaching job to block: %v\n", err)
		}
	}

	sjc.WithLock(func() {
		sjc.JobId = jobId
		sjc.sendUpdate_withlock()
	})

	_, err = jobcontroller.CheckJobConnected(ctx, jobId)
	if err != nil {
		log.Printf("job %s is not connected, attempting reconnect: %v\n", jobId, err)
		err = jobcontroller.ReconnectJob(ctx, jobId)
		if err != nil {
			return fmt.Errorf("failed to reconnect to job: %w", err)
		}
	}

	return nil
}

func (sjc *ShellJobController) Stop(graceful bool, newStatus string) error {
	// job controller -- nothing to stop, the job persists
	return nil
}

func (sjc *ShellJobController) SendInput(inputUnion *BlockInputUnion) error {
	if inputUnion == nil {
		return nil
	}
	jobId := sjc.getJobId()
	if jobId == "" {
		return fmt.Errorf("no job attached to controller")
	}
	data := wshrpc.CommandJobInputData{
		JobId:    jobId,
		TermSize: inputUnion.TermSize,
		SigName:  inputUnion.SigName,
	}
	if len(inputUnion.InputData) > 0 {
		data.InputData64 = base64.StdEncoding.EncodeToString(inputUnion.InputData)
	}
	return jobcontroller.SendInput(context.Background(), data)
}

func (sjc *ShellJobController) startNewJob(ctx context.Context, blockMeta waveobj.MetaMapType, connName string) (string, error) {

	termSize := waveobj.TermSize{
		Rows: shellutil.DefaultTermRows,
		Cols: shellutil.DefaultTermCols,
	}

	cmdStr := blockMeta.GetString(waveobj.MetaKey_Cmd, "")
	cwd := blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")

	swapToken := &shellutil.TokenSwapEntry{
		Token: uuid.New().String(),
		Env:   make(map[string]string),
		Exp:   time.Now().Add(5 * time.Minute),
	}
	swapToken.Env["TERM_PROGRAM"] = "waveterm"
	swapToken.Env["WAVETERM_BLOCKID"] = sjc.BlockId
	swapToken.Env["WAVETERM"] = "1"
	swapToken.Env["WAVETERM_CONN"] = connName

	cmdOpts := shellexec.CommandOptsType{
		Interactive: true,
		Login:       true,
		Cwd:         cwd,
		SwapToken:   swapToken,
		ForceJwt:    false,
	}

	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", fmt.Errorf("invalid ssh remote name (%s): %w", connName, err)
	}
	conn := conncontroller.GetConn(opts)
	if conn == nil {
		return "", fmt.Errorf("connection %q not found", connName)
	}

	jobId, err := shellexec.StartRemoteShellJob(ctx, ctx, termSize, cmdStr, cmdOpts, conn)
	if err != nil {
		return "", fmt.Errorf("failed to start remote shell job: %w", err)
	}

	return jobId, nil
}

func (sjc *ShellJobController) resetTerminalState(logCtx context.Context) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	jobId := ""
	sjc.WithLock(func() {
		jobId = sjc.JobId
	})
	if jobId == "" {
		return
	}

	wfile, statErr := filestore.WFS.Stat(ctx, jobId, jobcontroller.JobOutputFileName)
	if statErr == fs.ErrNotExist || wfile.Size == 0 {
		return
	}

	blocklogger.Debugf(logCtx, "[conndebug] resetTerminalState: resetting terminal state for job\n")

	resetSeq := "\x1b[0m"                       // reset attributes
	resetSeq += "\x1b[?25h"                     // show cursor
	resetSeq += "\x1b[?1000l"                   // disable mouse tracking
	resetSeq += "\x1b[?1007l"                   // disable alternate scroll mode
	resetSeq += "\x1b[?2004l"                   // disable bracketed paste mode
	resetSeq += shellutil.FormatOSC(16162, "R") // disable alternate screen mode
	resetSeq += "\r\n\r\n"

	err := filestore.WFS.AppendData(ctx, jobId, jobcontroller.JobOutputFileName, []byte(resetSeq))
	if err != nil {
		log.Printf("error appending terminal reset to job file: %v\n", err)
	}
}
