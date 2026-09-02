// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/streamclient"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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

const (
	JobKind_Shell = "shell"
	JobKind_Task  = "task"
)

const DefaultStreamRwnd = 64 * 1024
const MetaKey_TotalGap = "totalgap"
const JobOutputFileName = "term"
const AutoReconnectDelay = 1 * time.Second
const AutoReconnectCooldown = 30 * time.Second

type connState struct {
	actual      bool
	procGen     int
	actualGen   int
	reconciling bool
}

type connStateManager struct {
	sync.Mutex
	m           map[string]*connState
	reconcileCh chan struct{}
}

// streamHealthInfo tracks the health of a job's output stream (runOutputLoop).
// Stored in jobStreamHealth for diagnosing Connected-but-no-stream states
// (failure mode B: job marked Connected but no runOutputLoop pulling data).
type streamHealthInfo struct {
	active     bool
	startedAt  time.Time
	lastReadAt time.Time
	totalBytes int64
	streamId   string
	// remoteState is the last StreamStatusReport state received from the remote
	// jobmanager ("" = no report / old remote). Lets the watchdog distinguish
	// benign idle from remote-side retry/disk-buffer states.
	remoteState   string
	remoteStateAt time.Time
}

// drainProgressInfo tracks UX-1.7 catch-up progress for a job after reconnect.
// Seeded from remote PrepareConnect drain snapshot; decremented as runOutputLoop
// receives bytes. Cleared when remaining hits 0.
type drainProgressInfo struct {
	active         bool
	totalBytes     int64
	remainingBytes int64
	// lastEventAt throttles BlockJobStatus events during large drains
	lastEventAt time.Time
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

	// jobReaders tracks the active *streamclient.Reader for each job's output stream.
	// Used by restartStreaming to close the previous reader so its runOutputLoop exits
	// (the old reader's Read() blocks forever once a new stream starts; without closing it,
	// the goroutine leaks — see Phase 2H in .pi/specs/reconnection.md).
	jobReaders = ds.MakeSyncMap[*streamclient.Reader]()

	// jobStreamHealth tracks the health of each job's output stream (runOutputLoop).
	// Used to diagnose whether a "Connected" job has an active stream pulling data
	// from the remote, or is stuck in a Connected-but-no-stream state (failure mode B).
	jobStreamHealth = ds.MakeSyncMap[streamHealthInfo]()

	// streamStaleLoggedAt tracks when streamHealthWatchdog last logged a stale
	// stream, so idle-but-healthy shells don't get re-logged every tick.
	streamStaleLoggedAt = ds.MakeSyncMap[time.Time]()

	// jobDrainProgress tracks UX-1.7 disk drain / catch-up progress per job.
	jobDrainProgress = ds.MakeSyncMap[drainProgressInfo]()

	jobTerminationMessageWritten = ds.MakeSyncMap[bool]()

	lastAutoReconnectAttempt = ds.MakeSyncMap[int64]()

	reconnectConnGroup       singleflight.Group
	reconnectRouteGroup      singleflight.Group
	terminateJobManagerGroup singleflight.Group

	// test hooks for unit testing auto-reconnect behavior
	isConnectedTestHook           func(connName string) (bool, error)
	reconcileOnUpTestHook         func(connName string)
	reconcileOnDownTestHook       func(connName string)
	hasRunningDurableJobsTestHook func(ctx context.Context, connName string) bool

	// NeedsInteractiveAuthTestHook overrides the needsInteractiveAuth check
	// inside startReconnectScheduler. Set from tests to control whether the
	// scheduler is started. Nil by default (production uses CanReconnectWithoutPrompt).
	NeedsInteractiveAuthTestHook func(connName string) bool

	// StartupReconnectSchedulerTestHook, when set, is called by
	// StartConnectionReconnectScheduler instead of starting the real scheduler.
	// Lets tests verify the wiring (that blockcontroller calls this function)
	// without needing to observe the scheduler goroutine state.
	// Nil by default (production starts the real scheduler).
	StartupReconnectSchedulerTestHook func(connName string)

	// test hooks for unit testing onConnectionUp / ReconnectJobsForConn behavior
	reconnectJobTestHook      func(ctx context.Context, jobId string) error
	getAllJobsForConnTestHook func(connName string) ([]*waveobj.Job, error)
	getJobTestHook            func(jobId string) (*waveobj.Job, error)

	// retryBackoffs is the per-attempt sleep before retrying failed job reconnects.
	// Package var so tests can override with short durations.
	retryBackoffs = []time.Duration{3 * time.Second, 6 * time.Second, 12 * time.Second}

	// active connection-reconnect schedulers (deduplication for onConnectionDown)
	connectionReconnectSchedulers = ds.MakeSyncMap[bool]()

	// recentReconnectAttempts tracks timestamps of recent reconnect attempts
	// per connection for flapping detection (UX-2.2).
	recentReconnectAttempts = ds.MakeSyncMap[[]int64]()
)

const ConnReconnectInterval = 5 * time.Second
const ConnReconnectMaxDuration = 5 * time.Minute        // cap for interactive-attempt connections (defensive; interactive conns rarely reach the scheduler post-fix-#1)
const ConnReconnectMaxDurationSilent = 15 * time.Minute // cap for silently-reconnectable connections (key-based / cached password) — silent retries are cheap
const ConnReconnectAggressiveInterval = 3 * time.Second
const ConnReconnectAggressiveDuration = 2 * time.Minute

// FlappingWindowDuration is the lookback window for detecting rapid
// disconnect/reconnect cycles. (UX-2.2)
const FlappingWindowDuration = 30 * time.Second

// FlappingAttemptThreshold is the minimum number of reconnect attempts
// within FlappingWindowDuration to trigger flapping mode. (UX-2.2)
const FlappingAttemptThreshold = 3

func InitJobController() {
	go connReconcileWorker()
	go jobPruningWorker()
	go streamHealthWatchdog()

	// Stop reconnect scheduler whenever user Disconnect or Stop auto-retry
	// sets suppress — avoids import cycle (conncontroller cannot import us).
	conncontroller.OnUserSuppressAutoReconnect = StopReconnectScheduler
	// Start the reconnect scheduler as soon as an involuntary disconnect is
	// detected on an auto-reconnectable connection, so the first attempt can
	// run during the disconnect hysteresis window instead of waiting for the
	// (possibly delayed) connchange event. (UX-2.1)
	conncontroller.OnInvoluntaryDisconnect = onConnectionDown

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
	data.StartupError = job.JobManagerStartupError
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

	// UX-1.7: include drain catch-up progress when active
	if drain, ok := jobDrainProgress.GetEx(job.OID); ok && drain.active && drain.remainingBytes > 0 {
		data.DrainActive = true
		data.DrainTotalBytes = drain.totalBytes
		data.DrainRemainingBytes = drain.remainingBytes
	}

	return data, nil
}

// setJobDrainProgress seeds or clears UX-1.7 drain tracking for a job and
// publishes a block job status event when the attached block is known.
func setJobDrainProgress(ctx context.Context, jobId string, active bool, total, remaining int64) {
	if !active || remaining <= 0 {
		jobDrainProgress.Delete(jobId)
	} else {
		jobDrainProgress.Set(jobId, drainProgressInfo{
			active:         true,
			totalBytes:     total,
			remainingBytes: remaining,
			lastEventAt:    time.Now(),
		})
	}
	sendBlockJobStatusEventByJobId(ctx, jobId)
}

func sendBlockJobStatusEventByJobId(ctx context.Context, jobId string) {
	job, err := wstore.DBGet[*waveobj.Job](ctx, jobId)
	if err != nil || job == nil || job.AttachedBlockId == "" {
		return
	}
	SendBlockJobStatusEvent(ctx, job.AttachedBlockId)
}

