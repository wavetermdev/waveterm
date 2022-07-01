package remote

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
)

const RemoteTypeMShell = "mshell"

type MShellProc struct {
	Lock       *sync.Mutex
	RemoteId   string
	WindowId   string
	RemoteName string
	Cmd        *exec.Cmd
	Input      *packet.PacketSender
	Output     *packet.PacketParser
	Local      bool
	DoneCh     chan bool
	CurDir     string
	HomeDir    string
	User       string
	Host       string
	Env        []string
	Connected  bool
	RpcMap     map[string]*RpcEntry
}

type RpcEntry struct {
	PacketId string
	RespCh   chan packet.RpcPacketType
}

func LaunchMShell() (*MShellProc, error) {
	msPath, err := base.GetMShellPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(msPath)
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	outputReader, err := ecmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	ecmd.Stderr = ecmd.Stdout
	err = ecmd.Start()
	if err != nil {
		return nil, err
	}
	rtn := &MShellProc{Lock: &sync.Mutex{}, Local: true, Cmd: ecmd}
	rtn.Output = packet.MakePacketParser(outputReader)
	rtn.Input = packet.MakePacketSender(inputWriter)
	rtn.RpcMap = make(map[string]*RpcEntry)
	rtn.DoneCh = make(chan bool)
	go func() {
		exitErr := ecmd.Wait()
		exitCode := shexec.GetExitCode(exitErr)
		fmt.Printf("[error] RUNNER PROC EXITED code[%d]\n", exitCode)
		close(rtn.DoneCh)
	}()
	return rtn, nil
}

func (runner *MShellProc) PacketRpc(pk packet.RpcPacketType, timeout time.Duration) (packet.RpcPacketType, error) {
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	id := pk.GetPacketId()
	respCh := make(chan packet.RpcPacketType)
	runner.Lock.Lock()
	runner.RpcMap[id] = &RpcEntry{PacketId: id, RespCh: respCh}
	runner.Lock.Unlock()
	defer func() {
		runner.Lock.Lock()
		delete(runner.RpcMap, id)
		runner.Lock.Unlock()
	}()
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

func (runner *MShellProc) ProcessPackets() {
	for pk := range runner.Output.MainCh {
		if rpcPk, ok := pk.(packet.RpcPacketType); ok {
			rpcId := rpcPk.GetPacketId()
			runner.Lock.Lock()
			entry := runner.RpcMap[rpcId]
			if entry != nil {
				delete(runner.RpcMap, rpcId)
				go func() {
					entry.RespCh <- rpcPk
					close(entry.RespCh)
				}()
			}
			runner.Lock.Unlock()

		}
		if pk.GetType() == packet.CmdDataPacketStr {
			dataPacket := pk.(*packet.CmdDataPacketType)
			fmt.Printf("cmd-data %s pty=%d run=%d\n", dataPacket.CK, len(dataPacket.PtyData), len(dataPacket.RunData))
			continue
		}
		if pk.GetType() == packet.InitPacketStr {
			initPacket := pk.(*packet.InitPacketType)
			fmt.Printf("runner-init %s user=%s dir=%s\n", initPacket.MShellHomeDir, initPacket.User, initPacket.HomeDir)
			runner.Lock.Lock()
			runner.Connected = true
			runner.User = initPacket.User
			runner.CurDir = initPacket.HomeDir
			runner.HomeDir = initPacket.HomeDir
			runner.Env = initPacket.Env
			if runner.Local {
				runner.Host = "local"
			}
			runner.Lock.Unlock()
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

func (r *MShellProc) GetPrompt() string {
	r.Lock.Lock()
	defer r.Lock.Unlock()
	var curDir = r.CurDir
	if r.CurDir == r.HomeDir {
		curDir = "~"
	} else if strings.HasPrefix(r.CurDir, r.HomeDir+"/") {
		curDir = "~/" + r.CurDir[0:len(r.HomeDir)+1]
	}
	return fmt.Sprintf("[%s@%s %s]", r.User, r.Host, curDir)
}
