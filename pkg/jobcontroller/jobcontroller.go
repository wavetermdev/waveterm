// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/streamclient"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
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

const (
	JobConnStatus_Disconnected = "disconnected"
	JobConnStatus_Connecting   = "connecting"
	JobConnStatus_Connected    = "connected"
)

const DefaultStreamRwnd = 64 * 1024

var (
	jobConnStates     = make(map[string]string)
	jobConnStatesLock sync.Mutex
)

func InitJobController() {
	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_RouteUp, handleRouteUpEvent)
	rpcClient.EventListener.On(wps.Event_RouteDown, handleRouteDownEvent)
}

func handleRouteUpEvent(event *wps.WaveEvent) {
	handleRouteEvent(event, JobConnStatus_Connected)
}

func handleRouteDownEvent(event *wps.WaveEvent) {
	handleRouteEvent(event, JobConnStatus_Disconnected)
}

func handleRouteEvent(event *wps.WaveEvent, newStatus string) {
	for _, scope := range event.Scopes {
		if strings.HasPrefix(scope, "job:") {
			jobId := strings.TrimPrefix(scope, "job:")
			SetJobConnStatus(jobId, newStatus)
			log.Printf("[job:%s] connection status changed to %s", jobId, newStatus)
		}
	}
}

func GetJobConnStatus(jobId string) string {
	jobConnStatesLock.Lock()
	defer jobConnStatesLock.Unlock()
	status, exists := jobConnStates[jobId]
	if !exists {
		return JobConnStatus_Disconnected
	}
	return status
}

func SetJobConnStatus(jobId string, status string) {
	jobConnStatesLock.Lock()
	defer jobConnStatesLock.Unlock()
	if status == JobConnStatus_Disconnected {
		delete(jobConnStates, jobId)
	} else {
		jobConnStates[jobId] = status
	}
}

func GetConnectedJobIds() []string {
	jobConnStatesLock.Lock()
	defer jobConnStatesLock.Unlock()
	var connectedJobIds []string
	for jobId, status := range jobConnStates {
		if status == JobConnStatus_Connected {
			connectedJobIds = append(connectedJobIds, jobId)
		}
	}
	return connectedJobIds
}

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

	isConnected, err := conncontroller.IsConnected(params.ConnName)
	if err != nil {
		return "", fmt.Errorf("error checking connection status: %w", err)
	}
	if !isConnected {
		return "", fmt.Errorf("connection %q is not connected", params.ConnName)
	}

	jobId := uuid.New().String()
	jobAuthToken, err := utilfn.RandomHexString(32)
	if err != nil {
		return "", fmt.Errorf("failed to generate job auth token: %w", err)
	}

	jobAccessClaims := &wavejwt.WaveJwtClaims{
		MainServer: true,
		JobId:      jobId,
	}
	jobAccessToken, err := wavejwt.Sign(jobAccessClaims)
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

	bareRpc := wshclient.GetBareRpcClient()
	broker := bareRpc.StreamBroker
	readerRouteId := wshclient.GetBareRpcClientRouteId()
	writerRouteId := wshutil.MakeJobRouteId(jobId)
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

	publicKey := wavejwt.GetPublicKey()
	publicKeyBase64 := base64.StdEncoding.EncodeToString(publicKey)

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
		PublicKeyBase64:    publicKeyBase64,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(params.ConnName),
		Timeout: 30000,
	}

	log.Printf("[job:%s] sending RemoteStartJobCommand to connection %s", jobId, params.ConnName)
	rtnData, err := wshclient.RemoteStartJobCommand(bareRpc, startJobData, rpcOpts)
	if err != nil {
		log.Printf("[job:%s] RemoteStartJobCommand failed: %v", jobId, err)
		errMsg := fmt.Sprintf("failed to start job: %v", err)
		wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.Status = JobStatus_Error
			job.StartupError = errMsg
		})
		return "", fmt.Errorf("failed to start remote job: %w", err)
	}

	log.Printf("[job:%s] RemoteStartJobCommand succeeded, cmdpgid=%d jobmanagerpid=%d jobmanagerstartts=%d", jobId, rtnData.CmdPgid, rtnData.JobManagerPid, rtnData.JobManagerStartTs)
	err = wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.CmdPgid = rtnData.CmdPgid
		job.JobManagerPid = rtnData.JobManagerPid
		job.JobManagerStartTs = rtnData.JobManagerStartTs
		job.Status = JobStatus_Running
		job.JobManagerRunning = true
	})
	if err != nil {
		log.Printf("[job:%s] warning: failed to update job status to running: %v", jobId, err)
	} else {
		log.Printf("[job:%s] job status updated to running", jobId)
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

	log.Printf("[job:%s] output loop started", jobId)
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			log.Printf("[job:%s] received %d bytes of data", jobId, n)
			appendErr := filestore.WFS.AppendData(ctx, jobId, "term", buf[:n])
			if appendErr != nil {
				log.Printf("[job:%s] error appending data to WaveFS: %v", jobId, appendErr)
			} else {
				log.Printf("[job:%s] successfully appended %d bytes to WaveFS", jobId, n)
			}
		}

		if err == io.EOF {
			log.Printf("[job:%s] stream ended (EOF)", jobId)
			updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
				job.StreamDone = true
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job stream status: %v", jobId, updateErr)
			}
			tryExitJobManager(ctx, jobId)
			break
		}

		if err != nil {
			log.Printf("[job:%s] stream error: %v", jobId, err)
			streamErr := err.Error()
			updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
				job.StreamDone = true
				job.StreamError = streamErr
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job stream error: %v", jobId, updateErr)
			}
			tryExitJobManager(ctx, jobId)
			break
		}
	}
}