// noteDrainBytesReceived decrements drain remaining as stream data arrives.
// Publishes status at most ~4 times/sec while draining.
func noteDrainBytesReceived(ctx context.Context, jobId string, n int) {
	if n <= 0 {
		return
	}
	drain, ok := jobDrainProgress.GetEx(jobId)
	if !ok || !drain.active {
		return
	}
	drain.remainingBytes -= int64(n)
	if drain.remainingBytes <= 0 {
		jobDrainProgress.Delete(jobId)
		sendBlockJobStatusEventByJobId(ctx, jobId)
		return
	}
	now := time.Now()
	shouldPublish := now.Sub(drain.lastEventAt) >= 250*time.Millisecond
	if shouldPublish {
		drain.lastEventAt = now
	}
	jobDrainProgress.Set(jobId, drain)
	if shouldPublish {
		sendBlockJobStatusEventByJobId(ctx, jobId)
	}
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

// streamHealthWatchdog periodically flags output streams that are marked active
// but whose lastReadAt has gone stale. A stale lastReadAt means runOutputLoop is
// blocked in Read() — either the shell is idle (benign) or the stream has wedged
// (ACK window stuck, no data arriving). Logged at most once per reLogInterval per
// stream so idle terminals don't spam the log. This is a corroborating signal for
// the ACK-timeout goroutine dump captured in streamclient.
func streamHealthWatchdog() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	const staleThreshold = 2 * time.Minute
	const reLogInterval = 15 * time.Minute
	for range ticker.C {
		now := time.Now()
		jobStreamHealth.ForEach(func(jobId string, health streamHealthInfo) {
			if !health.active {
				return
			}
			age := now.Sub(health.lastReadAt)
			if age <= staleThreshold {
				streamStaleLoggedAt.Delete(jobId)
				return
			}
			lastLogged, ok := streamStaleLoggedAt.GetEx(jobId)
			if ok && now.Sub(lastLogged) < reLogInterval {
				return
			}
			streamStaleLoggedAt.Set(jobId, now)
			remoteInfo := ""
			if health.remoteState != "" {
				remoteInfo = fmt.Sprintf(" [remote=%s, age=%s]", health.remoteState, now.Sub(health.remoteStateAt).Round(time.Second))
			}
			log.Printf("[streamhealth] job=%s stream=%s active but no output read for %s (totalBytes=%d)%s — idle or wedged",
				jobId, health.streamId, age.Round(time.Second), health.totalBytes, remoteInfo)
		})
	}
}

// HandleStreamStatusReport consumes StreamStatusReport RPCs from a remote
// jobmanager (spec: .pi/specs/stream-data-path-resilience.md). Reports arrive
// only on state transitions or while stalled, so logging each is low-volume.
func HandleStreamStatusReport(data wshrpc.CommandStreamStatusData) {
	health, _ := jobStreamHealth.GetEx(data.JobId)
	prev := health.remoteState
	health.remoteState = data.State
	health.remoteStateAt = time.Now()
	if data.StreamId != "" {
		health.streamId = data.StreamId
	}
	jobStreamHealth.Set(data.JobId, health)
	if prev != data.State {
		log.Printf("[streamhealth] job=%s stream=%s remote state %q -> %q (sentNotAcked=%d bufCount=%d rwnd=%d lastAckAgo=%s retryCount=%d diskBufBytes=%d)",
			data.JobId, data.StreamId, prev, data.State, data.SentNotAcked, data.BufCount, data.RWnd,
			time.Duration(data.LastAckAgeMs)*time.Millisecond, data.RetryCount, data.DiskBufBytes)
	}
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
		if cs.reconciling || cs.actualGen == cs.procGen {
			continue
		}

		cs.reconciling = true
		actual := cs.actual
		actualGen := cs.actualGen
		go reconcileConn(connName, actual, actualGen)
	}
}

func reconcileConn(connName string, targetState bool, targetGen int) {
	defer func() {
		panichandler.PanicHandler("jobcontroller:reconcileConn", recover())
	}()

	if targetState {
		if reconcileOnUpTestHook != nil {
			reconcileOnUpTestHook(connName)
		} else {
			onConnectionUp(connName)
		}
	} else {
		if reconcileOnDownTestHook != nil {
			reconcileOnDownTestHook(connName)
		} else {
			onConnectionDown(connName)
		}
	}

	connStates.Lock()
	if cs, exists := connStates.m[connName]; exists {
		cs.procGen = targetGen
		cs.reconciling = false
		needsSignal := cs.actualGen != cs.procGen
		connStates.Unlock()
		if needsSignal {
			select {
			case connStates.reconcileCh <- struct{}{}:
			default:
			}
		}
	} else {
		connStates.Unlock()
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

func jobPruningWorker() {
	defer func() {
		panichandler.PanicHandler("jobcontroller:jobPruningWorker", recover())
	}()

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	var previousCandidates []string
	for range ticker.C {
		previousCandidates = pruneUnusedJobs(previousCandidates)
	}
}

func pruneUnusedJobs(previousCandidates []string) []string {
	ctx, cancelFn := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelFn()

	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		log.Printf("[jobpruner] error getting all jobs: %v", err)
		return previousCandidates
	}

	var currentCandidates []string
	for _, job := range allJobs {
		if job.JobManagerStatus == JobManagerStatus_Done && job.AttachedBlockId == "" {
			currentCandidates = append(currentCandidates, job.OID)
		}
	}

	jobsToDelete := utilfn.StrSetIntersection(previousCandidates, currentCandidates)
	if len(previousCandidates) > 0 || len(currentCandidates) > 0 {
		log.Printf("[jobpruner] prev=%d current=%d deleting=%d", len(previousCandidates), len(currentCandidates), len(jobsToDelete))
	}

	for _, jobId := range jobsToDelete {
		err := DeleteJob(ctx, jobId)
		if err != nil {
			log.Printf("[jobpruner] error deleting job %s: %v", jobId, err)
		}
	}

	return currentCandidates
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

			if newStatus == JobConnStatus_Connected {
				health, _ := jobStreamHealth.GetEx(jobId)
				log.Printf("[job:%s] route up: set Connected via route event (stream active=%v, streamId=%q) — stream NOT restarted here",
					jobId, health.active, health.streamId)
			}

			if newStatus == JobConnStatus_Disconnected && job != nil && isJobManagerRunning(job) {
				if shouldAttemptAutoReconnect(jobId) {
					go attemptAutoReconnect(jobId, job.Connection)
				}
			}
		}
	}
}

func shouldAttemptAutoReconnect(jobId string) bool {
	now := time.Now().Unix()
	lastAttempt, exists := lastAutoReconnectAttempt.GetEx(jobId)

	if !exists {
		return true
	}

	timeSinceLastAttempt := time.Duration(now-lastAttempt) * time.Second
	if timeSinceLastAttempt >= AutoReconnectCooldown {
		return true
	}

	return false
}

func attemptAutoReconnect(jobId string, connName string) {
	defer func() {
		panichandler.PanicHandler("jobcontroller:attemptAutoReconnect", recover())
	}()

	time.Sleep(AutoReconnectDelay)

	var isConnected bool
	var err error
	if isConnectedTestHook != nil {
		isConnected, err = isConnectedTestHook(connName)
	} else {
		isConnected, err = conncontroller.IsConnected(connName)
	}
	if err != nil || !isConnected {
		log.Printf("[job:%s] connection %s is down, skipping auto-reconnect", jobId, connName)
		return
	}

	lastAutoReconnectAttempt.Set(jobId, time.Now().Unix())

	log.Printf("[job:%s] connection %s still up after route down, attempting auto-reconnect to determine job manager status", jobId, connName)
	ctx, cancelFn := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelFn()
	err = ReconnectJobRoute(ctx, jobId, nil)
	if err != nil {
		log.Printf("[job:%s] auto-reconnect failed: %v", jobId, err)
	} else {
		log.Printf("[job:%s] auto-reconnect succeeded", jobId)
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
		cs = &connState{actual: false, procGen: 0, actualGen: 0, reconciling: false}
		connStates.m[connName] = cs
	}
	if cs.actual != connStatus.Connected {
		cs.actual = connStatus.Connected
		cs.actualGen++
	}
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
		TerminateAndDetachJob(ctx, jobId)
	}
}

