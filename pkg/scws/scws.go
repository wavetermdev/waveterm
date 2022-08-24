package scws

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

const WSStatePacketChSize = 20
const MaxInputDataSize = 1000

type WSState struct {
	Lock        *sync.Mutex
	ClientId    string
	ConnectTime time.Time
	Shell       *wsshell.WSShell
	UpdateCh    chan interface{}
	UpdateQueue []interface{}

	SessionId string
	ScreenId  string
}

func MakeWSState(clientId string) *WSState {
	rtn := &WSState{}
	rtn.Lock = &sync.Mutex{}
	rtn.ClientId = clientId
	rtn.ConnectTime = time.Now()
	return rtn
}

func (ws *WSState) GetShell() *wsshell.WSShell {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.Shell
}

func (ws *WSState) WriteUpdate(update interface{}) error {
	shell := ws.GetShell()
	if shell == nil {
		return fmt.Errorf("cannot write update, empty shell")
	}
	err := shell.WriteJson(update)
	if err != nil {
		return err
	}
	return nil
}

func (ws *WSState) UpdateConnectTime() {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	ws.ConnectTime = time.Now()
}

func (ws *WSState) GetConnectTime() time.Time {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.ConnectTime
}

func (ws *WSState) WatchScreen(sessionId string, screenId string) {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	if ws.SessionId == sessionId && ws.ScreenId == screenId {
		return
	}
	ws.SessionId = sessionId
	ws.ScreenId = screenId
	ws.UpdateCh = sstore.MainBus.RegisterChannel(ws.ClientId, ws.SessionId)
	go ws.RunUpdates()
}

func (ws *WSState) UnWatchScreen() {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	sstore.MainBus.UnregisterChannel(ws.ClientId)
	ws.SessionId = ""
	ws.ScreenId = ""
}

func (ws *WSState) getUpdateCh() chan interface{} {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.UpdateCh
}

func (ws *WSState) RunUpdates() {
	updateCh := ws.getUpdateCh()
	if updateCh == nil {
		return
	}
	for update := range updateCh {
		shell := ws.GetShell()
		if shell != nil {
			shell.WriteJson(update)
		}
	}
}

func (ws *WSState) ReplaceShell(shell *wsshell.WSShell) {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	if ws.Shell == nil {
		ws.Shell = shell
		return
	}
	ws.Shell.Conn.Close()
	ws.Shell = shell
	return
}

func (ws *WSState) RunWSRead() {
	shell := ws.GetShell()
	if shell == nil {
		return
	}
	for msgBytes := range shell.ReadChan {
		pk, err := packet.ParseJsonPacket(msgBytes)
		if err != nil {
			fmt.Printf("error unmarshalling ws message: %v\n", err)
			continue
		}
		if pk.GetType() == "feinput" {
			feInputPk := pk.(*scpacket.FeInputPacketType)
			if feInputPk.Remote.OwnerId != "" {
				fmt.Printf("[error] cannot send input to remote with ownerid\n")
				continue
			}
			if feInputPk.Remote.RemoteId == "" {
				fmt.Printf("[error] invalid input packet, remoteid is not set\n")
				continue
			}
			inputPk := feInputPk.ConvertToInputPacket()
			go func() {
				err = sendCmdInput(inputPk)
				if err != nil {
					fmt.Printf("[error] sending command input: %v\n", err)
				}
			}()
			continue
		}
		if pk.GetType() == "watchscreen" {
			wsPk := pk.(*scpacket.WatchScreenPacketType)
			if _, err := uuid.Parse(wsPk.SessionId); err != nil {
				fmt.Printf("[error] invalid watchscreen sessionid: %v\n", err)
				continue
			}
			if wsPk.ScreenId == "" {
				ws.UnWatchScreen()
				continue
			}
			if _, err := uuid.Parse(wsPk.ScreenId); err != nil {
				fmt.Printf("[error] invalid watchscreen screenid: %v\n", err)
				continue
			}
			ws.WatchScreen(wsPk.SessionId, wsPk.ScreenId)
			fmt.Printf("[ws] watch screen clientid=%s %s/%s\n", ws.ClientId, wsPk.SessionId, wsPk.ScreenId)
			continue
		}
		fmt.Printf("got ws bad message: %v\n", pk.GetType())
	}
}

func sendCmdInput(pk *packet.InputPacketType) error {
	err := pk.CK.Validate("input packet")
	if err != nil {
		return err
	}
	if pk.RemoteId == "" {
		return fmt.Errorf("input must set remoteid")
	}
	if len(pk.InputData64) == 0 && pk.SigNum == 0 {
		return fmt.Errorf("empty input packet")
	}
	inputLen := packet.B64DecodedLen(pk.InputData64)
	if inputLen > MaxInputDataSize {
		return fmt.Errorf("input data size too large, len=%d (max=%d)", inputLen, MaxInputDataSize)
	}
	msh := remote.GetRemoteById(pk.RemoteId)
	if msh == nil {
		return fmt.Errorf("cannot connect to remote")
	}
	return msh.SendInput(pk)
}
