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
)

const (
	JobDoneReason_StartupError = "startuperror"
	JobDoneReason_Gone         = "gone"
	JobDoneReason_Terminated   = "terminated"
)

const (
	JobConnStatus_Disconnected = "disconnected"
	JobConnStatus_Connecting   = "connecting"
	JobConnStatus_Connected    = "connected"
)

const DefaultStreamRwnd = 64 * 1024
const MetaKey_TotalGap = "totalgap"
const JobOutputFileName = "term"

func isJobManagerRunning(job *waveobj.Job) bool {
	return job.JobManagerStatus == JobStatus_Running
}

func GetJobManagerStatus(ctx context.Context, jobId string) (string, error) {
	job, err := wstore.DBGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return "", fmt.Errorf("failed to get job: %w", err)
	}
	if job == nil {
		return JobStatus_Done, nil
	}
	return job.JobManagerStatus, nil
}

var (
	jobConnStates     = make(map[string]string)
	jobConnStatesLock sync.Mutex
)

func getMetaInt64(meta wshrpc.FileMeta, key string) int64 {
	val, ok := meta[key]
	if !ok {
		return 0
	}
	if intVal, ok := val.(int64); ok {
		return intVal
	}
	if floatVal, ok := val.(float64); ok {
		return int64(floatVal)
	}
	return 0
}

func InitJobController() {
	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_RouteUp, handleRouteUpEvent)
	rpcClient.EventListener.On(wps.Event_RouteDown, handleRouteDownEvent)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_RouteUp,
		AllScopes: true,
	}, nil)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_RouteDown,
		AllScopes: true,
	}, nil)
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

func CheckJobConnected(ctx context.Context, jobId string) (*waveobj.Job, error) {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return nil, fmt.Errorf("failed to get job: %w", err)
	}

	isConnected, err := conncontroller.IsConnected(job.Connection)
	if err != nil {
		return nil, fmt.Errorf("error checking connection status: %w", err)
	}
	if !isConnected {
		return nil, fmt.Errorf("connection %q is not connected", job.Connection)
	}

	jobConnStatus := GetJobConnStatus(jobId)
	if jobConnStatus != JobConnStatus_Connected {
		return nil, fmt.Errorf("job is not connected (status: %s)", jobConnStatus)
	}

	return job, nil
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
		OID:              jobId,
		Connection:       params.ConnName,
		Cmd:              params.Cmd,
		CmdArgs:          params.Args,
		CmdEnv:           params.Env,
		CmdTermSize:      *params.TermSize,
		JobAuthToken:     jobAuthToken,
		JobManagerStatus: JobStatus_Init,
		Meta:             make(waveobj.MetaMapType),
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
	err = filestore.WFS.MakeFile(ctx, jobId, JobOutputFileName, wshrpc.FileMeta{}, fileOpts)
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
			job.JobManagerStatus = JobStatus_Done
			job.JobManagerDoneReason = JobDoneReason_StartupError
			job.JobManagerStartupError = errMsg
		})
		return "", fmt.Errorf("failed to start remote job: %w", err)
	}

	log.Printf("[job:%s] RemoteStartJobCommand succeeded, cmdpid=%d cmdstartts=%d jobmanagerpid=%d jobmanagerstartts=%d", jobId, rtnData.CmdPid, rtnData.CmdStartTs, rtnData.JobManagerPid, rtnData.JobManagerStartTs)
	err = wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.CmdPid = rtnData.CmdPid
		job.CmdStartTs = rtnData.CmdStartTs
		job.JobManagerPid = rtnData.JobManagerPid
		job.JobManagerStartTs = rtnData.JobManagerStartTs
		job.JobManagerStatus = JobStatus_Running
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

