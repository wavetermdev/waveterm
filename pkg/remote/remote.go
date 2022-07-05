package remote

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const RemoteTypeMShell = "mshell"

const (
	StatusInit         = "init"
	StatusConnecting   = "connecting"
	StatusConnected    = "connected"
	StatusDisconnected = "disconnected"
	StatusError        = "error"
)

var GlobalStore *Store

type Store struct {
	Lock *sync.Mutex
	Map  map[string]*MShellProc // key=remoteid
}

type RemoteState struct {
	RemoteType   string              `json:"remotetype"`
	RemoteId     string              `json:"remoteid"`
	RemoteName   string              `json:"remotename"`
	Status       string              `json:"status"`
	DefaultState *sstore.RemoteState `json:"defaultstate"`
}

type MShellProc struct {
	Lock   *sync.Mutex
	Remote *sstore.RemoteType

	// runtime
	Status string
	InitPk *packet.InitPacketType
	Cmd    *exec.Cmd
	Input  *packet.PacketSender
	Output *packet.PacketParser
	DoneCh chan bool
	RpcMap map[string]*RpcEntry

	Err error
}

type RpcEntry struct {
	ReqId  string
	RespCh chan packet.RpcResponsePacketType
}

func LoadRemotes(ctx context.Context) error {
	GlobalStore = &Store{
		Lock: &sync.Mutex{},
		Map:  make(map[string]*MShellProc),
	}
	allRemotes, err := sstore.GetAllRemotes(ctx)
	if err != nil {
		return err
	}
	for _, remote := range allRemotes {
		msh := MakeMShell(remote)
		GlobalStore.Map[remote.RemoteId] = msh
		if remote.AutoConnect {
			go msh.Launch()
		}
	}
	return nil
}

func GetRemoteByName(name string) *MShellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	for _, msh := range GlobalStore.Map {
		if msh.Remote.RemoteName == name {
			return msh
		}
	}
	return nil
}

func GetRemoteById(remoteId string) *MShellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	return GlobalStore.Map[remoteId]
}

func GetAllRemoteState() []RemoteState {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	var rtn []RemoteState
	for _, proc := range GlobalStore.Map {
		state := RemoteState{
			RemoteType: proc.Remote.RemoteType,
			RemoteId:   proc.Remote.RemoteId,
			RemoteName: proc.Remote.RemoteName,
			Status:     proc.Status,
		}
		if proc.InitPk != nil {
			state.DefaultState = &sstore.RemoteState{Cwd: proc.InitPk.HomeDir}
		}
		rtn = append(rtn, state)
	}
	return rtn
}

func MakeMShell(r *sstore.RemoteType) *MShellProc {
	rtn := &MShellProc{Lock: &sync.Mutex{}, Remote: r, Status: StatusInit}
	return rtn
}

func (msh *MShellProc) Launch() {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()

	msPath, err := base.GetMShellPath()
	if err != nil {
		msh.Status = StatusError
		msh.Err = err
		return
	}
	ecmd := exec.Command(msPath, "--server")
	msh.Cmd = ecmd
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		msh.Status = StatusError
		msh.Err = fmt.Errorf("create stdin pipe: %w", err)
		return
	}
	stdoutReader, err := ecmd.StdoutPipe()
	if err != nil {
		msh.Status = StatusError
		msh.Err = fmt.Errorf("create stdout pipe: %w", err)
		return
	}
	stderrReader, err := ecmd.StderrPipe()
	if err != nil {
		msh.Status = StatusError
		msh.Err = fmt.Errorf("create stderr pipe: %w", err)
		return
	}
	go func() {
		io.Copy(os.Stderr, stderrReader)
	}()
	err = ecmd.Start()
	if err != nil {
		msh.Status = StatusError
		msh.Err = fmt.Errorf("starting mshell server: %w", err)
		return
	}
	fmt.Printf("Started remote '%s' pid=%d\n", msh.Remote.RemoteName, msh.Cmd.Process.Pid)
	msh.Status = StatusConnecting
	msh.Output = packet.MakePacketParser(stdoutReader)
	msh.Input = packet.MakePacketSender(inputWriter)
	msh.RpcMap = make(map[string]*RpcEntry)
	msh.DoneCh = make(chan bool)
	go func() {
		exitErr := ecmd.Wait()
		exitCode := shexec.GetExitCode(exitErr)
		msh.WithLock(func() {
			if msh.Status == StatusConnected || msh.Status == StatusConnecting {
				msh.Status = StatusDisconnected
			}
		})
		fmt.Printf("[error] RUNNER PROC EXITED code[%d]\n", exitCode)
		close(msh.DoneCh)
	}()
	go msh.ProcessPackets()
	return
}

