package blockcontroller

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/sessiondaemon"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type SessionDaemonController struct {
	Lock *sync.Mutex

	BlockId        string
	ConnName       string
	DaemonId       string
	TabId          string
	InputSessionId string
	inputSeqNum    int
	versionTs      int64
}

func MakeSessionDaemonController(tabId string, blockId string, connName string) *SessionDaemonController {
	return &SessionDaemonController{
		Lock:           &sync.Mutex{},
		BlockId:        blockId,
		ConnName:       connName,
		TabId:          tabId,
		InputSessionId: uuid.New().String(),
		versionTs:      1,
	}
}

func (sdc *SessionDaemonController) WithLock(f func()) {
	sdc.Lock.Lock()
	defer sdc.Lock.Unlock()
	f()
}

func (sdc *SessionDaemonController) getNextInputSeq() (string, int) {
	sdc.Lock.Lock()
	defer sdc.Lock.Unlock()
	sdc.inputSeqNum++
	return sdc.InputSessionId, sdc.inputSeqNum
}

func (sdc *SessionDaemonController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	daemon := sessiondaemon.Manager.Get(sdc.DaemonId)
	if daemon == nil {
		return fmt.Errorf("session daemon %s not found in manager", sdc.DaemonId)
	}

	sessiondaemon.Manager.AttachBlock(ctx, sdc.DaemonId, sdc.BlockId)

	dbDaemon, err := wstore.DBMustGet[*waveobj.SessionDaemon](ctx, sdc.DaemonId)
	if err != nil {
		return fmt.Errorf("error getting session daemon: %w", err)
	}

	if dbDaemon.JobId != "" {
		status, err := jobcontroller.GetJobManagerStatus(ctx, dbDaemon.JobId)
		if err == nil && status == jobcontroller.JobManagerStatus_Running {
			sdc.WithLock(func() {
				sdc.incrementVersion()
				sdc.sendControllerStatus()
			})
			return nil
		}
	}

	// Terminate old job if it exists (crashed or network issue)
	if dbDaemon.JobId != "" {
		jobcontroller.TerminateAndDetachJob(ctx, dbDaemon.JobId)
	}

	fsErr := filestore.WFS.MakeFile(ctx, sdc.BlockId, wavebase.BlockFile_Term, nil, wshrpc.FileOpts{MaxSize: DefaultTermMaxFileSize, Circular: true})
	if fsErr != nil && fsErr != fs.ErrExist {
		return fmt.Errorf("error creating block term file: %w", fsErr)
	}

	jobId, err := sdc.startNewJob(ctx, blockMeta, rtOpts)
	if err != nil {
		return fmt.Errorf("failed to start job: %w", err)
	}

	err = daemon.SetJobId(ctx, dbDaemon, jobId)
	if err != nil {
		return fmt.Errorf("failed to set job id on daemon: %w", err)
	}

	sdc.WithLock(func() {
		sdc.incrementVersion()
		sdc.sendControllerStatus()
	})
	return nil
}