func handleAppendJobFile(ctx context.Context, jobId string, fileName string, data []byte) error {
	err := filestore.WFS.AppendData(ctx, jobId, fileName, data)
	if err != nil {
		return fmt.Errorf("error appending to job file: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_BlockFile,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Job, jobId).String(),
		},
		Data: &wps.WSFileEventData{
			ZoneId:   jobId,
			FileName: fileName,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
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
			appendErr := handleAppendJobFile(ctx, jobId, JobOutputFileName, buf[:n])
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
			tryTerminateJobManager(ctx, jobId)
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
			tryTerminateJobManager(ctx, jobId)
			break
		}
	}
}

func HandleCmdJobExited(ctx context.Context, jobId string, data wshrpc.CommandJobCmdExitedData) error {
	err := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.CmdExitError = data.ExitErr
		job.CmdExitCode = data.ExitCode
		job.CmdExitSignal = data.ExitSignal
		job.CmdExitTs = data.ExitTs
	})
	if err != nil {
		return fmt.Errorf("failed to update job exit status: %w", err)
	}
	tryTerminateJobManager(ctx, jobId)
	return nil
}

func tryTerminateJobManager(ctx context.Context, jobId string) {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] error getting job for termination check: %v", jobId, err)
		return
	}

	if job.JobManagerStatus != JobStatus_Running {
		return
	}

	cmdExited := job.CmdExitTs != 0

	if !cmdExited || !job.StreamDone {
		log.Printf("[job:%s] not ready for termination: exited=%v streamDone=%v", jobId, cmdExited, job.StreamDone)
		return
	}

	log.Printf("[job:%s] both job cmd exited and stream finished, terminating job manager", jobId)

	err = TerminateJobManager(ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] error terminating job manager: %v", jobId, err)
	}
}

func TerminateJobManager(ctx context.Context, jobId string) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	return remoteTerminateJobManager(ctx, job)
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
		job.JobManagerStatus = JobStatus_Done
		job.JobManagerDoneReason = JobDoneReason_Terminated
		job.TerminateOnReconnect = false
		if !job.StreamDone {
			job.StreamDone = true
			job.StreamError = "job manager terminated"
		}
	})
	if updateErr != nil {
		log.Printf("[job:%s] error updating job status after termination: %v", job.OID, updateErr)
	}

	log.Printf("[job:%s] job manager terminated successfully", job.OID)
	return nil
}

