// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/streamclient"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
	"golang.org/x/sync/singleflight"
)

const DefaultTimeout = 2 * time.Second

const (
	JobManagerStatus_Init    = "init"
	JobManagerStatus_Running = "running"
	JobManagerStatus_Done    = "done"
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

type connState struct {
	actual      bool
	processed   bool
	reconciling bool
}

type connStateManager struct {
	sync.Mutex
	m           map[string]*connState
	reconcileCh chan struct{}
}

type jobState struct {
	stateLock       sync.Mutex
	isConnecting    bool
	connectedStatus string
}

var (
	jobConnStates         = make(map[string]string)
	jobControllerLock     sync.Mutex
	blockJobStatusVersion utilds.VersionTs

	connStates = &connStateManager{
		m:           make(map[string]*connState),
		reconcileCh: make(chan struct{}, 1),
	}

	jobStreamIds = ds.MakeSyncMap[string]()

	jobTerminationMessageWritten = ds.MakeSyncMap[bool]()

	reconnectGroup singleflight.Group
)

func isJobManagerRunning(job *waveobj.Job) bool {
	return job.JobManagerStatus == JobManagerStatus_Running
}

func GetJobManagerStatus(ctx context.Context, jobId string) (string, error) {
	job, err := wstore.DBGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return "", fmt.Errorf("failed to get job: %w", err)
	}
	if job == nil {
		return JobManagerStatus_Done, nil
	}
	return job.JobManagerStatus, nil
}

func GetAllJobManagerStatus(ctx context.Context) ([]*wshrpc.JobManagerStatusUpdate, error) {
	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		return nil, fmt.Errorf("failed to get jobs: %w", err)
	}

	var statuses []*wshrpc.JobManagerStatusUpdate
	for _, job := range allJobs {
		statuses = append(statuses, &wshrpc.JobManagerStatusUpdate{
			JobId:            job.OID,
			JobManagerStatus: job.JobManagerStatus,
		})
	}

	return statuses, nil
}

func GetBlockJobStatus(ctx context.Context, blockId string) (*wshrpc.BlockJobStatusData, error) {
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("failed to get block: %w", err)
	}
	if block == nil {
		return nil, fmt.Errorf("block not found: %s", blockId)
	}

	data := &wshrpc.BlockJobStatusData{
		BlockId:   blockId,
		VersionTs: blockJobStatusVersion.GetVersionTs(),
	}

	if block.JobId == "" {
		return data, nil
	}

	job, err := wstore.DBGet[*waveobj.Job](ctx, block.JobId)
	if err != nil {
		return nil, fmt.Errorf("failed to get job: %w", err)
	}
	if job == nil {
		return data, nil
	}

	data.JobId = job.OID
	data.DoneReason = job.JobManagerDoneReason
	data.CmdExitTs = job.CmdExitTs
	data.CmdExitCode = job.CmdExitCode
	data.CmdExitSignal = job.CmdExitSignal

	if job.JobManagerStatus == JobManagerStatus_Init {
		data.Status = "init"
	} else if job.JobManagerStatus == JobManagerStatus_Done {
		data.Status = "done"
	} else if job.JobManagerStatus == JobManagerStatus_Running {
		connStatus := GetJobConnStatus(job.OID)
		if connStatus == JobConnStatus_Connected {
			data.Status = "connected"
		} else {
			data.Status = "disconnected"
		}
	}

	return data, nil
}

func SendBlockJobStatusEvent(ctx context.Context, blockId string) {
	data, err := GetBlockJobStatus(ctx, blockId)
	if err != nil {
		log.Printf("[block:%s] error getting block job status: %v", blockId, err)
		return
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockJobStatus,
		Scopes: []string{fmt.Sprintf("block:%s", blockId)},
		Data:   data,
	})
}

func sendBlockJobStatusEventByJob(ctx context.Context, job *waveobj.Job) {
	if job == nil || job.AttachedBlockId == "" {
		return
	}
	SendBlockJobStatusEvent(ctx, job.AttachedBlockId)
}