func onConnectionUp(connName string) {
	log.Printf("[conn:%s] connection became connected, reconnecting jobs", connName)

	// Short ctx for DB lookup only — do NOT share across job reconnects.
	lookupCtx, lookupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer lookupCancel()

	var allJobs []*waveobj.Job
	var err error
	if getAllJobsForConnTestHook != nil {
		allJobs, err = getAllJobsForConnTestHook(connName)
	} else {
		allJobs, err = wstore.DBGetAllObjsByType[*waveobj.Job](lookupCtx, waveobj.OType_Job)
	}
	if err != nil {
		log.Printf("[conn:%s] failed to get jobs for reconnection: %v", connName, err)
		return
	}

	var jobsToReconnect []*waveobj.Job
	if getAllJobsForConnTestHook != nil {
		// Hook returns pre-filtered jobs.
		jobsToReconnect = allJobs
	} else {
		for _, job := range allJobs {
			if job.Connection == connName && isJobManagerRunning(job) {
				jobsToReconnect = append(jobsToReconnect, job)
			}
		}
	}

	log.Printf("[conn:%s] found %d jobs to reconnect", connName, len(jobsToReconnect))

	// Per-job reconnect: each gets a fresh 10s ctx to avoid starvation.
	successCount := 0
	failedJobIds := make([]string, 0)
	for _, job := range jobsToReconnect {
		jobCtx, jobCancel := context.WithTimeout(context.Background(), 10*time.Second)
		var reconnectErr error
		if reconnectJobTestHook != nil {
			reconnectErr = reconnectJobTestHook(jobCtx, job.OID)
		} else {
			reconnectErr = ReconnectJob(jobCtx, job.OID, nil)
		}
		jobCancel()
		if reconnectErr != nil {
			log.Printf("[job:%s] error reconnecting: %v", job.OID, reconnectErr)
			failedJobIds = append(failedJobIds, job.OID)
		} else {
			successCount++
		}
	}

	log.Printf("[conn:%s] finished reconnecting jobs: %d/%d successful", connName, successCount, len(jobsToReconnect))

	// Bounded retry of failed jobs (3 attempts, 3s/6s/12s backoff).
	if len(failedJobIds) == 0 {
		return
	}

	recovered := make(map[string]bool)
	totalRetries := 0

	for attempt, backoff := range retryBackoffs {
		time.Sleep(backoff)

		// Re-check connection is still up.
		var isConnected bool
		var checkErr error
		if isConnectedTestHook != nil {
			isConnected, checkErr = isConnectedTestHook(connName)
		} else {
			isConnected, checkErr = conncontroller.IsConnected(connName)
		}
		if checkErr != nil || !isConnected {
			log.Printf("[conn:%s] aborting job reconnect retry: connection down", connName)
			break
		}

		remaining := len(failedJobIds) - len(recovered)
		if remaining == 0 {
			break
		}

		totalRetries++
		log.Printf("[conn:%s] retry attempt %d/3 for %d remaining jobs", connName, attempt+1, remaining)

		for _, jobId := range failedJobIds {
			if recovered[jobId] {
				continue
			}

			// Re-fetch job to check terminal status.
			var job *waveobj.Job
			var dbErr error
			if getJobTestHook != nil {
				job, dbErr = getJobTestHook(jobId)
			} else {
				retryCtx, retryCancel := context.WithTimeout(context.Background(), 5*time.Second)
				job, dbErr = wstore.DBGet[*waveobj.Job](retryCtx, jobId)
				retryCancel()
			}
			if dbErr != nil || job == nil {
				log.Printf("[job:%s] skipping retry: job not found", jobId)
				recovered[jobId] = true
				continue
			}
			if job.JobManagerStatus == JobManagerStatus_Done {
				log.Printf("[job:%s] skipping retry: job is done", jobId)
				recovered[jobId] = true
				continue
			}

			// Stream-health-aware skip: if already connected with active stream, converged.
			checkCtx, checkCancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, checkErr2 := CheckJobConnected(checkCtx, jobId)
			checkCancel()
			if checkErr2 == nil {
				if health, ok := jobStreamHealth.GetEx(jobId); ok && health.active {
					log.Printf("[job:%s] skipping retry: already connected with active stream", jobId)
					recovered[jobId] = true
					continue
				}
			}

			// Attempt reconnect.
			jobCtx, jobCancel := context.WithTimeout(context.Background(), 10*time.Second)
			var reconnectErr error
			if reconnectJobTestHook != nil {
				reconnectErr = reconnectJobTestHook(jobCtx, jobId)
			} else {
				reconnectErr = ReconnectJob(jobCtx, jobId, nil)
			}
			jobCancel()
			if reconnectErr != nil {
				log.Printf("[job:%s] retry attempt %d: %v", jobId, attempt+1, reconnectErr)
			} else {
				log.Printf("[job:%s] retry attempt %d: succeeded", jobId, attempt+1)
				recovered[jobId] = true
				successCount++
			}
		}
	}

	log.Printf("[conn:%s] finished reconnecting jobs: %d/%d successful (after %d retries)", connName, successCount, len(jobsToReconnect), totalRetries)
}

// HandleSystemResume is called on macOS system wake (via NotifySystemResumeCommand).
// It forces a disconnect/reconnect cycle for all connections with running durable jobs
// that are either stalled or disconnected, bypassing the normal monitor tick timing.
func HandleSystemResume(ctx context.Context) {
	log.Printf("[system] handling system resume, checking connections for fast-path reconnect")

	allStatuses := conncontroller.GetAllConnStatus()
	for _, status := range allStatuses {
		connName := status.Connection
		if conncontroller.IsLocalConnName(connName) {
			continue
		}
		// UX-0.1: user Disconnect / Stop auto-retry must not auto-reconnect on resume.
		if status.SuppressAutoReconnect || conncontroller.IsSuppressAutoReconnectByName(connName) {
			log.Printf("[system] connection %s has auto-reconnect suppressed, skipping fast-path reconnect", connName)
			continue
		}
		if !hasRunningDurableJobsForConn(ctx, connName) {
			continue
		}
		if needsInteractiveAuth(connName) {
			log.Printf("[system] connection %s may require interactive auth, skipping fast-path reconnect", connName)
			continue
		}

		// Already connected and healthy — nothing to do
		if status.Status == conncontroller.Status_Connected && status.ConnHealthStatus == conncontroller.ConnHealthStatus_Good {
			continue
		}

		// Clean up any stale scheduler entry so we don't race with it
		connectionReconnectSchedulers.Delete(connName)

		// Stalled (zombie after sleep) — force disconnect first so reconnect starts fresh
		if status.Status == conncontroller.Status_Connected && status.ConnHealthStatus == conncontroller.ConnHealthStatus_Stalled {
			log.Printf("[system] connection %s stalled after resume, forcing disconnect", connName)
			connOpts, err := remote.ParseOpts(connName)
			if err == nil {
				conn := conncontroller.MaybeGetConn(connOpts)
				if conn != nil {
					// Close synchronously — ensures status is Disconnected before we attempt reconnect.
					// Involuntary disconnect — preserve the cached password so the
					// immediate AttemptReconnect below can reuse it silently.
					conn.CloseInvoluntary()
				}
			}
		}

		// Attempt immediate reconnect (bypasses 30s scheduler tick)
		log.Printf("[system] fast-path reconnect for %s", connName)
		go func(cn string) {
			defer func() {
				panichandler.PanicHandler("jobcontroller:HandleSystemResume-reconnect", recover())
			}()
			reconnectCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()
			err := conncontroller.AttemptReconnect(reconnectCtx, cn)
			if err != nil {
				log.Printf("[system] fast-path reconnect for %s failed: %v", cn, err)
			} else {
				log.Printf("[system] fast-path reconnect for %s succeeded", cn)
			}
		}(connName)
	}
}

// needsInteractiveAuth checks if a connection might require an interactive prompt
// (password, key passphrase, or keyboard-interactive). When true, automatic
// reconnect cannot succeed without user involvement, so the scheduler should
// skip it. Delegates to conncontroller.CanReconnectWithoutPrompt, which uses
// the runtime auth-prompt flag (set after a successful handshake) as the primary
// signal and falls back to a ~/.ssh/config publickey check when the flag is
// unknown (cold start or after an auth failure).
func needsInteractiveAuth(connName string) bool {
	if NeedsInteractiveAuthTestHook != nil {
		return NeedsInteractiveAuthTestHook(connName)
	}
	return !conncontroller.CanReconnectWithoutPrompt(connName)
}

func onConnectionDown(connName string) {
	log.Printf("[conn:%s] connection became disconnected", connName)
	startReconnectScheduler(connName)
}