func (msh *MShellProc) IsConnected() bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Status == StatusConnected
}

func RunCommand(pk *scpacket.FeCommandPacketType, cmdId string) error {
	msh := GetRemoteById(pk.RemoteState.RemoteId)
	if msh == nil {
		return fmt.Errorf("no remote id=%s found", pk.RemoteState.RemoteId)
	}
	if !msh.IsConnected() {
		return fmt.Errorf("remote '%s' is not connected", msh.Remote.RemoteName)
	}
	runPacket := packet.MakeRunPacket()
	runPacket.CK = base.MakeCommandKey(pk.SessionId, cmdId)
	runPacket.Cwd = pk.RemoteState.Cwd
	runPacket.Env = nil
	runPacket.Command = strings.TrimSpace(pk.CmdStr)
	fmt.Printf("run-packet %v\n", runPacket)
	go func() {
		msh.Input.SendPacket(runPacket)
	}()
	return nil
}

func (runner *MShellProc) PacketRpc(pk packet.RpcPacketType, timeout time.Duration) (packet.RpcResponsePacketType, error) {
	if !runner.IsConnected() {
		return nil, fmt.Errorf("runner is not connected")
	}
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	id := pk.GetReqId()
	respCh := make(chan packet.RpcResponsePacketType)
	runner.WithLock(func() {
		runner.RpcMap[id] = &RpcEntry{ReqId: id, RespCh: respCh}
	})
	defer runner.WithLock(func() {
		delete(runner.RpcMap, id)
	})
	runner.Input.SendPacket(pk)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case rtnPk := <-respCh:
		return rtnPk, nil

	case <-timer.C:
		return nil, fmt.Errorf("PacketRpc timeout")
	}
}

func (runner *MShellProc) WithLock(fn func()) {
	runner.Lock.Lock()
	defer runner.Lock.Unlock()
	fn()
}

func (runner *MShellProc) ProcessPackets() {
	defer runner.WithLock(func() {
		if runner.Status == StatusConnected || runner.Status == StatusConnecting {
			runner.Status = StatusDisconnected
		}
	})
	for pk := range runner.Output.MainCh {
		fmt.Printf("MSH> %s\n", packet.AsString(pk))
		if rpcPk, ok := pk.(packet.RpcResponsePacketType); ok {
			rpcId := rpcPk.GetResponseId()
			runner.WithLock(func() {
				entry := runner.RpcMap[rpcId]
				if entry == nil {
					return
				}
				delete(runner.RpcMap, rpcId)
				go func() {
					entry.RespCh <- rpcPk
					close(entry.RespCh)
				}()
			})
		}
		if pk.GetType() == packet.CmdDataPacketStr {
			dataPacket := pk.(*packet.CmdDataPacketType)
			fmt.Printf("cmd-data %s pty=%d run=%d\n", dataPacket.CK, len(dataPacket.PtyData), len(dataPacket.RunData))
			continue
		}
		if pk.GetType() == packet.InitPacketStr {
			initPacket := pk.(*packet.InitPacketType)
			fmt.Printf("runner-init %s user=%s dir=%s\n", initPacket.MShellHomeDir, initPacket.User, initPacket.HomeDir)
			runner.WithLock(func() {
				runner.InitPk = initPacket
				runner.Status = StatusConnected
			})
			continue
		}
		if pk.GetType() == packet.MessagePacketStr {
			msgPacket := pk.(*packet.MessagePacketType)
			fmt.Printf("# %s\n", msgPacket.Message)
			continue
		}
		if pk.GetType() == packet.RawPacketStr {
			rawPacket := pk.(*packet.RawPacketType)
			fmt.Printf("stderr> %s\n", rawPacket.Data)
			continue
		}
		fmt.Printf("runner-packet: %v\n", pk)
	}
}