func connReconcileWorker() {
	defer func() {
		panichandler.PanicHandler("jobcontroller:connReconcileWorker", recover())
	}()

	for range connStates.reconcileCh {
		reconcileAllConns()
	}
}

func reconcileAllConns() {
	connStates.Lock()
	defer connStates.Unlock()

	for connName, cs := range connStates.m {
		if cs.reconciling || cs.actual == cs.processed {
			continue
		}

		cs.reconciling = true
		actual := cs.actual
		go reconcileConn(connName, actual)
	}
}

func reconcileConn(connName string, targetState bool) {
	defer func() {
		panichandler.PanicHandler("jobcontroller:reconcileConn", recover())
	}()

	if targetState {
		onConnectionUp(connName)
	} else {
		onConnectionDown(connName)
	}

	connStates.Lock()
	defer connStates.Unlock()
	if cs, exists := connStates.m[connName]; exists {
		cs.processed = targetState
		cs.reconciling = false
	}

	select {
	case connStates.reconcileCh <- struct{}{}:
	default:
	}
}

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
	go connReconcileWorker()

	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_RouteUp, handleRouteUpEvent)
	rpcClient.EventListener.On(wps.Event_RouteDown, handleRouteDownEvent)
	rpcClient.EventListener.On(wps.Event_ConnChange, handleConnChangeEvent)
	rpcClient.EventListener.On(wps.Event_BlockClose, handleBlockCloseEvent)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_RouteUp,
		AllScopes: true,
	}, nil)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_RouteDown,
		AllScopes: true,
	}, nil)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_ConnChange,
		AllScopes: true,
	}, nil)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_BlockClose,
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
	ctx := context.Background()
	for _, scope := range event.Scopes {
		if strings.HasPrefix(scope, "job:") {
			jobId := strings.TrimPrefix(scope, "job:")
			SetJobConnStatus(jobId, newStatus)
			log.Printf("[job:%s] connection status changed to %s", jobId, newStatus)

			job, err := wstore.DBGet[*waveobj.Job](ctx, jobId)
			if err != nil {
				log.Printf("[job:%s] error getting job for status event: %v", jobId, err)
				continue
			}
			sendBlockJobStatusEventByJob(ctx, job)
		}
	}
}

func handleConnChangeEvent(event *wps.WaveEvent) {
	var connStatus wshrpc.ConnStatus
	err := utilfn.ReUnmarshal(&connStatus, event.Data)
	if err != nil {
		log.Printf("[connchange] error unmarshaling ConnStatus: %v", err)
		return
	}

	var connName string
	for _, scope := range event.Scopes {
		if strings.HasPrefix(scope, "connection:") {
			connName = strings.TrimPrefix(scope, "connection:")
			break
		}
	}
	if connName == "" {
		return
	}

	connStates.Lock()
	cs, exists := connStates.m[connName]
	if !exists {
		cs = &connState{actual: false, processed: false, reconciling: false}
		connStates.m[connName] = cs
	}
	cs.actual = connStatus.Connected
	connStates.Unlock()

	select {
	case connStates.reconcileCh <- struct{}{}:
	default:
	}
}

func handleBlockCloseEvent(event *wps.WaveEvent) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId, ok := event.Data.(string)
	if !ok {
		log.Printf("[blockclose] invalid event data type")
		return
	}

	jobIds, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) ([]string, error) {
		query := `SELECT oid FROM db_job WHERE json_extract(data, '$.attachedblockid') = ?`
		jobIds := tx.SelectStrings(query, blockId)
		return jobIds, nil
	})
	if err != nil {
		log.Printf("[block:%s] error looking up jobids: %v", blockId, err)
		return
	}
	if len(jobIds) == 0 {
		return
	}

	for _, jobId := range jobIds {
		err := DetachJobFromBlock(ctx, jobId, false)
		if err != nil {
			log.Printf("[job:%s] error detaching from block %s: %v", jobId, blockId, err)
		}
	}
}

