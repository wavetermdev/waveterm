// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scws

import (
	"context"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/configstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/mapqueue"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/userinput"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/wsshell"
)

const WSStatePacketChSize = 20
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
	UpdateCh      chan scbus.UpdatePacket
	UpdateQueue   []any
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

func (ws *WSState) WriteUpdate(update any) error {
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
	ws.UpdateCh = scbus.MainUpdateBus.RegisterChannel(ws.ClientId, &scbus.UpdateChannel{ScreenId: ws.ScreenId})
	log.Printf("[ws] watch screen clientid=%s sessionid=%s screenid=%s, updateCh=%v\n", ws.ClientId, sessionId, screenId, ws.UpdateCh)
	go ws.RunUpdates(ws.UpdateCh)
}

func (ws *WSState) UnWatchScreen() {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	scbus.MainUpdateBus.UnregisterChannel(ws.ClientId)
	ws.SessionId = ""
	ws.ScreenId = ""
	log.Printf("[ws] unwatch screen clientid=%s\n", ws.ClientId)
}

func (ws *WSState) RunUpdates(updateCh chan scbus.UpdatePacket) {
	if updateCh == nil {
		panic("invalid nil updateCh passed to RunUpdates")
	}
	for update := range updateCh {
		shell := ws.GetShell()
		if shell != nil {
			writeJsonProtected(shell, update)
		}
	}
}

func writeJsonProtected(shell *wsshell.WSShell, update any) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in scws RunUpdates WriteJson: %v\n", r)
	}()
	shell.WriteJson(update)
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
}

// returns all state required to display current UI
func (ws *WSState) handleConnection() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	connectUpdate, err := sstore.GetConnectUpdate(ctx)
	if err != nil {
		return fmt.Errorf("getting sessions: %w", err)
	}
	remotes := remote.GetAllRemoteRuntimeState()
	connectUpdate.Remotes = remotes
	// restore status indicators
	connectUpdate.ScreenStatusIndicators, connectUpdate.ScreenNumRunningCommands = sstore.GetCurrentIndicatorState()
	termthemes := configstore.GetTermThemes(ws.ClientId)
	tt, err := termthemes.ScanDir()
	if err != nil {
		return fmt.Errorf("getting termthemes: %w", err)
	}
	connectUpdate.TermThemes = &tt
	mu := scbus.MakeUpdatePacket()
	mu.AddUpdate(*connectUpdate)
	err = ws.Shell.WriteJson(mu)
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
		// log.Printf("[ws %s] watchscreen connect\n", ws.ClientId)
		err := ws.handleConnection()
		if err != nil {
			return fmt.Errorf("connect: %w", err)
		}
	}
	return nil
}

func (ws *WSState) processMessage(msgBytes []byte) error {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[scws] panic in processMessage: %v\n", r)
		debug.PrintStack()
	}()

	pk, err := packet.ParseJsonPacket(msgBytes)
	if err != nil {
		return fmt.Errorf("error unmarshalling ws message: %w", err)
	}
	if pk.GetType() == scpacket.WatchScreenPacketStr {
		wsPk := pk.(*scpacket.WatchScreenPacketType)
		err := ws.handleWatchScreen(wsPk)
		if err != nil {
			return fmt.Errorf("client:%s error %w", ws.ClientId, err)
		}
		return nil
	}
	isAuth := ws.IsAuthenticated()
	if !isAuth {
		return fmt.Errorf("cannot process ws-packet[%s], not authenticated", pk.GetType())
	}
	if pk.GetType() == scpacket.FeInputPacketStr {
		feInputPk := pk.(*scpacket.FeInputPacketType)
		if feInputPk.Remote.OwnerId != "" {
			return fmt.Errorf("error cannot send input to remote with ownerid")
		}
		if feInputPk.Remote.RemoteId == "" {
			return fmt.Errorf("error invalid input packet, remoteid is not set")
		}
		err := RemoteInputMapQueue.Enqueue(feInputPk.Remote.RemoteId, func() {
			sendErr := sendCmdInput(feInputPk)
			if sendErr != nil {
				log.Printf("[scws] sending command input: %v\n", sendErr)
			}
		})
		if err != nil {
			return fmt.Errorf("[error] could not queue sendCmdInput: %w", err)
		}
		return nil
	}
	if pk.GetType() == scpacket.RemoteInputPacketStr {
		inputPk := pk.(*scpacket.RemoteInputPacketType)
		if inputPk.RemoteId == "" {
			return fmt.Errorf("error invalid remoteinput packet, remoteid is not set")
		}
		go func() {
			sendErr := remote.SendRemoteInput(inputPk)
			if sendErr != nil {
				log.Printf("[scws] error processing remote input: %v\n", sendErr)
			}
		}()
		return nil
	}
	if pk.GetType() == scpacket.CmdInputTextPacketStr {
		cmdInputPk := pk.(*scpacket.CmdInputTextPacketType)
		if cmdInputPk.ScreenId == "" {
			return fmt.Errorf("error invalid cmdinput packet, screenid is not set")
		}
		// no need for goroutine for memory ops
		sstore.ScreenMemSetCmdInputText(cmdInputPk.ScreenId, cmdInputPk.Text, cmdInputPk.SeqNum)
		return nil
	}
	if pk.GetType() == userinput.UserInputResponsePacketStr {
		userInputRespPk := pk.(*userinput.UserInputResponsePacketType)
		uich, ok := scbus.MainRpcBus.GetRpcChannel(userInputRespPk.RequestId)
		if !ok {
			return fmt.Errorf("received User Input Response with invalid Id (%s): %v", userInputRespPk.RequestId, err)
		}
		select {
		case uich <- userInputRespPk:
		default:
		}
		return nil
	}
	return fmt.Errorf("got ws bad message: %v", pk.GetType())
}

func (ws *WSState) RunWSRead() {
	shell := ws.GetShell()
	if shell == nil {
		return
	}
	shell.WriteJson(map[string]any{"type": "hello"}) // let client know we accepted this connection, ignore error
	for msgBytes := range shell.ReadChan {
		err := ws.processMessage(msgBytes)
		if err != nil {
			// TODO send errors back to client? likely unrecoverable
			log.Printf("[scws] %v\n", err)
		}
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
	return msh.HandleFeInput(pk)
}