func HandleJobExited(ctx context.Context, jobId string, data wshrpc.CommandJobExitedData) error {
	var finalStatus string
	err := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		if data.ExitErr != "" {
			job.Status = JobStatus_Error
			job.ExitError = data.ExitErr
		} else {
			job.Status = JobStatus_Done
		}
		job.ExitCode = data.ExitCode
		job.ExitSignal = data.ExitSignal
		job.ExitTs = data.ExitTs
		finalStatus = job.Status
	})
	if err != nil {
		return fmt.Errorf("failed to update job exit status: %w", err)
	}

	log.Printf("[job:%s] exited with code:%d signal:%q status:%s", jobId, data.ExitCode, data.ExitSignal, finalStatus)
	tryExitJobManager(ctx, jobId)
	return nil
}

func tryExitJobManager(ctx context.Context, jobId string) {
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

	log.Printf("[job:%s] both job exited and stream finished, exiting job manager", jobId)

	err = ExitJobManager(ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] error exiting job manager: %v", jobId, err)
	}
}

func TerminateJob(ctx context.Context, jobId string) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	isConnected, err := conncontroller.IsConnected(job.Connection)
	if err != nil {
		return fmt.Errorf("error checking connection status: %w", err)
	}
	if !isConnected {
		return fmt.Errorf("connection %q is not connected", job.Connection)
	}

	return remoteTerminateJobManager(ctx, job)
}

func ExitJobManager(ctx context.Context, jobId string) error {
	_, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	jobConnStatus := GetJobConnStatus(jobId)
	if jobConnStatus != JobConnStatus_Connected {
		return fmt.Errorf("job connection is not connected (status: %s)", jobConnStatus)
	}

	bareRpc := wshclient.GetBareRpcClient()
	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeJobRouteId(jobId),
		Timeout: 5000,
	}

	err = wshclient.JobManagerExitCommand(bareRpc, rpcOpts)
	if err != nil {
		return fmt.Errorf("failed to send exit command: %w", err)
	}

	updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.JobManagerRunning = false
	})
	if updateErr != nil {
		log.Printf("[job:%s] error updating job manager running status: %v", jobId, updateErr)
	}

	log.Printf("[job:%s] job manager exit command sent successfully", jobId)
	return nil
}

func DisconnectJob(ctx context.Context, jobId string) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	bareRpc := wshclient.GetBareRpcClient()
	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(job.Connection),
		Timeout: 5000,
	}

	disconnectData := wshrpc.CommandRemoteDisconnectFromJobManagerData{
		JobId: jobId,
	}

	err = wshclient.RemoteDisconnectFromJobManagerCommand(bareRpc, disconnectData, rpcOpts)
	if err != nil {
		return fmt.Errorf("failed to send disconnect command: %w", err)
	}

	log.Printf("[job:%s] job disconnect command sent successfully", jobId)
	return nil
}