func onConnectionUp(connName string) {
	log.Printf("[conn:%s] connection became connected, reconnecting jobs", connName)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		log.Printf("[conn:%s] failed to get jobs for reconnection: %v", connName, err)
		return
	}

	var jobsToReconnect []*waveobj.Job
	for _, job := range allJobs {
		if job.Connection == connName && isJobManagerRunning(job) {
			jobsToReconnect = append(jobsToReconnect, job)
		}
	}

	log.Printf("[conn:%s] found %d jobs to reconnect", connName, len(jobsToReconnect))

	successCount := 0
	for _, job := range jobsToReconnect {
		err = ReconnectJob(ctx, job.OID, nil)
		if err != nil {
			log.Printf("[job:%s] error reconnecting: %v", job.OID, err)
		} else {
			successCount++
		}
	}

	log.Printf("[conn:%s] finished reconnecting jobs: %d/%d successful", connName, successCount, len(jobsToReconnect))
}

func onConnectionDown(connName string) {
	log.Printf("[conn:%s] connection became disconnected", connName)
}

func GetJobConnStatus(jobId string) string {
	jobControllerLock.Lock()
	defer jobControllerLock.Unlock()
	status, exists := jobConnStates[jobId]
	if !exists {
		return JobConnStatus_Disconnected
	}
	return status
}

func SetJobConnStatus(jobId string, status string) {
	jobControllerLock.Lock()
	defer jobControllerLock.Unlock()
	if status == JobConnStatus_Disconnected {
		delete(jobConnStates, jobId)
	} else {
		jobConnStates[jobId] = status
	}
}