// startReconnectScheduler starts the reconnect scheduler for a connection,
// deduplicated via connectionReconnectSchedulers. Shared by onConnectionDown
// (disconnect trigger) and StartConnectionReconnectScheduler (startup trigger).
// Skips local connections and connections requiring interactive auth (the
// latter have requestPasswordRePrompt for retries; the scheduler would race it).
func startReconnectScheduler(connName string) {
	// Skip local connections — they don't need SSH reconnect
	if conncontroller.IsLocalConnName(connName) {
		return
	}

	// UX-0.1 / UX-0.5: user Disconnect or Stop auto-retry — do not schedule.
	if conncontroller.IsSuppressAutoReconnectByName(connName) {
		log.Printf("[conn:%s] auto-reconnect suppressed, skipping reconnect scheduler", connName)
		return
	}

	// Connections requiring interactive auth (password/keyboard-interactive)
	// without a cached password never start the auto-reconnect scheduler.
	// The password prompt is a persistent buffer independent of connection
	// lifecycle — re-prompts and retries are handled by the conncontroller's
	// background re-prompt goroutine (see conncontroller.requestPasswordRePrompt).
	if needsInteractiveAuth(connName) {
		log.Printf("[conn:%s] connection requires interactive auth, skipping auto-reconnect scheduler", connName)
		return
	}

	// Deduplicate: only one scheduler per connection at a time
	if _, exists := connectionReconnectSchedulers.GetEx(connName); exists {
		return
	}
	connectionReconnectSchedulers.Set(connName, true)
	go func() {
		defer func() {
			panichandler.PanicHandler("jobcontroller:scheduleConnectionReconnect", recover())
		}()
		defer connectionReconnectSchedulers.Delete(connName)
		scheduleConnectionReconnect(connName)
	}()
}

// StopReconnectScheduler requests the reconnect scheduler for connName to exit
// on its next loop check and removes the dedup entry so a future deliberate
// reconnect can start a new scheduler after involuntary drops. Also clears
// UI reconnect countdown state. Used by ConnStopAutoRetryCommand (UX-0.5).
func StopReconnectScheduler(connName string) {
	connectionReconnectSchedulers.Delete(connName)
	clearRetryState(connName)
	log.Printf("[conn:%s] reconnect scheduler stop requested", connName)
}

// StartConnectionReconnectScheduler starts the reconnect scheduler for a
// connection that failed to connect at startup. Unlike onConnectionDown, this
// does not require a Connected→Disconnected transition (which never happens for
// a conn that was never Connected — the connchange event has Connected:false,
// matching the initial state, so handleConnChangeEvent does not increment
// actualGen and onConnectionDown never fires).
//
// Used by StartupReconnectDurableShells when EnsureConnection fails for a
// non-interactive-auth connection. Reuses the same scheduler as onConnectionDown
// (5s interval, 5min cap, aggressive mode on network errors) — the dedup map
// ensures only one scheduler runs per connection.
func StartConnectionReconnectScheduler(connName string) {
	log.Printf("[conn:%s] starting reconnect scheduler after startup failure", connName)
	if StartupReconnectSchedulerTestHook != nil {
		StartupReconnectSchedulerTestHook(connName)
		return
	}
	startReconnectScheduler(connName)
}

// ConnectionReconnectSchedulerExists returns true if a reconnect scheduler is
// currently running for connName. Exported for cross-package test observation
// (e.g., blockcontroller tests verifying the scheduler did not start for
// interactive-auth connections).
func ConnectionReconnectSchedulerExists(connName string) bool {
	_, exists := connectionReconnectSchedulers.GetEx(connName)
	return exists
}

// isNetworkUnreachableError returns true when an error indicates the local
// network is down or unreachable (e.g., Wi-Fi changed, no route, interface down).
// It filters out server-side errors like connection refused or auth failures.
func isNetworkUnreachableError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	networkPatterns := []string{
		"no route to host",
		"network is unreachable",
		"no such host",
		"temporary failure in name resolution",
		"connection timed out",
		"can't assign requested address",
		"address not available",
	}
	for _, p := range networkPatterns {
		if strings.Contains(s, p) {
			return true
		}
	}
	// Dial timeout specifically (not general I/O timeout after connect)
	if strings.Contains(s, "dial tcp") && strings.Contains(s, "i/o timeout") {
		return true
	}
	if strings.Contains(s, "context deadline exceeded") {
		return true
	}
	return false
}

// scheduleConnectionReconnect periodically attempts to reconnect a connection
// that has running durable jobs. It stops when the connection comes back up
// or when no running durable jobs remain.
// When the network appears unreachable (e.g., after Wi-Fi change), it switches
// to aggressive mode: 5s interval for up to 2 minutes to catch the network
// return faster.
// The first reconnect attempt fires immediately; subsequent attempts follow
// the scheduler interval. This avoids the 30s fixed delay from ticker-based
// loops when the network returns quickly.
func updateRetryState(connName string, attempt int, nextAttempt int64, errMsg string) {
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn != nil {
		conn.SetReconnectState(attempt, nextAttempt, errMsg)

		// UX-2.2: Flapping detection — track recent attempt timestamps.
		// If ≥FlappingAttemptThreshold attempts in the last FlappingWindowDuration,
		// set FlappingMode so the frontend shows a single stable overlay.
		now := time.Now().UnixMilli()
		times := append(getReconnectTimes(connName), now)
		// Prune old entries outside the window
		cutoff := now - int64(FlappingWindowDuration/time.Millisecond)
		pruned := make([]int64, 0, len(times))
		for _, t := range times {
			if t >= cutoff {
				pruned = append(pruned, t)
			}
		}
		recentReconnectAttempts.Set(connName, pruned)
		flapping := len(pruned) >= FlappingAttemptThreshold
		conn.SetFlappingMode(flapping)

		conn.FireConnChangeEvent()
	}
}

// getReconnectTimes returns the current reconnect attempt timestamps for a
// connection. Extracted for testability.
func getReconnectTimes(connName string) []int64 {
	times, _ := recentReconnectAttempts.GetEx(connName)
	return times
}

func clearRetryState(connName string) {
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn != nil {
		conn.ClearReconnectState()
		conn.SetFlappingMode(false)
		conn.FireConnChangeEvent()
	}
	// Clear flapping tracking for this connection
	recentReconnectAttempts.Delete(connName)
}

// setReconnectGaveUpState records that the scheduler gave up.
// UX-1.1: persists the stop reason so the frontend can show contextual copy.
// Snapshots the last reconnect/connect error so clearRetryState does not wipe it.
func setReconnectGaveUpState(connName string, reason string) {
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn != nil {
		status := conn.DeriveConnStatus()
		lastErr := status.ReconnectError
		if lastErr == "" {
			lastErr = status.Error
		}
		conn.SetReconnectGaveUp(true, reason, lastErr)
	}
}

// clearReconnectGaveUpState resets gave-up state (called on successful reconnect).
func clearReconnectGaveUpState(connName string) {
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn != nil {
		conn.ClearReconnectGaveUp()
	}
}

// agentUnavailableErrorMsg is the UX-2.5 message shown when an agent-based
// connection fails authentication after sleep/resume because the SSH agent or
// keychain is locked/unavailable.
const agentUnavailableErrorMsg = "SSH agent may be unavailable — unlock your keychain or restart your SSH agent"