func (sdc *SessionDaemonController) startNewJob(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts) (string, error) {
	termSize := waveobj.TermSize{
		Rows: shellutil.DefaultTermRows,
		Cols: shellutil.DefaultTermCols,
	}
	if rtOpts != nil && rtOpts.TermSize.Rows > 0 && rtOpts.TermSize.Cols > 0 {
		termSize = rtOpts.TermSize
	}
	cmdStr := blockMeta.GetString(waveobj.MetaKey_Cmd, "")
	cwd := blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
	opts, err := remote.ParseOpts(sdc.ConnName)
	if err != nil {
		return "", fmt.Errorf("invalid ssh remote name (%s): %w", sdc.ConnName, err)
	}
	conn := conncontroller.MaybeGetConn(opts)
	if conn == nil {
		return "", fmt.Errorf("connection %q not found", sdc.ConnName)
	}
	connRoute := wshutil.MakeConnectionRouteId(sdc.ConnName)
	remoteInfo, err := wshclient.RemoteGetInfoCommand(wshclient.GetBareRpcClient(), &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		return "", fmt.Errorf("unable to obtain remote info from connserver: %w", err)
	}
	shellType := shellutil.GetShellTypeFromShellPath(remoteInfo.Shell)
	swapToken := makeSwapToken(ctx, ctx, sdc.BlockId, blockMeta, sdc.ConnName, shellType)
	sockName := wavebase.GetPersistentRemoteSockName(wstore.GetClientId())
	rpcContext := wshrpc.RpcContext{
		ProcRoute: true,
		SockName:  sockName,
		BlockId:   sdc.BlockId,
		Conn:      sdc.ConnName,
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
	jobId, err := shellexec.StartRemoteShellJob(ctx, ctx, termSize, cmdStr, cmdOpts, conn, sdc.BlockId)
	if err != nil {
		return "", fmt.Errorf("failed to start remote shell job: %w", err)
	}
	return jobId, nil
}

func (sdc *SessionDaemonController) Stop(graceful bool, newStatus string, destroy bool) {
	if !destroy {
		return
	}
	ctx := context.Background()
	sessiondaemon.Manager.DetachBlock(ctx, sdc.DaemonId, sdc.BlockId)
	dbDaemon, err := wstore.DBMustGet[*waveobj.SessionDaemon](ctx, sdc.DaemonId)
	if err != nil {
		return
	}
	if dbDaemon.IsAnonymous && len(sessiondaemon.Manager.GetBlocksForDaemon(sdc.DaemonId)) == 0 {
		daemon := sessiondaemon.Manager.Get(sdc.DaemonId)
		if daemon != nil {
			daemon.Stop(ctx)
		}
		sessiondaemon.Manager.Remove(sdc.DaemonId)
		wstore.DBUpdateFn(ctx, sdc.DaemonId, func(sd *waveobj.SessionDaemon) {
			sd.Status = "done"
		})
	}
}

func (sdc *SessionDaemonController) SendInput(inputUnion *BlockInputUnion) error {
	if inputUnion == nil {
		return nil
	}
	daemon := sessiondaemon.Manager.Get(sdc.DaemonId)
	if daemon == nil {
		return fmt.Errorf("session daemon %s not found", sdc.DaemonId)
	}
	return daemon.SendInput(context.Background(), inputUnion.InputData, inputUnion.SigName, inputUnion.TermSize)
}

func (sdc *SessionDaemonController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	sdc.WithLock(func() {
		rtn.BlockId = sdc.BlockId
		rtn.ShellProcConnName = sdc.ConnName
		rtn.Version = sdc.versionTs
		daemon := sessiondaemon.Manager.Get(sdc.DaemonId)
		if daemon != nil {
			if daemon.JobId == "" {
				rtn.ShellProcStatus = "init"
			} else {
				rtn.ShellProcStatus = "running"
			}
		} else {
			rtn.ShellProcStatus = "done"
		}
	})
	return &rtn
}

func (sdc *SessionDaemonController) incrementVersion() {
	sdc.Lock.Lock()
	defer sdc.Lock.Unlock()
	sdc.versionTs++
}

func (sdc *SessionDaemonController) GetConnName() string {
	return sdc.ConnName
}

func (sdc *SessionDaemonController) sendControllerStatus() {
	rtStatus := sdc.GetRuntimeStatus()
	log.Printf("sending blockcontroller update %#v\n", rtStatus)
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_ControllerStatus,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Tab, sdc.TabId).String(),
			waveobj.MakeORef(waveobj.OType_Block, sdc.BlockId).String(),
		},
		Data: rtStatus,
	})
}

func autoCreateSessionDaemon(ctx context.Context, blockId string, blockMeta waveobj.MetaMapType, connName string, rtOpts *waveobj.RuntimeOpts) (string, error) {
	dbDaemon := &waveobj.SessionDaemon{
		OID:         uuid.New().String(),
		Name:        "",
		Connection:  connName,
		IsAnonymous: true,
		Status:      "init",
		CreatedAt:   time.Now().UnixMilli(),
		IdleTimeout: sessiondaemon.DefaultAnonymousIdleTimeout,
	}

	err := wstore.DBInsert(ctx, dbDaemon)
	if err != nil {
		return "", fmt.Errorf("insert session daemon: %w", err)
	}

	err = wstore.DBUpdateFn(ctx, blockId, func(block *waveobj.Block) {
		block.Meta[waveobj.MetaKey_SessionDaemonId] = dbDaemon.OID
	})
	if err != nil {
		return "", fmt.Errorf("update block meta: %w", err)
	}

	_, err = sessiondaemon.Manager.GetOrCreate(ctx, dbDaemon)
	if err != nil {
		return "", fmt.Errorf("create session daemon in manager: %w", err)
	}

	return dbDaemon.OID, nil
}