func GetConnectedJobIds() []string {
	jobControllerLock.Lock()
	defer jobControllerLock.Unlock()
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
	BlockId  string
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
		JobManagerStatus: JobManagerStatus_Init,
		AttachedBlockId:  params.BlockId,
		Meta:             make(waveobj.MetaMapType),
	}

	err = wstore.DBInsert(ctx, job)
	if err != nil {
		return "", fmt.Errorf("failed to create job in database: %w", err)
	}
	if params.BlockId != "" {
		// AttachJobToBlock will send status
		err = AttachJobToBlock(ctx, jobId, params.BlockId)
		if err != nil {
			return "", fmt.Errorf("failed to attach job to block: %w", err)
		}
	}
	bareRpc := wshclient.GetBareRpcClient()
	broker := bareRpc.StreamBroker
	readerRouteId := wshclient.GetBareRpcClientRouteId()
	writerRouteId := wshutil.MakeJobRouteId(jobId)
	reader, streamMeta := broker.CreateStreamReader(readerRouteId, writerRouteId, DefaultStreamRwnd)
	jobStreamIds.Set(jobId, streamMeta.Id)

	fileOpts := wshrpc.FileOpts{
		MaxSize:  10 * 1024 * 1024,
		Circular: true,
	}
	err = filestore.WFS.MakeFile(ctx, jobId, JobOutputFileName, wshrpc.FileMeta{}, fileOpts)
	if err != nil {
		return "", fmt.Errorf("failed to create WaveFS file: %w", err)
	}

	clientId := wstore.GetClientId()
	publicKey := wavejwt.GetPublicKey()
	publicKeyBase64 := base64.StdEncoding.EncodeToString(publicKey)
	jobEnv := envutil.CopyAndAddToEnvMap(params.Env, "WAVETERM_JOBID", jobId)
	startJobData := wshrpc.CommandRemoteStartJobData{
		Cmd:                params.Cmd,
		Args:               params.Args,
		Env:                jobEnv,
		TermSize:           *params.TermSize,
		StreamMeta:         streamMeta,
		JobAuthToken:       jobAuthToken,
		JobId:              jobId,
		MainServerJwtToken: jobAccessToken,
		ClientId:           clientId,
		PublicKeyBase64:    publicKeyBase64,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(params.ConnName),
		Timeout: 30000,
	}

	writeSessionSeparatorToTerminal(params.BlockId, params.TermSize.Cols)

	log.Printf("[job:%s] sending RemoteStartJobCommand to connection %s, cmd=%q, args=%v", jobId, params.ConnName, params.Cmd, params.Args)
	log.Printf("[job:%s] env=%v", jobId, params.Env)
	rtnData, err := wshclient.RemoteStartJobCommand(bareRpc, startJobData, rpcOpts)
	if err != nil {
		log.Printf("[job:%s] RemoteStartJobCommand failed: %v", jobId, err)
		errMsg := fmt.Sprintf("failed to start job: %v", err)
		var updatedJob *waveobj.Job
		wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.JobManagerStatus = JobManagerStatus_Done
			job.JobManagerDoneReason = JobDoneReason_StartupError
			job.JobManagerStartupError = errMsg
			updatedJob = job
		})
		sendBlockJobStatusEventByJob(ctx, updatedJob)
		return "", fmt.Errorf("failed to start remote job: %w", err)
	}

	log.Printf("[job:%s] RemoteStartJobCommand succeeded, cmdpid=%d cmdstartts=%d jobmanagerpid=%d jobmanagerstartts=%d", jobId, rtnData.CmdPid, rtnData.CmdStartTs, rtnData.JobManagerPid, rtnData.JobManagerStartTs)
	var updatedJob *waveobj.Job
	err = wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.CmdPid = rtnData.CmdPid
		job.CmdStartTs = rtnData.CmdStartTs
		job.JobManagerPid = rtnData.JobManagerPid
		job.JobManagerStartTs = rtnData.JobManagerStartTs
		job.JobManagerStatus = JobManagerStatus_Running
		updatedJob = job
	})
	if err != nil {
		log.Printf("[job:%s] warning: failed to update job status to running: %v", jobId, err)
	} else {
		log.Printf("[job:%s] job status updated to running", jobId)
		sendBlockJobStatusEventByJob(ctx, updatedJob)
	}

	go func() {
		defer func() {
			panichandler.PanicHandler("jobcontroller:runOutputLoop", recover())
		}()
		runOutputLoop(context.Background(), jobId, streamMeta.Id, reader)
	}()

	return jobId, nil
}

func doWFSAppend(ctx context.Context, oref waveobj.ORef, fileName string, data []byte) error {
	err := filestore.WFS.AppendData(ctx, oref.OID, fileName, data)
	if err != nil {
		return err
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_BlockFile,
		Scopes: []string{
			oref.String(),
		},
		Data: &wps.WSFileEventData{
			ZoneId:   oref.OID,
			FileName: fileName,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func handleAppendJobFile(ctx context.Context, jobId string, fileName string, data []byte) error {
	err := doWFSAppend(ctx, waveobj.MakeORef(waveobj.OType_Job, jobId), fileName, data)
	if err != nil {
		return fmt.Errorf("error appending to job file: %w", err)
	}

	job, err := wstore.DBGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("error getting job: %w", err)
	}
	if job != nil && job.AttachedBlockId != "" {
		err = doWFSAppend(ctx, waveobj.MakeORef(waveobj.OType_Block, job.AttachedBlockId), fileName, data)
		if err != nil {
			return fmt.Errorf("error appending to block file: %w", err)
		}
	}

	return nil
}

func runOutputLoop(ctx context.Context, jobId string, streamId string, reader *streamclient.Reader) {
	defer reader.Close()
	defer func() {
		log.Printf("[job:%s] [stream:%s] output loop finished", jobId, streamId)
	}()

	log.Printf("[job:%s] [stream:%s] output loop started", jobId, streamId)
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		currentStreamId, _ := jobStreamIds.GetEx(jobId)
		if currentStreamId != streamId {
			log.Printf("[job:%s] [stream:%s] stream superseded by [stream:%s], exiting output loop", jobId, streamId, currentStreamId)
			break
		}
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
	var updatedJob *waveobj.Job
	err := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.CmdExitError = data.ExitErr
		job.CmdExitCode = data.ExitCode
		job.CmdExitSignal = data.ExitSignal
		job.CmdExitTs = data.ExitTs
		updatedJob = job
	})
	if err != nil {
		return fmt.Errorf("failed to update job exit status: %w", err)
	}
	sendBlockJobStatusEventByJob(ctx, updatedJob)
	tryTerminateJobManager(ctx, jobId)

	shouldWrite := jobTerminationMessageWritten.TestAndSet(jobId, true, func(val bool, exists bool) bool {
		return !exists || !val
	})
	if shouldWrite {
		resetTerminalState(ctx, updatedJob.AttachedBlockId)
		msg := "shell terminated"
		if updatedJob.CmdExitCode != nil && *updatedJob.CmdExitCode != 0 {
			msg = fmt.Sprintf("shell terminated (exit code %d)", *updatedJob.CmdExitCode)
		} else if updatedJob.CmdExitSignal != "" {
			msg = fmt.Sprintf("shell terminated (signal %s)", updatedJob.CmdExitSignal)
		}
		writeMutedMessageToTerminal(updatedJob.AttachedBlockId, "["+msg+"]")
	}
	return nil
}