// maybeSetAgentUnavailableError sets conn.Error (and fires a connchange event)
// on the named connection with the agent-unavailable message. Called only on
// the auth-failed path, and only when the last successful handshake used no
// interactive prompt (agent/key-based, captured BEFORE the failed attempt —
// a credential-rejection error clears authPromptState on the way out of
// Connect). Permanent host-key / known_hosts errors never get this message:
// their own error copy is the source of truth. (UX-2.5)
func maybeSetAgentUnavailableError(connName string, wasAgentBasedAuth bool) {
	if !wasAgentBasedAuth {
		return
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn != nil {
		conn.SetConnError(agentUnavailableErrorMsg)
		conn.FireConnChangeEvent()
	}
}

// schedulerAttemptErrorAction is the outcome of classifying a failed reconnect
// attempt in the scheduler loop.
type schedulerAttemptErrorAction struct {
	stop         bool   // true if the scheduler should exit
	gaveUpReason string // set when stopping with a gave-up reason (UX-1.1)
	logMsg       string // scheduler log line for the stop reason
}

// classifySchedulerAttemptError decides how the reconnect scheduler should
// respond to a failed reconnect attempt: keep retrying (re-arm countdown) or
// stop (optionally recording a gave-up reason).
//
// UX-2.5: auth-failed on a connection whose last successful handshake used no
// interactive prompt (agent/key-based) surfaces an agent-unavailable message
// instead of a generic credential rejection — after sleep/resume the agent may
// be locked or unavailable while the user's credentials are actually fine.
// Permanent host-key / known_hosts / config errors never get that treatment.
func classifySchedulerAttemptError(connName string, err error, wasAgentBasedAuth bool) schedulerAttemptErrorAction {
	errorCode, errorSubCode := remote.ClassifyConnError(err)
	// Early termination: auth-failed means the server is up but rejecting
	// credentials. Retrying won't help — the user must fix credentials (or the
	// agent must be unlocked). The requestPasswordRePrompt goroutine handles
	// re-prompting; the scheduler should exit.
	if errorCode == remote.ConnErrCode_AuthFailed {
		if wasAgentBasedAuth {
			maybeSetAgentUnavailableError(connName, true)
		}
		return schedulerAttemptErrorAction{
			stop:         true,
			gaveUpReason: "auth-failed",
			logMsg:       "auth-failed during reconnect, stopping scheduler (server rejecting credentials)",
		}
	}
	// UX-0.4: permanent handshake failures (host-key, known_hosts, config)
	// must not silent-retry. Suppress is set in Connect; exit immediately.
	// These never get the agent-unavailable message — the host-key/known_hosts
	// error itself is the source of truth.
	if remote.IsPermanentConnError(errorCode) {
		return schedulerAttemptErrorAction{
			stop:   true,
			logMsg: fmt.Sprintf("permanent error %q during reconnect, stopping scheduler", errorCode),
		}
	}
	// Early termination: connection-refused means the server is reachable but
	// the SSH service is not accepting connections (port closed, daemon
	// stopped, firewall rejecting). Retrying every 5s is wasteful —
	// visibility-driven reconnect will retry on the next tab switch / app
	// focus when the user returns.
	if errorCode == remote.ConnErrCode_Dial && errorSubCode == remote.DialSubCode_Refused {
		return schedulerAttemptErrorAction{
			stop:         true,
			gaveUpReason: "connection-refused",
			logMsg:       "connection refused during reconnect, stopping scheduler (server not accepting connections)",
		}
	}
	// Transient failure — keep retrying (the scheduler re-arms the countdown).
	return schedulerAttemptErrorAction{stop: false}
}

func scheduleConnectionReconnect(connName string) {
	log.Printf("[conn:%s] reconnect scheduler started", connName)
	startTime := time.Now()
	// Silently-reconnectable connections (key-based / cached password) get a
	// longer cap — silent retries are cheap and the user isn't bothered.
	// Interactive-attempt connections get the shorter default cap (defensive;
	// interactive conns rarely reach the scheduler post-fix-#1 since
	// needsInteractiveAuth gates onConnectionDown).
	maxDuration := ConnReconnectMaxDuration
	if !needsInteractiveAuth(connName) {
		maxDuration = ConnReconnectMaxDurationSilent
	}
	aggressiveMode := false
	var aggressiveUntil time.Time
	attempt := 0

	for {
		// UX-0.1 / UX-0.5: exit if user disconnected or stopped auto-retry mid-loop.
		if conncontroller.IsSuppressAutoReconnectByName(connName) {
			log.Printf("[conn:%s] auto-reconnect suppressed, stopping reconnect scheduler", connName)
			clearRetryState(connName)
			return
		}

		if time.Since(startTime) > maxDuration {
			log.Printf("[conn:%s] reconnect scheduler reached max duration, stopping", connName)
			setReconnectGaveUpState(connName, "max-duration")
			clearRetryState(connName)
			return
		}

		isConnected, checkErr := conncontroller.IsConnected(connName)
		if checkErr != nil {
			log.Printf("[conn:%s] error checking connection status: %v", connName, checkErr)
		} else if isConnected {
			log.Printf("[conn:%s] connection is back up, stopping reconnect scheduler", connName)
			clearReconnectGaveUpState(connName)
			clearRetryState(connName)
			return
		}

		// Use a generous timeout for job lookup — slow DB should not kill the scheduler
		ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
		hasJobs := hasRunningDurableJobsForConn(ctx, connName)
		cancelFn()
		if !hasJobs {
			// No blocks left — stop quietly without setting gave-up noise (UX-1.1 nit).
			// A later durable job / Connect will start fresh without stale stop reason.
			log.Printf("[conn:%s] no running durable jobs, stopping reconnect scheduler", connName)
			clearRetryState(connName)
			return
		}

		// Only attempt reconnect if we successfully checked connection status.
		// If status check failed, skip and wait for the next interval.
		if checkErr != nil {
			log.Printf("[conn:%s] skipping reconnect attempt (status check failed), will retry next interval", connName)
		} else {
			attempt++
			updateRetryState(connName, attempt, 0, "") // active attempt
			connectTimeout := 5 * time.Second
			log.Printf("[conn:%s] scheduler attempt start (timeout=%s, aggressive=%v)", connName, connectTimeout, aggressiveMode)
			attemptStart := time.Now()
			// UX-2.5: capture whether the last successful handshake used no
			// interactive prompt (agent/key-based) BEFORE this attempt. A
			// credential-rejection error clears authPromptState on the way out
			// of Connect, so the agent-unavailable decision must use the
			// pre-attempt classification.
			wasAgentBasedAuth := conncontroller.WasAgentBasedAuthByName(connName)
			ctx, cancelFn := context.WithTimeout(context.Background(), connectTimeout)
			err := conncontroller.AttemptReconnect(ctx, connName)
			cancelFn()
			attemptDuration := time.Since(attemptStart)

			// H1: user may Disconnect / Stop auto-retry *during* the attempt.
			// Close/Pause clear reconnect UI state, but a concurrent failure
			// must not call updateRetryState and re-arm the countdown while
			// suppress is set. Check both the flag and the sentinel error.
			if conncontroller.IsSuppressAutoReconnectByName(connName) || errors.Is(err, conncontroller.ErrAutoReconnectSuppressed) {
				log.Printf("[conn:%s] auto-reconnect suppressed after attempt (duration=%v, err=%v), stopping scheduler", connName, attemptDuration, err)
				clearRetryState(connName)
				return
			}

			if err != nil {
				isNetErr := isNetworkUnreachableError(err)
				log.Printf("[conn:%s] scheduler attempt failed in %v (net-unreachable=%v): %v", connName, attemptDuration, isNetErr, err)

				action := classifySchedulerAttemptError(connName, err, wasAgentBasedAuth)
				if action.stop {
					log.Printf("[conn:%s] %s", connName, action.logMsg)
					if action.gaveUpReason != "" {
						setReconnectGaveUpState(connName, action.gaveUpReason)
					}
					clearRetryState(connName)
					return
				}

				// Final suppress re-check before re-arming countdown (race
				// between classification and updateRetryState).
				if conncontroller.IsSuppressAutoReconnectByName(connName) {
					log.Printf("[conn:%s] auto-reconnect suppressed before updateRetryState, stopping scheduler", connName)
					clearRetryState(connName)
					return
				}

				// Update retry state with failure info and next attempt time
				interval := ConnReconnectInterval
				if aggressiveMode {
					interval = ConnReconnectAggressiveInterval
				}
				nextAttempt := time.Now().Add(interval).UnixMilli()
				updateRetryState(connName, attempt, nextAttempt, err.Error())

				// Switch to aggressive mode when network is unreachable
				if isNetErr {
					if !aggressiveMode {
						log.Printf("[conn:%s] network unreachable, switching to aggressive mode (5s interval)", connName)
						aggressiveMode = true
					}
					// Extend aggressive window each time we see a network error
					aggressiveUntil = time.Now().Add(ConnReconnectAggressiveDuration)
				}
			} else {
				log.Printf("[conn:%s] scheduler attempt succeeded in %v", connName, attemptDuration)
				clearReconnectGaveUpState(connName)
				clearRetryState(connName)
				return
			}
		}

		// Return to normal interval when aggressive window expires
		if aggressiveMode && time.Now().After(aggressiveUntil) {
			log.Printf("[conn:%s] aggressive mode expired, returning to normal interval", connName)
			aggressiveMode = false
		}

		// Wait for next interval before retrying.
		// UX-2.7: Add per-connection jitter (±50% of interval) so multiple
		// connections with active schedulers do not hammer the network
		// simultaneously. This spreads out retry attempts naturally.
		interval := ConnReconnectInterval
		if aggressiveMode {
			interval = ConnReconnectAggressiveInterval
		}
		jitteredInterval := jitterInterval(interval)
		timer := time.NewTimer(jitteredInterval)
		<-timer.C
		timer.Stop()
	}
}

// jitterInterval returns d ± d/2 (randomized). Used to stagger retry
// intervals across multiple connections so they don't fire simultaneously.
// (UX-2.7)
func jitterInterval(d time.Duration) time.Duration {
	jitter := time.Duration(rand.Int63n(int64(d / 2)))
	// Randomly add or subtract jitter
	if rand.Intn(2) == 0 {
		return d + jitter
	}
	return d - jitter
}

// hasRunningDurableJobsForConn checks if a connection has any running durable jobs.
func hasRunningDurableJobsForConn(ctx context.Context, connName string) bool {
	if hasRunningDurableJobsTestHook != nil {
		return hasRunningDurableJobsTestHook(ctx, connName)
	}
	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		log.Printf("[conn:%s] error getting jobs for reconnect check: %v", connName, err)
		return false
	}
	for _, job := range allJobs {
		if job.Connection == connName && isJobManagerRunning(job) {
			return true
		}
	}
	return false
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

func GetNumJobsRunning() int {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		return 0
	}
	count := 0
	for _, job := range allJobs {
		if job.JobManagerStatus == JobManagerStatus_Running {
			count++
		}
	}
	return count
}