func ReconnectJob(ctx context.Context, jobId string) error {
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
		if rtnData.JobManagerGone {
			updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
				job.JobManagerStatus = JobStatus_Done
				job.JobManagerDoneReason = JobDoneReason_Gone
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job manager running status: %v", jobId, updateErr)
			}
			return fmt.Errorf("job manager has exited: %s", rtnData.Error)
		}
		return fmt.Errorf("failed to reconnect to job manager: %s", rtnData.Error)
	}

	log.Printf("[job:%s] RemoteReconnectToJobManagerCommand succeeded, waiting for route", jobId)

	routeId := wshutil.MakeJobRouteId(jobId)
	waitCtx, cancelFn := context.WithTimeout(ctx, 2*time.Second)
	defer cancelFn()
	err = wshutil.DefaultRouter.WaitForRegister(waitCtx, routeId)
	if err != nil {
		return fmt.Errorf("route did not establish after successful reconnection: %w", err)
	}

	log.Printf("[job:%s] route established, restarting streaming", jobId)
	return RestartStreaming(ctx, jobId, true)
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
		if job.Connection == connName && isJobManagerRunning(job) {
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

func RestartStreaming(ctx context.Context, jobId string, knownConnected bool) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	if !knownConnected {
		isConnected, err := conncontroller.IsConnected(job.Connection)
		if err != nil {
			return fmt.Errorf("error checking connection status: %w", err)
		}
		if !isConnected {
			return fmt.Errorf("connection %q is not connected", job.Connection)
		}

		jobConnStatus := GetJobConnStatus(jobId)
		if jobConnStatus != JobConnStatus_Connected {
			return fmt.Errorf("job manager is not connected (status: %s)", jobConnStatus)
		}
	}

	var currentSeq int64 = 0
	var totalGap int64 = 0
	waveFile, err := filestore.WFS.Stat(ctx, jobId, JobOutputFileName)
	if err == nil {
		currentSeq = waveFile.Size
		totalGap = getMetaInt64(waveFile.Meta, MetaKey_TotalGap)
		currentSeq += totalGap
	}

	bareRpc := wshclient.GetBareRpcClient()
	broker := bareRpc.StreamBroker
	readerRouteId := wshclient.GetBareRpcClientRouteId()
	writerRouteId := wshutil.MakeJobRouteId(jobId)

	reader, streamMeta := broker.CreateStreamReaderWithSeq(readerRouteId, writerRouteId, DefaultStreamRwnd, currentSeq)

	prepareData := wshrpc.CommandJobPrepareConnectData{
		StreamMeta: *streamMeta,
		Seq:        currentSeq,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeJobRouteId(jobId),
		Timeout: 5000,
	}

	log.Printf("[job:%s] sending JobPrepareConnectCommand with seq=%d (fileSize=%d, totalGap=%d)", jobId, currentSeq, waveFile.Size, totalGap)
	rtnData, err := wshclient.JobPrepareConnectCommand(bareRpc, prepareData, rpcOpts)
	if err != nil {
		reader.Close()
		return fmt.Errorf("failed to prepare connect: %w", err)
	}

	if rtnData.HasExited {
		exitCodeStr := "nil"
		if rtnData.ExitCode != nil {
			exitCodeStr = fmt.Sprintf("%d", *rtnData.ExitCode)
		}
		log.Printf("[job:%s] job has already exited: code=%s signal=%q err=%q", jobId, exitCodeStr, rtnData.ExitSignal, rtnData.ExitErr)
		updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.JobManagerStatus = JobStatus_Done
			job.CmdExitCode = rtnData.ExitCode
			job.CmdExitSignal = rtnData.ExitSignal
			job.CmdExitError = rtnData.ExitErr
		})
		if updateErr != nil {
			log.Printf("[job:%s] error updating job exit status: %v", jobId, updateErr)
		}
	}

	if rtnData.StreamDone {
		log.Printf("[job:%s] stream is already done: error=%q", jobId, rtnData.StreamError)
		updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			if !job.StreamDone {
				job.StreamDone = true
				if rtnData.StreamError != "" {
					job.StreamError = rtnData.StreamError
				}
			}
		})
		if updateErr != nil {
			log.Printf("[job:%s] error updating job stream status: %v", jobId, updateErr)
		}
	}

	if rtnData.StreamDone && rtnData.HasExited {
		reader.Close()
		log.Printf("[job:%s] both stream done and job exited, calling tryExitJobManager", jobId)
		tryTerminateJobManager(ctx, jobId)
		return nil
	}

	if rtnData.StreamDone {
		reader.Close()
		log.Printf("[job:%s] stream already done, no need to restart streaming", jobId)
		return nil
	}

	if rtnData.Seq > currentSeq {
		gap := rtnData.Seq - currentSeq
		totalGap += gap
		log.Printf("[job:%s] detected gap: our seq=%d, server seq=%d, gap=%d, new totalGap=%d", jobId, currentSeq, rtnData.Seq, gap, totalGap)

		metaErr := filestore.WFS.WriteMeta(ctx, jobId, JobOutputFileName, wshrpc.FileMeta{
			MetaKey_TotalGap: totalGap,
		}, true)
		if metaErr != nil {
			log.Printf("[job:%s] error updating totalgap metadata: %v", jobId, metaErr)
		}

		reader.UpdateNextSeq(rtnData.Seq)
	}

	log.Printf("[job:%s] sending JobStartStreamCommand", jobId)
	startStreamData := wshrpc.CommandJobStartStreamData{}
	err = wshclient.JobStartStreamCommand(bareRpc, startStreamData, rpcOpts)
	if err != nil {
		reader.Close()
		return fmt.Errorf("failed to start stream: %w", err)
	}

	go func() {
		defer func() {
			panichandler.PanicHandler("jobcontroller:RestartStreaming:runOutputLoop", recover())
		}()
		runOutputLoop(context.Background(), jobId, reader)
	}()

	log.Printf("[job:%s] streaming restarted successfully", jobId)
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