func tryTerminateJobManager(ctx context.Context, jobId string) {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] error getting job for termination check: %v", jobId, err)
		return
	}

	if job.JobManagerStatus != JobManagerStatus_Running {
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
	err := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
		job.TerminateOnReconnect = true
	})
	if err != nil {
		return fmt.Errorf("failed to set TerminateOnReconnect: %w", err)
	}

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

	shouldWrite := jobTerminationMessageWritten.TestAndSet(job.OID, true, func(val bool, exists bool) bool {
		return !exists || !val
	})
	if shouldWrite {
		resetTerminalState(ctx, job.AttachedBlockId)
		writeMutedMessageToTerminal(job.AttachedBlockId, "[shell terminated]")
	}

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

	var updatedJob *waveobj.Job
	updateErr := wstore.DBUpdateFn(ctx, job.OID, func(job *waveobj.Job) {
		job.JobManagerStatus = JobManagerStatus_Done
		job.JobManagerDoneReason = JobDoneReason_Terminated
		job.TerminateOnReconnect = false
		if !job.StreamDone {
			job.StreamDone = true
			job.StreamError = "job manager terminated"
		}
		updatedJob = job
	})
	if updateErr != nil {
		log.Printf("[job:%s] error updating job status after termination: %v", job.OID, updateErr)
	} else {
		sendBlockJobStatusEventByJob(ctx, updatedJob)
	}

	log.Printf("[job:%s] job manager terminated successfully", job.OID)
	return nil
}

func ReconnectJob(ctx context.Context, jobId string, rtOpts *waveobj.RuntimeOpts) error {
	_, err, _ := reconnectGroup.Do(jobId, func() (any, error) {
		return nil, doReconnectJob(ctx, jobId, rtOpts)
	})
	return err
}

func doReconnectJob(ctx context.Context, jobId string, rtOpts *waveobj.RuntimeOpts) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	_, err = CheckJobConnected(ctx, jobId)
	if err == nil {
		log.Printf("[job:%s] already connected, skipping reconnect", jobId)
		return nil
	}
	log.Printf("[job:%s] not connected, proceeding with reconnect: %v", jobId, err)

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

	if rtOpts == nil {
		rtOpts = &waveobj.RuntimeOpts{
			TermSize: job.CmdTermSize,
		}
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
			var updatedJob *waveobj.Job
			updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
				job.JobManagerStatus = JobManagerStatus_Done
				job.JobManagerDoneReason = JobDoneReason_Gone
				updatedJob = job
			})
			if updateErr != nil {
				log.Printf("[job:%s] error updating job manager running status: %v", jobId, updateErr)
			} else {
				sendBlockJobStatusEventByJob(ctx, updatedJob)
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
	SetJobConnStatus(jobId, JobConnStatus_Connected)

	log.Printf("[job:%s] route established, restarting streaming", jobId)
	return restartStreaming(ctx, jobId, true, rtOpts)
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
		err = ReconnectJob(ctx, job.OID, nil)
		if err != nil {
			log.Printf("[job:%s] error reconnecting: %v", job.OID, err)
		}
	}

	return nil
}