func GetNumJobsConnected() int {
	jobControllerLock.Lock()
	defer jobControllerLock.Unlock()
	count := 0
	for _, status := range jobConnStates {
		if status == JobConnStatus_Connected {
			count++
		}
	}
	return count
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
	JobKind  string
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
	if params.JobKind != JobKind_Shell && params.JobKind != JobKind_Task {
		return "", fmt.Errorf("jobkind must be %q or %q", JobKind_Shell, JobKind_Task)
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
		JobKind:          params.JobKind,
		Cmd:              params.Cmd,
		CmdArgs:          params.Args,
		CmdEnv:           params.Env,
		CmdTermSize:      *params.TermSize,
		JobAuthToken:     jobAuthToken,
		JobManagerStatus: JobManagerStatus_Init,
		AttachedBlockId:  params.BlockId,
		WaveVersion:      wavebase.WaveVersion,
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
	jobReaders.Set(jobId, reader)

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

// reconcileClientAheadSeq computes the reconciliation when the server reports a
// stream seq behind the client's current position (the client's term file ran
// ahead of the server stream). Returns the new seq, new totalGap, and whether the
// term file must be truncated to newSeq.
func reconcileClientAheadSeq(currentSeq, totalGap, serverSeq int64) (newSeq, newTotalGap int64, needsTruncate bool) {
	fileSize := currentSeq - totalGap
	if serverSeq < fileSize {
		// The term file itself is longer than the server stream — phantom bytes at
		// the tail must be dropped.
		return serverSeq, 0, true
	}
	// The server end is within the gap region (the file is fine; totalGap was
	// over-counted). Just shrink the gap, no truncate needed.
	return serverSeq, serverSeq - fileSize, false
}

// truncateJobFile truncates the job's term file (and its attached block mirror)
// to size bytes and publishes truncate events so the frontend clears the terminal
// before the stream replays. Used when the client term file ran ahead of the server
// stream and must be reconciled to the server's authoritative end.
func truncateJobFile(ctx context.Context, jobId string, size int64) error {
	_, data, err := filestore.WFS.ReadAt(ctx, jobId, JobOutputFileName, 0, size)
	if err != nil {
		return fmt.Errorf("error reading term file for truncate: %w", err)
	}
	if err := filestore.WFS.WriteFile(ctx, jobId, JobOutputFileName, data); err != nil {
		return fmt.Errorf("error truncating job term file: %w", err)
	}

	job, jerr := wstore.DBGet[*waveobj.Job](ctx, jobId)
	if jerr == nil && job != nil && job.AttachedBlockId != "" {
		if _, bdata, berr := filestore.WFS.ReadAt(ctx, job.AttachedBlockId, JobOutputFileName, 0, size); berr == nil {
			if werr := filestore.WFS.WriteFile(ctx, job.AttachedBlockId, JobOutputFileName, bdata); werr != nil {
				log.Printf("[job:%s] error truncating block mirror term file: %v", jobId, werr)
			}
		}
	}

	// Publish truncate events so the frontend clears the terminal before replay.
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Job, jobId).String()},
		Data:   &wps.WSFileEventData{ZoneId: jobId, FileName: JobOutputFileName, FileOp: wps.FileOp_Truncate},
	})
	if job != nil && job.AttachedBlockId != "" {
		wps.Broker.Publish(wps.WaveEvent{
			Event:  wps.Event_BlockFile,
			Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, job.AttachedBlockId).String()},
			Data:   &wps.WSFileEventData{ZoneId: job.AttachedBlockId, FileName: JobOutputFileName, FileOp: wps.FileOp_Truncate},
		})
	}
	return nil
}

func runOutputLoop(ctx context.Context, jobId string, streamId string, reader *streamclient.Reader) {
	defer reader.Close()
	defer func() {
		health, _ := jobStreamHealth.GetEx(jobId)
		if health.streamId == streamId {
			health.active = false
			jobStreamHealth.Set(jobId, health)
		}
		log.Printf("[job:%s] [stream:%s] output loop finished (totalBytes=%d)", jobId, streamId, health.totalBytes)
	}()

	log.Printf("[job:%s] [stream:%s] output loop started", jobId, streamId)
	jobStreamHealth.Set(jobId, streamHealthInfo{
		active:     true,
		startedAt:  time.Now(),
		lastReadAt: time.Now(),
		streamId:   streamId,
	})
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			// Append to WaveFS before the supersession check so bytes returned by
			// Read() are never dropped, even when the stream is being superseded.
			// Dropping them would leave a hole in the term file (missing ESC bytes),
			// which neither a force-refresh nor a reconnect can repair.
			health, ok := jobStreamHealth.GetEx(jobId)
			if ok && health.streamId == streamId {
				health.lastReadAt = time.Now()
				health.totalBytes += int64(n)
				jobStreamHealth.Set(jobId, health)
			}
			// UX-1.7: track catch-up drain progress for overlay
			noteDrainBytesReceived(ctx, jobId, n)
			appendErr := handleAppendJobFile(ctx, jobId, JobOutputFileName, buf[:n])
			if appendErr != nil {
				log.Printf("[job:%s] error appending data to WaveFS: %v", jobId, appendErr)
			}
		}
		currentStreamId, _ := jobStreamIds.GetEx(jobId)
		if currentStreamId != streamId {
			log.Printf("[job:%s] [stream:%s] stream superseded by [stream:%s], exiting output loop", jobId, streamId, currentStreamId)
			break
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
		msg := "shell terminated - press enter to close"
		if updatedJob.CmdExitCode != nil && *updatedJob.CmdExitCode != 0 {
			msg = fmt.Sprintf("shell terminated (exit code %d) - press enter to close", *updatedJob.CmdExitCode)
		} else if updatedJob.CmdExitSignal != "" {
			msg = fmt.Sprintf("shell terminated (signal %s) - press enter to close", updatedJob.CmdExitSignal)
		}
		writeMutedMessageToTerminal(updatedJob.AttachedBlockId, "["+msg+"]")
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_ControllerStatus,
			Scopes: []string{
				waveobj.MakeORef(waveobj.OType_Block, updatedJob.AttachedBlockId).String(),
			},
			Data: struct {
				BlockId         string `json:"blockid"`
				Version         int64  `json:"version"`
				ShellProcStatus string `json:"shellprocstatus"`
			}{
				BlockId:         updatedJob.AttachedBlockId,
				Version:         time.Now().UnixMilli(),
				ShellProcStatus: "done",
			},
		})
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

func TerminateAndDetachJob(ctx context.Context, jobId string) {
	err := TerminateJobManager(ctx, jobId)
	if err != nil {
		log.Printf("[job:%s] error terminating job manager: %v", jobId, err)
	}
	err = DetachJobFromBlock(ctx, jobId, true)
	if err != nil {
		log.Printf("[job:%s] error detaching job from block: %v", jobId, err)
	}
}

func TerminateJobManager(ctx context.Context, jobId string) error {
	_, err, _ := terminateJobManagerGroup.Do(jobId, func() (any, error) {
		err := doTerminateJobManager(ctx, jobId)
		return nil, err
	})
	return err
}