func AttachJobToBlock(ctx context.Context, jobId string, blockId string) error {
	err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		err := wstore.DBUpdateFn(tx.Context(), blockId, func(block *waveobj.Block) {
			block.JobId = jobId
		})
		if err != nil {
			return fmt.Errorf("failed to update block: %w", err)
		}

		err = wstore.DBUpdateFnErr(tx.Context(), jobId, func(job *waveobj.Job) error {
			if job.AttachedBlockId != "" {
				return fmt.Errorf("job %s already attached to block %s", jobId, job.AttachedBlockId)
			}
			job.AttachedBlockId = blockId
			return nil
		})
		if err != nil {
			return fmt.Errorf("failed to update job: %w", err)
		}

		log.Printf("[job:%s] attached to block:%s", jobId, blockId)
		return nil
	})
	if err != nil {
		return err
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:      wshutil.MakeFeBlockRouteId(blockId),
		NoResponse: true,
	}
	bareRpc := wshclient.GetBareRpcClient()
	wshclient.TermUpdateAttachedJobCommand(bareRpc, wshrpc.CommandTermUpdateAttachedJobData{
		BlockId: blockId,
		JobId:   jobId,
	}, rpcOpts)

	return nil
}

func DetachJobFromBlock(ctx context.Context, jobId string, updateBlock bool) error {
	var blockId string
	err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		job, err := wstore.DBMustGet[*waveobj.Job](tx.Context(), jobId)
		if err != nil {
			return fmt.Errorf("failed to get job: %w", err)
		}

		blockId = job.AttachedBlockId
		if blockId == "" {
			return nil
		}

		if updateBlock {
			block, err := wstore.DBGet[*waveobj.Block](tx.Context(), blockId)
			if err == nil && block != nil {
				err = wstore.DBUpdateFn(tx.Context(), blockId, func(block *waveobj.Block) {
					block.JobId = ""
				})
				if err != nil {
					log.Printf("[job:%s] warning: failed to clear JobId from block:%s: %v", jobId, blockId, err)
				}
			}
		}

		err = wstore.DBUpdateFn(tx.Context(), jobId, func(job *waveobj.Job) {
			job.AttachedBlockId = ""
		})
		if err != nil {
			return fmt.Errorf("failed to update job: %w", err)
		}

		log.Printf("[job:%s] detached from block:%s", jobId, blockId)
		return nil
	})
	if err != nil {
		return err
	}

	if blockId != "" {
		rpcOpts := &wshrpc.RpcOpts{
			Route:      wshutil.MakeFeBlockRouteId(blockId),
			NoResponse: true,
		}
		bareRpc := wshclient.GetBareRpcClient()
		wshclient.TermUpdateAttachedJobCommand(bareRpc, wshrpc.CommandTermUpdateAttachedJobData{
			BlockId: blockId,
			JobId:   "",
		}, rpcOpts)
	}

	return nil
}

func SendInput(ctx context.Context, data wshrpc.CommandJobInputData) error {
	jobId := data.JobId
	_, err := CheckJobConnected(ctx, jobId)
	if err != nil {
		return err
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:      wshutil.MakeJobRouteId(jobId),
		Timeout:    5000,
		NoResponse: false,
	}

	bareRpc := wshclient.GetBareRpcClient()
	err = wshclient.JobInputCommand(bareRpc, data, rpcOpts)
	if err != nil {
		return fmt.Errorf("failed to send input to job: %w", err)
	}

	if data.TermSize != nil {
		err = wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.CmdTermSize = *data.TermSize
		})
		if err != nil {
			log.Printf("[job:%s] warning: failed to update termsize in DB: %v", jobId, err)
		}
	}

	return nil
}
