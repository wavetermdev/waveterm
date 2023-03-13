package scws

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/mapqueue"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

const WSStatePacketChSize = 20
const MaxInputDataSize = 1000
const RemoteInputQueueSize = 100

var RemoteInputMapQueue *mapqueue.MapQueue

func init() {
	RemoteInputMapQueue = mapqueue.MakeMapQueue(RemoteInputQueueSize)
}

type WSState struct {
	Lock          *sync.Mutex
	ClientId      string
	ConnectTime   time.Time
	Shell         *wsshell.WSShell
	UpdateCh      chan interface{}
	UpdateQueue   []interface{}
	Authenticated bool
	AuthKey       string

	SessionId string
	ScreenId  string
}

func MakeWSState(clientId string, authKey string) *WSState {
	rtn := &WSState{}
	rtn.Lock = &sync.Mutex{}
	rtn.ClientId = clientId
	rtn.ConnectTime = time.Now()
	rtn.AuthKey = authKey
	return rtn
}

func (ws *WSState) SetAuthenticated(authVal bool) {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	ws.Authenticated = authVal
}

func (ws *WSState) IsAuthenticated() bool {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.Authenticated
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
	go ws.RunUpdates(ws.UpdateCh)
}

func (ws *WSState) UnWatchScreen() {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	sstore.MainBus.UnregisterChannel(ws.ClientId)
	ws.SessionId = ""
	ws.ScreenId = ""
	log.Printf("[ws] unwatch screen clientid=%s\n", ws.ClientId)
}

func (ws *WSState) getUpdateCh() chan interface{} {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.UpdateCh
}

func (ws *WSState) RunUpdates(updateCh chan interface{}) {
	if updateCh == nil {
		panic("invalid nil updateCh passed to RunUpdates")
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

func (ws *WSState) handleConnection() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	update, err := sstore.GetAllSessions(ctx)
	if err != nil {
		return fmt.Errorf("getting sessions: %w", err)
	}
	remotes := remote.GetAllRemoteRuntimeState()
	ifarr := make([]interface{}, len(remotes))
	for idx, r := range remotes {
		ifarr[idx] = r
	}
	update.Remotes = ifarr
	update.Connect = true
	err = ws.Shell.WriteJson(update)
	if err != nil {
		return err
	}
	return nil
}

func (ws *WSState) handleWatchScreen(wsPk *scpacket.WatchScreenPacketType) error {
	if wsPk.SessionId != "" {
		if _, err := uuid.Parse(wsPk.SessionId); err != nil {
			return fmt.Errorf("invalid watchscreen sessionid: %w", err)
		}
	}
	if wsPk.ScreenId != "" {
		if _, err := uuid.Parse(wsPk.ScreenId); err != nil {
			return fmt.Errorf("invalid watchscreen screenid: %w", err)
		}
	}
	if wsPk.AuthKey == "" {
		ws.SetAuthenticated(false)
		return fmt.Errorf("invalid watchscreen, no authkey")
	}
	if wsPk.AuthKey != ws.AuthKey {
		ws.SetAuthenticated(false)
		return fmt.Errorf("invalid watchscreen, invalid authkey")
	}
	ws.SetAuthenticated(true)
	if wsPk.SessionId == "" || wsPk.ScreenId == "" {
		ws.UnWatchScreen()
	} else {
		ws.WatchScreen(wsPk.SessionId, wsPk.ScreenId)
		log.Printf("[ws %s] watchscreen %s/%s\n", ws.ClientId, wsPk.SessionId, wsPk.ScreenId)
	}
	if wsPk.Connect {
		log.Printf("[ws %s] watchscreen connect\n", ws.ClientId)
		err := ws.handleConnection()
		if err != nil {
			return fmt.Errorf("connect: %w", err)
		}
	}
	return nil
}

func (ws *WSState) RunWSRead() {
	shell := ws.GetShell()
	if shell == nil {
		return
	}
	shell.WriteJson(map[string]interface{}{"type": "hello"}) // let client know we accepted this connection, ignore error
	for msgBytes := range shell.ReadChan {
		pk, err := packet.ParseJsonPacket(msgBytes)
		if err != nil {
			log.Printf("error unmarshalling ws message: %v\n", err)
			continue
		}
		if pk.GetType() == scpacket.WatchScreenPacketStr {
			wsPk := pk.(*scpacket.WatchScreenPacketType)
			err := ws.handleWatchScreen(wsPk)
			if err != nil {
				// TODO send errors back to client, likely unrecoverable
				log.Printf("[ws %s] error %v\n", ws.ClientId, err)
			}
			continue
		}
		isAuth := ws.IsAuthenticated()
		if !isAuth {
			log.Printf("[error] cannot process ws-packet[%s], not authenticated\n", pk.GetType())
			continue
		}
		if pk.GetType() == scpacket.FeInputPacketStr {
			feInputPk := pk.(*scpacket.FeInputPacketType)
			if feInputPk.Remote.OwnerId != "" {
				log.Printf("[error] cannot send input to remote with ownerid\n")
				continue
			}
			if feInputPk.Remote.RemoteId == "" {
				log.Printf("[error] invalid input packet, remoteid is not set\n")
				continue
			}
			err := RemoteInputMapQueue.Enqueue(feInputPk.Remote.RemoteId, func() {
				err = sendCmdInput(feInputPk)
				if err != nil {
					log.Printf("[error] sending command input: %v\n", err)
				}
			})
			if err != nil {
				log.Printf("[error] could not queue sendCmdInput: %v\n", err)
				continue
			}
			continue
		}
		if pk.GetType() == scpacket.RemoteInputPacketStr {
			inputPk := pk.(*scpacket.RemoteInputPacketType)
			if inputPk.RemoteId == "" {
				log.Printf("[error] invalid remoteinput packet, remoteid is not set\n")
				continue
			}
			go func() {
				err = remote.SendRemoteInput(inputPk)
				if err != nil {
					log.Printf("[error] processing remote input: %v\n", err)
				}
			}()
			continue
		}
		log.Printf("got ws bad message: %v\n", pk.GetType())
	}
}

func sendCmdInput(pk *scpacket.FeInputPacketType) error {
	err := pk.CK.Validate("input packet")
	if err != nil {
		return err
	}
	if pk.Remote.RemoteId == "" {
		return fmt.Errorf("input must set remoteid")
	}
	msh := remote.GetRemoteById(pk.Remote.RemoteId)
	if msh == nil {
		return fmt.Errorf("remote %s not found", pk.Remote.RemoteId)
	}
	if len(pk.InputData64) > 0 {
		inputLen := packet.B64DecodedLen(pk.InputData64)
		if inputLen > MaxInputDataSize {
			return fmt.Errorf("input data size too large, len=%d (max=%d)", inputLen, MaxInputDataSize)
		}
		dataPk := packet.MakeDataPacket()
		dataPk.CK = pk.CK
		dataPk.FdNum = 0 // stdin
		dataPk.Data64 = pk.InputData64
		err = msh.SendInput(dataPk)
		if err != nil {
			return err
		}
	}
	if pk.SigName != "" || pk.WinSize != nil {
		siPk := packet.MakeSpecialInputPacket()
		siPk.CK = pk.CK
		siPk.SigName = pk.SigName
		siPk.WinSize = pk.WinSize
		err = msh.SendSpecialInput(siPk)
		if err != nil {
			return err
		}
	}
	return nil
}