func doTerminateJobManager(ctx context.Context, jobId string) error {
	var shouldTerminate bool
	var job *waveobj.Job
	err := wstore.DBUpdateFn(ctx, jobId, func(j *waveobj.Job) {
		job = j
		if j.JobManagerStatus == JobManagerStatus_Done {
			shouldTerminate = false
			return
		}
		j.TerminateOnReconnect = true
		shouldTerminate = true
	})
	if err != nil {
		return fmt.Errorf("failed to set TerminateOnReconnect: %w", err)
	}

	if !shouldTerminate {
		log.Printf("[job:%s] already terminated, skipping", jobId)
		return nil
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
		writeMutedMessageToTerminal(job.AttachedBlockId, "[shell terminated - press enter to close]")
	}

	if job.JobManagerStatus == JobManagerStatus_Done {
		log.Printf("[job:%s] job manager already marked as done, skipping termination", job.OID)
		return nil
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
	_, err, _ := reconnectConnGroup.Do(jobId, func() (any, error) {
		return nil, doReconnectJob(ctx, jobId, rtOpts)
	})
	return err
}

func ReconnectJobRoute(ctx context.Context, jobId string, rtOpts *waveobj.RuntimeOpts) error {
	_, err, _ := reconnectRouteGroup.Do(jobId, func() (any, error) {
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
		health, _ := jobStreamHealth.GetEx(jobId)
		log.Printf("[job:%s] already connected, skipping reconnect (stream active=%v, lastRead=%v, streamId=%q, totalBytes=%d)",
			jobId, health.active, health.lastReadAt.Format(time.RFC3339), health.streamId, health.totalBytes)
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
			writeJobTerminationMessage(ctx, jobId, updatedJob, "[session gone]")
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
	sendBlockJobStatusEventByJob(ctx, job)

	log.Printf("[job:%s] route established, restarting streaming", jobId)
	reconnectErr := restartStreaming(ctx, jobId, true, rtOpts)
	if reconnectErr != nil {
		log.Printf("[job:%s] restartStreaming failed after successful reconnect: %v (job left Connected without active stream)", jobId, reconnectErr)
	} else {
		log.Printf("[job:%s] restartStreaming succeeded", jobId)
	}
	return reconnectErr
}

func ReconnectJobsForConn(ctx context.Context, connName string) error {
	isConnected, err := conncontroller.IsConnected(connName)
	if err != nil {
		return fmt.Errorf("error checking connection status: %w", err)
	}
	if !isConnected {
		return fmt.Errorf("connection %q is not connected", connName)
	}

	// Use passed ctx for DB lookup only — each job gets its own reconnect ctx.
	var allJobs []*waveobj.Job
	if getAllJobsForConnTestHook != nil {
		allJobs, err = getAllJobsForConnTestHook(connName)
	} else {
		allJobs, err = wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	}
	if err != nil {
		return fmt.Errorf("failed to get jobs: %w", err)
	}

	var jobsToReconnect []*waveobj.Job
	if getAllJobsForConnTestHook != nil {
		// Hook returns pre-filtered jobs.
		jobsToReconnect = allJobs
	} else {
		for _, job := range allJobs {
			if job.Connection == connName && isJobManagerRunning(job) {
				jobsToReconnect = append(jobsToReconnect, job)
			}
		}
	}

	log.Printf("[conn:%s] found %d jobs to reconnect", connName, len(jobsToReconnect))

	// Per-job reconnect: each gets a fresh 10s ctx to avoid starvation.
	for _, job := range jobsToReconnect {
		jobCtx, jobCancel := context.WithTimeout(context.Background(), 10*time.Second)
		var reconnectErr error
		if reconnectJobTestHook != nil {
			reconnectErr = reconnectJobTestHook(jobCtx, job.OID)
		} else {
			reconnectErr = ReconnectJob(jobCtx, job.OID, nil)
		}
		jobCancel()
		if reconnectErr != nil {
			log.Printf("[job:%s] error reconnecting: %v", job.OID, reconnectErr)
		}
	}

	return nil
}

// waitForStreamLoopExit waits (bounded) for the runOutputLoop associated with
// the given streamId to exit. It is used after the previous stream reader is
// closed during a restart so that any in-flight bytes the old loop read are
// appended to WaveFS before the caller recomputes the stream seq.
func waitForStreamLoopExit(jobId string, streamId string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		health, ok := jobStreamHealth.GetEx(jobId)
		if !ok || !health.active || health.streamId != streamId {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	log.Printf("[job:%s] warning: output loop [stream:%s] did not exit within %v; proceeding without seq adjustment", jobId, streamId, timeout)
}

// classifyGapLoss tags a detected seq gap with the most likely loss class for
// diagnostics: a previous reader in-process implies the supersession race
// class; no previous reader implies the bytes died with an earlier process
// (restart/update/crash). Spec stream-gap-on-reconnect.md.
func classifyGapLoss(prevReaderOk bool) string {
	if prevReaderOk {
		return "supersession"
	}
	return "process-restart"
}

// drainJobReaderBuffer persists any acked-but-unwritten bytes from reader via
// appendFn. Safe on closed readers — bytes ACKed before Close live only in the
// buffer and are otherwise lost (acked + consumed remotely, never written).
// Returns the number of bytes persisted; 0 also covers append errors (the loss
// then surfaces as a gap on the next connect, same as pre-fix behavior).
func drainJobReaderBuffer(jobId string, reader *streamclient.Reader, appendFn func(data []byte) error) int {
	drained := reader.DrainBuffered()
	if len(drained) == 0 {
		return 0
	}
	if err := appendFn(drained); err != nil {
		log.Printf("[job:%s] error appending drained data to WaveFS (%d bytes lost): %v", jobId, len(drained), err)
		return 0
	}
	log.Printf("[job:%s] drained %d acked-but-unwritten buffered byte(s) to WaveFS", jobId, len(drained))
	return len(drained)
}

// DrainAllJobReaders persists buffered tail bytes for every live job reader.
// Called from doShutdown before the filestore flush so app updates/quits do
// not lose acked-but-unwritten bytes (Fix B2). Covers graceful shutdown only;
// crash/kill -9 needs the ACK-after-append redesign (follow-up spec B1).
func DrainAllJobReaders(ctx context.Context) {
	total := drainAllJobReadersWith(func(jobId string, data []byte) error {
		return handleAppendJobFile(ctx, jobId, JobOutputFileName, data)
	})
	if total > 0 {
		log.Printf("[streamgap] shutdown drain persisted %d byte(s) total", total)
	}
}

// drainAllJobReadersWith iterates all live job readers, returning total bytes
// recovered. appendFn injectable for tests.
func drainAllJobReadersWith(appendFn func(jobId string, data []byte) error) int {
	total := 0
	jobReaders.ForEach(func(jobId string, reader *streamclient.Reader) {
		total += drainJobReaderBuffer(jobId, reader, func(data []byte) error {
			return appendFn(jobId, data)
		})
	})
	return total
}

// RestartBlockStream restarts the output stream for a block's job, re-establishing
// the seq/ACK handshake with the remote StreamManager without reconnecting the SSH
// connection and without killing the shell. This is the manual recovery path
// ("Reconnect Stream") for a block whose output stream has wedged while the
// connection itself remains healthy (e.g. a flow-control/ACK deadlock).
func RestartBlockStream(ctx context.Context, blockId string) error {
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("failed to get block: %w", err)
	}
	if block == nil || block.JobId == "" {
		return fmt.Errorf("block %q has no attached job", blockId)
	}
	log.Printf("[block:%s] reconnect stream requested for job %s", blockId, block.JobId)
	if err := restartStreaming(ctx, block.JobId, false, nil); err != nil {
		return fmt.Errorf("failed to restart stream: %w", err)
	}
	log.Printf("[block:%s] reconnect stream completed for job %s", blockId, block.JobId)
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

	// Retrieve the previous reader (if any) before creating the new one.
	// It will be closed after the new streamId is set so that the old
	// runOutputLoop's supersession check (jobStreamIds != old streamId) fires
	// and exits cleanly instead of blocking forever on the dead stream.
	prevReader, prevReaderOk := jobReaders.GetEx(jobId)

	// Drain any bytes the previous reader already received (and ACKed to the
	// remote StreamManager) into WaveFS before computing currentSeq. Those bytes
	// are part of the remote stream seq space but not yet in the term file; if
	// they are dropped (the reader is closed below without draining), they are
	// permanently lost — a hole in the term file that a force-refresh cannot
	// repair, plus a bogus reconnect gap.
	if prevReaderOk {
		if drained := prevReader.DrainBuffered(); len(drained) > 0 {
			appendErr := handleAppendJobFile(ctx, jobId, JobOutputFileName, drained)
			if appendErr != nil {
				log.Printf("[job:%s] error appending drained data to WaveFS: %v", jobId, appendErr)
			}
		}
	}

	var currentSeq int64 = 0
	var totalGap int64 = 0
	initialFileSize := int64(0)
	waveFile, err := filestore.WFS.Stat(ctx, jobId, JobOutputFileName)
	if err == nil {
		initialFileSize = waveFile.Size
		currentSeq = waveFile.Size
		totalGap = getMetaInt64(waveFile.Meta, MetaKey_TotalGap)
		currentSeq += totalGap
	}

	bareRpc := wshclient.GetBareRpcClient()
	broker := bareRpc.StreamBroker
	readerRouteId := wshclient.GetBareRpcClientRouteId()
	writerRouteId := wshutil.MakeJobRouteId(jobId)

	oldStreamId, _ := jobStreamIds.GetEx(jobId)
	reader, streamMeta := broker.CreateStreamReaderWithSeq(readerRouteId, writerRouteId, DefaultStreamRwnd, currentSeq)
	jobStreamIds.Set(jobId, streamMeta.Id)
	jobReaders.Set(jobId, reader)

	// Close the previous reader to unblock its runOutputLoop. The old stream
	// is superseded by the new one (jobStreamIds was just updated), so the old
	// loop's supersession check will see the new streamId and break cleanly
	// ("stream superseded by [new]") rather than hitting the error path.
	// Reader.Close is safe to call on an already-closed reader.
	if prevReaderOk {
		prevReader.Close()
	}

	// The old runOutputLoop may still be appending bytes it read from the
	// previous reader right before the supersession. Wait (bounded) for it to
	// exit so those in-flight bytes land in WaveFS, then re-stat the job file and
	// adjust currentSeq if it grew. Skipping this would double-count those bytes
	// (present both in the file and in totalGap), shifting every future stream seq
	// and potentially causing "client seq beyond stream end" failures on reconnect.
	waitForStreamLoopExit(jobId, oldStreamId, 1*time.Second)

	// Post-close drain (Fix A, spec stream-gap-on-reconnect.md): bytes that
	// arrived (and were ACKed) between the pre-drain and Close(), losing the
	// Read-vs-Close race, are still in prevReader's buffer. DrainBuffered works
	// after Close. Must run before the re-stat so recovered bytes count toward
	// currentSeq.
	if prevReaderOk {
		drainJobReaderBuffer(jobId, prevReader, func(data []byte) error {
			return handleAppendJobFile(ctx, jobId, JobOutputFileName, data)
		})
	}

	waveFile2, statErr2 := filestore.WFS.Stat(ctx, jobId, JobOutputFileName)
	if statErr2 == nil {
		recomputedSeq := waveFile2.Size + totalGap
		if recomputedSeq > currentSeq {
			log.Printf("[job:%s] adjusted stream seq after draining in-flight output: %d -> %d", jobId, currentSeq, recomputedSeq)
			currentSeq = recomputedSeq
			reader.UpdateNextSeq(currentSeq)
		}
	}

	prepareData := wshrpc.CommandJobPrepareConnectData{
		StreamMeta: *streamMeta,
		Seq:        currentSeq,
		TermSize:   termSize,
	}

	rpcOpts := &wshrpc.RpcOpts{
		Route:   wshutil.MakeJobRouteId(jobId),
		Timeout: 5000,
	}

	log.Printf("[job:%s] sending JobPrepareConnectCommand with seq=%d (fileSize=%d, totalGap=%d)", jobId, currentSeq, initialFileSize, totalGap)
	rtnData, err := wshclient.JobPrepareConnectCommand(bareRpc, prepareData, rpcOpts)
	if err != nil {
		reader.Close()
		return fmt.Errorf("failed to prepare connect: %w", err)
	}

	// UX-1.7: seed drain progress from remote StreamManager snapshot
	if rtnData.DrainActive && rtnData.DrainRemainingBytes > 0 {
		log.Printf("[job:%s] drain catch-up active total=%d remaining=%d", jobId, rtnData.DrainTotalBytes, rtnData.DrainRemainingBytes)
		setJobDrainProgress(ctx, jobId, true, rtnData.DrainTotalBytes, rtnData.DrainRemainingBytes)
	} else {
		setJobDrainProgress(ctx, jobId, false, 0, 0)
	}

	if rtnData.HasExited {
		exitCodeStr := "nil"
		if rtnData.ExitCode != nil {
			exitCodeStr = fmt.Sprintf("%d", *rtnData.ExitCode)
		}
		log.Printf("[job:%s] job has already exited: code=%s signal=%q err=%q", jobId, exitCodeStr, rtnData.ExitSignal, rtnData.ExitErr)
		exitData := wshrpc.CommandJobCmdExitedData{
			ExitCode:   rtnData.ExitCode,
			ExitSignal: rtnData.ExitSignal,
			ExitErr:    rtnData.ExitErr,
			ExitTs:     time.Now().UnixMilli(),
		}
		HandleCmdJobExited(ctx, jobId, exitData)
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
		lossClass := classifyGapLoss(prevReaderOk)
		log.Printf("[job:%s] detected gap (%s): our seq=%d, server seq=%d, gap=%d, new totalGap=%d", jobId, lossClass, currentSeq, rtnData.Seq, gap, totalGap)

		metaErr := filestore.WFS.WriteMeta(ctx, jobId, JobOutputFileName, wshrpc.FileMeta{
			MetaKey_TotalGap: totalGap,
		}, true)
		if metaErr != nil {
			log.Printf("[job:%s] error updating totalgap metadata: %v", jobId, metaErr)
		}

		reader.UpdateNextSeq(rtnData.Seq)

		// Inject a terminal reset + muted gap marker into the attached block's
		// term file (display only) so the terminal parser resynchronizes instead
		// of printing partial CSI sequences ("39m", "[38;5;139m", etc.) followed
		// by garbled/duplicated output. The job output file stays a pure stream
		// of remote bytes (holes tracked by totalGap in its metadata), so the
		// marker does not shift the stream seq accounting.
		if job.AttachedBlockId != "" {
			resetTerminalState(ctx, job.AttachedBlockId)
			writeMutedMessageToTerminal(job.AttachedBlockId, fmt.Sprintf("[stream gap: %d bytes lost - terminal state reset]", gap))
		}
	} else if rtnData.Seq < currentSeq {
		// Client's term file ran ahead of the server stream (phantom bytes from a
		// seq-tracking drift). Reconcile to the server's authoritative end.
		origSeq := currentSeq
		newSeq, newTotalGap, needsTruncate := reconcileClientAheadSeq(currentSeq, totalGap, rtnData.Seq)
		if needsTruncate {
			if terr := truncateJobFile(ctx, jobId, newSeq); terr != nil {
				log.Printf("[job:%s] error truncating term file to %d: %v", jobId, newSeq, terr)
			}
		}
		totalGap = newTotalGap
		currentSeq = newSeq
		reader.UpdateNextSeq(currentSeq)
		metaErr := filestore.WFS.WriteMeta(ctx, jobId, JobOutputFileName, wshrpc.FileMeta{
			MetaKey_TotalGap: totalGap,
		}, true)
		if metaErr != nil {
			log.Printf("[job:%s] error updating totalgap metadata: %v", jobId, metaErr)
		}
		log.Printf("[job:%s] client seq was ahead of server (client=%d server=%d), reconciled to seq=%d totalGap=%d", jobId, origSeq, rtnData.Seq, currentSeq, totalGap)
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

	// 2.5. Durable shells require wsh's connserver route. If wsh is disabled,
	// fall back to non-durable ShellController which works without wsh.
	if connName != "" {
		if opts, err := remote.ParseOpts(connName); err == nil {
			if sshConn := conncontroller.MaybeGetConn(opts); sshConn != nil {
				if !sshConn.WshEnabled.Load() {
					return false
				}
			}
		}
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

func writeJobTerminationMessage(ctx context.Context, jobId string, job *waveobj.Job, msg string) {
	if job == nil {
		return
	}
	shouldWrite := jobTerminationMessageWritten.TestAndSet(jobId, true, func(val bool, exists bool) bool {
		return !exists || !val
	})
	if shouldWrite {
		resetTerminalState(ctx, job.AttachedBlockId)
		writeMutedMessageToTerminal(job.AttachedBlockId, msg)
	}
}
