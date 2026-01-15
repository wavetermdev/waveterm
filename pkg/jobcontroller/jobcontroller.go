// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"context"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/streamclient"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	JobStatus_Init    = "init"
	JobStatus_Running = "running"
	JobStatus_Done    = "done"
	JobStatus_Error   = "error"
)

const DefaultStreamRwnd = 64 * 1024

type StartJobParams struct {
	ConnName string
	Cmd      string
	Args     []string
	Env      map[string]string
	TermSize *waveobj.TermSize
}

func StartJob(ctx context.Context, params StartJobParams) (string, error) {
	if params.ConnName == "" {
		return "", fmt.Errorf("connection name is required")
	}
	if params.Cmd == "" {
		return "", fmt.Errorf("command is required")
	}
	if params.TermSize == nil {
		params.TermSize = &waveobj.TermSize{Rows: 24, Cols: 80}
	}

	err := conncontroller.EnsureConnection(ctx, params.ConnName)
	if err != nil {
		return "", fmt.Errorf("failed to ensure connection: %w", err)
	}

	jobId := uuid.New().String()
	jobAuthToken, err := utilfn.RandomHexString(32)
	if err != nil {
		return "", fmt.Errorf("failed to generate job auth token: %w", err)
	}

	rpcCtx := wshrpc.RpcContext{
		RouteId: wshutil.MakeJobRouteId(jobId),
	}
	jobAccessToken, err := wshutil.MakeClientJWTToken(rpcCtx)
	if err != nil {
		return "", fmt.Errorf("failed to generate job access token: %w", err)
	}

	job := &waveobj.Job{
		OID:          jobId,
		Connection:   params.ConnName,
		Cmd:          params.Cmd,
		CmdArgs:      params.Args,
		CmdEnv:       params.Env,
		TermSize:     *params.TermSize,
		JobAuthToken: jobAuthToken,
		Status:       JobStatus_Init,
		StartTs:      time.Now().UnixMilli(),
		Meta:         make(waveobj.MetaMapType),
	}

	err = wstore.DBInsert(ctx, job)
	if err != nil {
		return "", fmt.Errorf("failed to create job in database: %w", err)
	}

	connRpc := wshclient.GetBareRpcClient()
	if connRpc == nil {
		return "", fmt.Errorf("main rpc client not available")
	}

	broker := connRpc.StreamBroker
	if broker == nil {
		return "", fmt.Errorf("stream broker not available")
	}

	readerRouteId := wshutil.MakeJobRouteId(jobId)
	writerRouteId := wshutil.MakeConnectionRouteId(params.ConnName)
	reader, streamMeta := broker.CreateStreamReader(readerRouteId, writerRouteId, DefaultStreamRwnd)

	fileOpts := wshrpc.FileOpts{
		MaxSize:  10 * 1024 * 1024,
		Circular: true,
	}
	err = filestore.WFS.MakeFile(ctx, jobId, "term", wshrpc.FileMeta{}, fileOpts)
	if err != nil {
		return "", fmt.Errorf("failed to create WaveFS file: %w", err)
	}

	clientId, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil || clientId == nil {
		return "", fmt.Errorf("failed to get client: %w", err)
	}

	startJobData := wshrpc.CommandRemoteStartJobData{
		Cmd:                params.Cmd,
		Args:               params.Args,
		Env:                params.Env,
		TermSize:           *params.TermSize,
		StreamMeta:         streamMeta,
		JobAuthToken:       jobAuthToken,
		JobId:              jobId,
		MainServerJwtToken: jobAccessToken,
		ClientId:           clientId.OID,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(params.ConnName),
		Timeout: 30000,
	}

	rtnData, err := wshclient.RemoteStartJobCommand(connRpc, startJobData, rpcOpts)
	if err != nil {
		wstore.DBUpdate(ctx, &waveobj.Job{
			OID:    jobId,
			Status: JobStatus_Error,
			Error:  fmt.Sprintf("failed to start job: %v", err),
		})
		return "", fmt.Errorf("failed to start remote job: %w", err)
	}

	job.Pgid = rtnData.Pgid
	job.Status = JobStatus_Running
	err = wstore.DBUpdate(ctx, job)
	if err != nil {
		log.Printf("warning: failed to update job status to running: %v", err)
	}

	go func() {
		defer func() {
			panichandler.PanicHandler("jobcontroller:runOutputLoop", recover())
		}()
		runOutputLoop(context.Background(), jobId, reader)
	}()

	return jobId, nil
}

func runOutputLoop(ctx context.Context, jobId string, reader *streamclient.Reader) {
	defer func() {
		log.Printf("[job:%s] output loop finished", jobId)
	}()

	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			appendErr := filestore.WFS.AppendData(ctx, jobId, "term", buf[:n])
			if appendErr != nil {
				log.Printf("[job:%s] error appending data to WaveFS: %v", jobId, appendErr)
			}
		}

		if err == io.EOF {
			log.Printf("[job:%s] stream ended (EOF)", jobId)
			updateErr := wstore.DBUpdate(ctx, &waveobj.Job{
				OID:        jobId,
				StreamDone: true,
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job stream status: %v", jobId, updateErr)
			}
			tryTerminateJobManager(ctx, jobId)
			break
		}

		if err != nil {
			log.Printf("[job:%s] stream error: %v", jobId, err)
			updateErr := wstore.DBUpdate(ctx, &waveobj.Job{
				OID:         jobId,
				StreamDone:  true,
				StreamError: err.Error(),
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job stream error: %v", jobId, updateErr)
			}
			tryTerminateJobManager(ctx, jobId)
			break
		}
	}
}

func HandleJobExited(ctx context.Context, jobId string, data wshrpc.CommandJobExitedData) error {
	var status string
	if data.ExitErr != "" {
		status = JobStatus_Error
	} else {
		status = JobStatus_Done
	}

	updateData := &waveobj.Job{
		OID:        jobId,
		Status:     status,
		ExitCode:   data.ExitCode,
		ExitSignal: data.ExitSignal,
		ExitTs:     data.ExitTs,
	}

	if data.ExitErr != "" {
		updateData.Error = data.ExitErr
	}

	err := wstore.DBUpdate(ctx, updateData)
	if err != nil {
		return fmt.Errorf("failed to update job exit status: %w", err)
	}

	log.Printf("[job:%s] exited with code:%d signal:%q status:%s", jobId, data.ExitCode, data.ExitSignal, status)
	tryTerminateJobManager(ctx, jobId)
	return nil
}

func tryTerminateJobManager(ctx context.Context, jobId string) {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] error getting job for termination check: %v", jobId, err)
		return
	}

	jobExited := job.Status == JobStatus_Done || job.Status == JobStatus_Error

	if !jobExited || !job.StreamDone {
		log.Printf("[job:%s] not ready for termination: exited=%v streamDone=%v", jobId, jobExited, job.StreamDone)
		return
	}

	log.Printf("[job:%s] both job exited and stream finished, terminating job manager", jobId)

	connRpc := wshclient.GetBareRpcClient()
	if connRpc == nil {
		log.Printf("[job:%s] error terminating job manager: rpc client not available", jobId)
		return
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:      wshutil.MakeJobRouteId(jobId),
		Timeout:    5000,
		NoResponse: true,
	}

	err = wshclient.JobManagerExitCommand(connRpc, rpcOpts)
	if err != nil {
		log.Printf("[job:%s] error sending job manager exit command: %v", jobId, err)
		return
	}

	log.Printf("[job:%s] job manager exit command sent successfully", jobId)
}