func restartStreaming(ctx context.Context, jobId string, knownConnected bool, rtOpts *waveobj.RuntimeOpts) error {
	job, err := wstore.DBMustGet[*waveobj.Job](ctx, jobId)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	termSize := job.CmdTermSize
	if rtOpts != nil && rtOpts.TermSize.Rows > 0 && rtOpts.TermSize.Cols > 0 {
		termSize = rtOpts.TermSize
		err = wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.CmdTermSize = termSize
		})
		if err != nil {
			log.Printf("[job:%s] warning: failed to update termsize in DB: %v", jobId, err)
		}
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
	jobStreamIds.Set(jobId, streamMeta.Id)

	prepareData := wshrpc.CommandJobPrepareConnectData{
		StreamMeta: *streamMeta,
		Seq:        currentSeq,
		TermSize:   termSize,
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
		var updatedJob *waveobj.Job
		updateErr := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.JobManagerStatus = JobManagerStatus_Done
			job.CmdExitCode = rtnData.ExitCode
			job.CmdExitSignal = rtnData.ExitSignal
			job.CmdExitError = rtnData.ExitErr
			updatedJob = job
		})
		if updateErr != nil {
			log.Printf("[job:%s] error updating job exit status: %v", jobId, updateErr)
		} else {
			sendBlockJobStatusEventByJob(ctx, updatedJob)
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
		runOutputLoop(context.Background(), jobId, streamMeta.Id, reader)
	}()

	log.Printf("[job:%s] streaming restarted successfully", jobId)
	return nil
}

// this function must be kept up to date with getBlockTermDurableAtom in frontend/app/store/global.ts
func IsBlockTermDurable(block *waveobj.Block) bool {
	if block == nil {
		return false
	}

	// Check if view is "term", and controller is "shell"
	if block.Meta.GetString(waveobj.MetaKey_View, "") != "term" || block.Meta.GetString(waveobj.MetaKey_Controller, "") != "shell" {
		return false
	}

	// 1. Check if block has a JobId
	if block.JobId != "" {
		return true
	}

	// 2. Check if connection is local or WSL (not durable)
	connName := block.Meta.GetString(waveobj.MetaKey_Connection, "")
	if conncontroller.IsLocalConnName(connName) || conncontroller.IsWslConnName(connName) {
		return false
	}

	// 3. Check config hierarchy: blockmeta → connection → global (default true)
	// Check block meta first
	if val, exists := block.Meta[waveobj.MetaKey_TermDurable]; exists {
		if boolVal, ok := val.(bool); ok {
			return boolVal
		}
	}
	// Check connection config
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	if connName != "" {
		if connConfig, exists := fullConfig.Connections[connName]; exists {
			if connConfig.TermDurable != nil {
				return *connConfig.TermDurable
			}
		}
	}
	// Check global settings
	if fullConfig.Settings.TermDurable != nil {
		return *fullConfig.Settings.TermDurable
	}
	// Default to true for non-local connections
	return true
}

func IsBlockIdTermDurable(blockId string) bool {
	block, err := wstore.DBGet[*waveobj.Block](context.Background(), blockId)
	if err != nil || block == nil {
		return false
	}
	return IsBlockTermDurable(block)
}

