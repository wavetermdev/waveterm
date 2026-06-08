package sessiondaemon

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	DefaultAnonymousIdleTimeout = 3600    // 1h
	DefaultNamedIdleTimeout     = 86400   // 24h
	IdleCheckInterval           = 60      // 检查间隔（秒）
)

type SessionDaemon struct {
	Lock sync.Mutex

	DaemonId       string
	Name           string
	JobId          string
	InputSessionId string
	SeqNum         int
	Blocks         map[string]bool
}

type SessionDaemonManager struct {
	Lock    sync.Mutex
	Daemons map[string]*SessionDaemon
}

var Manager = &SessionDaemonManager{
	Daemons: make(map[string]*SessionDaemon),
}

func (sd *SessionDaemon) GetNextInputSeq() (string, int) {
	sd.Lock.Lock()
	defer sd.Lock.Unlock()
	sd.SeqNum++
	return sd.InputSessionId, sd.SeqNum
}

func (sd *SessionDaemon) HasAttachedBlocks() bool {
	sd.Lock.Lock()
	defer sd.Lock.Unlock()
	return len(sd.Blocks) > 0
}

func (sd *SessionDaemon) HasBlock(blockId string) bool {
	sd.Lock.Lock()
	defer sd.Lock.Unlock()
	return sd.Blocks[blockId]
}

func (sd *SessionDaemon) SetJobId(ctx context.Context, dbDaemon *waveobj.SessionDaemon, jobId string) error {
	sd.Lock.Lock()
	sd.JobId = jobId
	sd.Lock.Unlock()

	err := wstore.DBUpdateFn(ctx, dbDaemon.OID, func(sdDb *waveobj.SessionDaemon) {
		sdDb.JobId = jobId
		sdDb.Status = "running"
	})
	if err != nil {
		log.Printf("[sessiondaemon:%s] warning: failed to update jobid in db: %v", sd.DaemonId, err)
	}
	return nil
}

func (sd *SessionDaemon) Reconnect(ctx context.Context, dbDaemon *waveobj.SessionDaemon, rtOpts *waveobj.RuntimeOpts) error {
	if dbDaemon.JobId == "" {
		return fmt.Errorf("no jobid to reconnect")
	}
	sd.Lock.Lock()
	sd.JobId = dbDaemon.JobId
	sd.Lock.Unlock()
	return jobcontroller.ReconnectJob(ctx, dbDaemon.JobId, rtOpts)
}

func (sd *SessionDaemon) Stop(ctx context.Context) {
	sd.Lock.Lock()
	jobId := sd.JobId
	sd.Lock.Unlock()
	if jobId != "" {
		jobcontroller.TerminateAndDetachJob(ctx, jobId)
	}
}

func (sd *SessionDaemon) SendInput(ctx context.Context, inputData []byte, sigName string, termSize *waveobj.TermSize) error {
	sd.Lock.Lock()
	jobId := sd.JobId
	if jobId == "" {
		sd.Lock.Unlock()
		return fmt.Errorf("no job attached")
	}
	inputSessionId, seqNum := sd.InputSessionId, sd.SeqNum
	sd.SeqNum++
	sd.Lock.Unlock()

	data := wshrpc.CommandJobInputData{
		JobId:          jobId,
		InputSessionId: inputSessionId,
		SeqNum:         seqNum,
		TermSize:       termSize,
		SigName:        sigName,
	}
	if len(inputData) > 0 {
		data.InputData64 = base64.StdEncoding.EncodeToString(inputData)
	}
	return jobcontroller.SendInput(ctx, data)
}

func (sd *SessionDaemonManager) GetOrCreate(ctx context.Context, dbDaemon *waveobj.SessionDaemon) (*SessionDaemon, error) {
	sd.Lock.Lock()
	defer sd.Lock.Unlock()

	if existing, ok := sd.Daemons[dbDaemon.OID]; ok {
		existing.Lock.Lock()
		if existing.JobId == "" {
			existing.JobId = dbDaemon.JobId
		}
		existing.Lock.Unlock()
		return existing, nil
	}

	daemon := &SessionDaemon{
		DaemonId:       dbDaemon.OID,
		Name:           dbDaemon.Name,
		JobId:          dbDaemon.JobId,
		InputSessionId: uuid.New().String(),
		Blocks:         make(map[string]bool),
	}
	sd.Daemons[dbDaemon.OID] = daemon
	return daemon, nil
}

func (sd *SessionDaemonManager) Get(daemonId string) *SessionDaemon {
	sd.Lock.Lock()
	defer sd.Lock.Unlock()
	return sd.Daemons[daemonId]
}