func remoteTerminateJobManager(ctx context.Context, job *waveobj.Job) error {
	log.Printf("[job:%s] terminating job manager", job.OID)

	bareRpc := wshclient.GetBareRpcClient()
	terminateData := wshrpc.CommandRemoteTerminateJobManagerData{
		JobId:             job.OID,
		JobManagerPid:     job.JobManagerPid,
		JobManagerStartTs: job.JobManagerStartTs,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(job.Connection),
		Timeout: 5000,
	}

	err := wshclient.RemoteTerminateJobManagerCommand(bareRpc, terminateData, rpcOpts)
	if err != nil {
		log.Printf("[job:%s] error terminating job manager: %v", job.OID, err)
		return fmt.Errorf("failed to terminate job manager: %w", err)
	}

	updateErr := wstore.DBUpdateFn(ctx, job.OID, func(job *waveobj.Job) {
		job.JobManagerRunning = false
		job.TerminateOnReconnect = false
	})
	if updateErr != nil {
		log.Printf("[job:%s] error updating job manager running status: %v", job.OID, updateErr)
	}

	log.Printf("[job:%s] job manager terminated successfully", job.OID)
	return nil
}

func ReconnectJob(ctx context.Context, jobId string) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	if job.Connection == "" {
		return fmt.Errorf("job has no connection")
	}

	isConnected, err := conncontroller.IsConnected(job.Connection)
	if err != nil {
		return fmt.Errorf("error checking connection status: %w", err)
	}
	if !isConnected {
		return fmt.Errorf("connection %q is not connected", job.Connection)
	}

	if job.TerminateOnReconnect {
		return remoteTerminateJobManager(ctx, job)
	}

	bareRpc := wshclient.GetBareRpcClient()

	jobAccessClaims := &wavejwt.WaveJwtClaims{
		MainServer: true,
		JobId:      jobId,
	}
	jobAccessToken, err := wavejwt.Sign(jobAccessClaims)
	if err != nil {
		return fmt.Errorf("failed to generate job access token: %w", err)
	}

	reconnectData := wshrpc.CommandRemoteReconnectToJobManagerData{
		JobId:              jobId,
		JobAuthToken:       job.JobAuthToken,
		MainServerJwtToken: jobAccessToken,
		JobManagerPid:      job.JobManagerPid,
		JobManagerStartTs:  job.JobManagerStartTs,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(job.Connection),
		Timeout: 5000,
	}

	log.Printf("[job:%s] sending RemoteReconnectToJobManagerCommand to connection %s", jobId, job.Connection)
	rtnData, err := wshclient.RemoteReconnectToJobManagerCommand(bareRpc, reconnectData, rpcOpts)
	if err != nil {
		log.Printf("[job:%s] RemoteReconnectToJobManagerCommand failed: %v", jobId, err)
		return fmt.Errorf("failed to reconnect to job manager: %w", err)
	}

	if !rtnData.Success {
		log.Printf("[job:%s] RemoteReconnectToJobManagerCommand returned error: %s", jobId, rtnData.Error)
		if rtnData.JobManagerExited {
			updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
				job.JobManagerRunning = false
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job manager running status: %v", jobId, updateErr)
			}
			return fmt.Errorf("job manager has exited: %s", rtnData.Error)
		}
		return fmt.Errorf("failed to reconnect to job manager: %s", rtnData.Error)
	}

	log.Printf("[job:%s] RemoteReconnectToJobManagerCommand succeeded", jobId)
	return nil
}

func ReconnectJobsForConn(ctx context.Context, connName string) error {
	isConnected, err := conncontroller.IsConnected(connName)
	if err != nil {
		return fmt.Errorf("error checking connection status: %w", err)
	}
	if !isConnected {
		return fmt.Errorf("connection %q is not connected", connName)
	}

	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		return fmt.Errorf("failed to get jobs: %w", err)
	}

	var jobsToReconnect []*waveobj.Job
	for _, job := range allJobs {
		if job.Connection == connName && job.JobManagerRunning {
			jobsToReconnect = append(jobsToReconnect, job)
		}
	}

	log.Printf("[conn:%s] found %d jobs to reconnect", connName, len(jobsToReconnect))

	for _, job := range jobsToReconnect {
		err = ReconnectJob(ctx, job.OID)
		if err != nil {
			log.Printf("[job:%s] error reconnecting: %v", job.OID, err)
		}
	}

	return nil
}

func DeleteJob(ctx context.Context, jobId string) error {
	SetJobConnStatus(jobId, JobConnStatus_Disconnected)
	err := filestore.WFS.DeleteZone(ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] warning: error deleting WaveFS zone: %v", jobId, err)
	}
	return wstore.DBDelete(ctx, waveobj.OType_Job, jobId)
}