func DeleteJob(ctx context.Context, jobId string) error {
	SetJobConnStatus(jobId, JobConnStatus_Disconnected)
	jobTerminationMessageWritten.Delete(jobId)
	err := filestore.WFS.DeleteZone(ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] warning: error deleting WaveFS zone: %v", jobId, err)
	}
	return wstore.DBDelete(ctx, waveobj.OType_Job, jobId)
}

func AttachJobToBlock(ctx context.Context, jobId string, blockId string) error {
	err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		var oldJobId string

		err := wstore.DBUpdateFn(tx.Context(), blockId, func(block *waveobj.Block) {
			oldJobId = block.JobId
			block.JobId = jobId
		})
		if err != nil {
			return fmt.Errorf("failed to update block: %w", err)
		}

		if oldJobId != "" && oldJobId != jobId {
			err = wstore.DBUpdateFn(tx.Context(), oldJobId, func(oldJob *waveobj.Job) {
				if oldJob.AttachedBlockId == blockId {
					oldJob.AttachedBlockId = ""
				}
			})
			if err != nil {
				log.Printf("[job:%s] warning: could not detach old job: %v", oldJobId, err)
			}
		}

		err = wstore.DBUpdateFnErr(tx.Context(), jobId, func(job *waveobj.Job) error {
			if job.AttachedBlockId != "" && job.AttachedBlockId != blockId {
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

	SendBlockJobStatusEvent(ctx, blockId)
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Block, blockId))
	return nil
}

func DetachJobFromBlock(ctx context.Context, jobId string, updateBlock bool) error {
	var blockId string
	var blockUpdated bool
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
				} else {
					blockUpdated = true
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
		SendBlockJobStatusEvent(ctx, blockId)
		if blockUpdated {
			wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Block, blockId))
		}
	}

	return nil
}

func SendInput(ctx context.Context, data wshrpc.CommandJobInputData) error {
	jobId := data.JobId

	if data.TermSize != nil {
		err := wstore.DBUpdateFn(ctx, jobId, func(job *waveobj.Job) {
			job.CmdTermSize = *data.TermSize
		})
		if err != nil {
			log.Printf("[job:%s] warning: failed to update termsize in DB: %v", jobId, err)
		}
	}

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

	return nil
}

func resetTerminalState(logCtx context.Context, blockId string) {
	if blockId == "" {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	if isFileEmpty(ctx, blockId) {
		return
	}
	blocklogger.Debugf(logCtx, "[conndebug] resetTerminalState: resetting terminal state for block\n")
	resetSeq := shellutil.GetTerminalResetSeq()
	resetSeq += "\r\n"
	err := doWFSAppend(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), JobOutputFileName, []byte(resetSeq))
	if err != nil {
		log.Printf("error appending terminal reset to block file: %v\n", err)
	}
}

func isFileEmpty(ctx context.Context, blockId string) bool {
	if blockId == "" {
		return true
	}
	file, statErr := filestore.WFS.Stat(ctx, blockId, JobOutputFileName)
	if statErr == fs.ErrNotExist {
		return true
	}
	if statErr != nil {
		log.Printf("error statting block output file: %v\n", statErr)
		return true
	}
	return file.Size == 0
}

func writeSessionSeparatorToTerminal(blockId string, termWidth int) {
	if blockId == "" {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	if isFileEmpty(ctx, blockId) {
		return
	}
	separatorLine := "\r\n"
	err := doWFSAppend(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), JobOutputFileName, []byte(separatorLine))
	if err != nil {
		log.Printf("error writing session separator to terminal (blockid=%s): %v", blockId, err)
	}
}

// msg should not have a terminating newline
func writeMutedMessageToTerminal(blockId string, msg string) {
	if blockId == "" {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	fullMsg := "\x1b[90m" + msg + "\x1b[0m\r\n"
	err := doWFSAppend(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), JobOutputFileName, []byte(fullMsg))
	if err != nil {
		log.Printf("error writing muted message to terminal (blockid=%s): %v", blockId, err)
	}
}