func (sd *SessionDaemonManager) Remove(daemonId string) {
	sd.Lock.Lock()
	defer sd.Lock.Unlock()
	delete(sd.Daemons, daemonId)
}

func (sd *SessionDaemonManager) AttachBlock(ctx context.Context, daemonId string, blockId string) {
	sd.Lock.Lock()
	daemon, ok := sd.Daemons[daemonId]
	if !ok {
		sd.Lock.Unlock()
		return
	}
	daemon.Lock.Lock()
	sd.Lock.Unlock()
	defer daemon.Lock.Unlock()
	daemon.Blocks[blockId] = true
	wstore.DBUpdateFn(ctx, daemonId, func(dbD *waveobj.SessionDaemon) {
		dbD.IdleSince = 0
	})
}

func (sd *SessionDaemonManager) DetachBlock(ctx context.Context, daemonId string, blockId string) {
	sd.Lock.Lock()
	daemon, ok := sd.Daemons[daemonId]
	if !ok {
		sd.Lock.Unlock()
		return
	}
	daemon.Lock.Lock()
	sd.Lock.Unlock()
	defer daemon.Lock.Unlock()
	delete(daemon.Blocks, blockId)
	if len(daemon.Blocks) == 0 {
		wstore.DBUpdateFn(ctx, daemonId, func(dbD *waveobj.SessionDaemon) {
			dbD.IdleSince = time.Now().UnixMilli()
		})
	}
}

func (sd *SessionDaemonManager) GetBlocksForDaemon(daemonId string) []string {
	sd.Lock.Lock()
	daemon, ok := sd.Daemons[daemonId]
	if !ok {
		sd.Lock.Unlock()
		return nil
	}
	daemon.Lock.Lock()
	sd.Lock.Unlock()
	defer daemon.Lock.Unlock()
	var rtn []string
	for blockId := range daemon.Blocks {
		rtn = append(rtn, blockId)
	}
	return rtn
}

func (sd *SessionDaemonManager) SendInput(daemonId string, inputData []byte, sigName string, termSize *waveobj.TermSize) error {
	ctx := context.Background()
	sd.Lock.Lock()
	daemon, ok := sd.Daemons[daemonId]
	sd.Lock.Unlock()
	if !ok {
		return fmt.Errorf("daemon %s not found", daemonId)
	}
	return daemon.SendInput(ctx, inputData, sigName, termSize)
}

func (sd *SessionDaemonManager) InitFromDB(ctx context.Context) error {
	daemons, err := wstore.DBGetAllObjsByType[*waveobj.SessionDaemon](ctx, waveobj.OType_SessionDaemon)
	if err != nil {
		return fmt.Errorf("load session daemons: %w", err)
	}

	for _, dbDaemon := range daemons {
		if dbDaemon.Status == "running" || dbDaemon.Status == "disconnected" {
			daemon, err := sd.GetOrCreate(ctx, dbDaemon)
			if err != nil {
				log.Printf("[sessiondaemon] warning: failed to load daemon %s: %v", dbDaemon.OID, err)
				continue
			}
			err = daemon.Reconnect(ctx, dbDaemon, nil)
			if err != nil {
				log.Printf("[sessiondaemon:%s] reconnect failed: %v", dbDaemon.OID, err)
			}
		}
	}
	return nil
}

func (sd *SessionDaemonManager) StartIdleReaper(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(IdleCheckInterval * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sd.reapIdleDaemons(ctx)
			}
		}
	}()
}

func (sd *SessionDaemonManager) reapIdleDaemons(ctx context.Context) {
	allDaemons, err := wstore.DBGetAllObjsByType[*waveobj.SessionDaemon](ctx, waveobj.OType_SessionDaemon)
	if err != nil {
		return
	}

	for _, dbDaemon := range allDaemons {
		if dbDaemon.Status != "running" {
			continue
		}

		sd.Lock.Lock()
		memDaemon, hasMem := sd.Daemons[dbDaemon.OID]
		sd.Lock.Unlock()

		if hasMem && memDaemon.HasAttachedBlocks() {
			continue
		}

		if dbDaemon.IdleTimeout <= 0 || dbDaemon.IdleSince == 0 {
			continue
		}

		if time.Since(time.UnixMilli(dbDaemon.IdleSince)) > time.Duration(dbDaemon.IdleTimeout)*time.Second {
			log.Printf("[sessiondaemon:%s] idle timeout reached, terminating", dbDaemon.OID)
			if hasMem {
				memDaemon.Stop(ctx)
				sd.Remove(dbDaemon.OID)
			}
			wstore.DBUpdateFn(ctx, dbDaemon.OID, func(sdDb *waveobj.SessionDaemon) {
				sdDb.Status = "done"
			})
		}
	}
}
