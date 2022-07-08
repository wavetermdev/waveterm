package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/scripthaus-dev/mshell/pkg/cmdtail"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

const WebSocketServerAddr = "localhost:8081"
const MainServerAddr = "localhost:8080"
const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

const MaxInputDataSize = 1000

var GlobalLock = &sync.Mutex{}
var WSStateMap = make(map[string]*WSState) // clientid -> WsState

func setWSState(state *WSState) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	WSStateMap[state.ClientId] = state
}

func getWSState(clientId string) *WSState {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	return WSStateMap[clientId]
}

func removeWSStateAfterTimeout(clientId string, connectTime time.Time, waitDuration time.Duration) {
	go func() {
		time.Sleep(waitDuration)
		GlobalLock.Lock()
		defer GlobalLock.Unlock()
		state := WSStateMap[clientId]
		if state == nil || state.ConnectTime != connectTime {
			return
		}
		delete(WSStateMap, clientId)
		err := state.CloseTailer()
		if err != nil {
			fmt.Printf("[error] closing tailer on ws %v\n", err)
		}
	}()
}

type WSState struct {
	Lock        *sync.Mutex
	ClientId    string
	ConnectTime time.Time
	Shell       *wsshell.WSShell
	Tailer      *cmdtail.Tailer
	PacketCh    chan packet.PacketType
}

func MakeWSState(clientId string) (*WSState, error) {
	var err error
	rtn := &WSState{}
	rtn.Lock = &sync.Mutex{}
	rtn.ClientId = clientId
	rtn.ConnectTime = time.Now()
	rtn.PacketCh = make(chan packet.PacketType, WSStatePacketChSize)
	chSender := packet.MakeChannelPacketSender(rtn.PacketCh)
	gen := scbase.ScFileNameGenerator{ScHome: scbase.GetScHomeDir()}
	rtn.Tailer, err = cmdtail.MakeTailer(chSender, gen)
	if err != nil {
		return nil, err
	}
	go func() {
		defer close(rtn.PacketCh)
		rtn.Tailer.Run()
	}()
	go rtn.runTailerToWS()
	return rtn, nil
}

func (ws *WSState) CloseTailer() error {
	return ws.Tailer.Close()
}

func (ws *WSState) getShell() *wsshell.WSShell {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.Shell
}

func (ws *WSState) runTailerToWS() {
	for pk := range ws.PacketCh {
		if pk.GetType() == "cmddata" {
			dataPacket := pk.(*packet.CmdDataPacketType)
			err := ws.writePacket(dataPacket)
			if err != nil {
				fmt.Printf("[error] writing packet to ws: %v\n", err)
			}
			continue
		}
		fmt.Printf("tailer-to-ws, bad packet %v\n", pk.GetType())
	}
}

func (ws *WSState) writePacket(pk packet.PacketType) error {
	shell := ws.getShell()
	if shell == nil || shell.IsClosed() {
		return fmt.Errorf("cannot write packet, empty or closed wsshell")
	}
	err := shell.WriteJson(pk)
	if err != nil {
		return err
	}
	return nil
}

func (ws *WSState) getConnectTime() time.Time {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.ConnectTime
}

func (ws *WSState) updateConnectTime() {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	ws.ConnectTime = time.Now()
}

func (ws *WSState) replaceExistingShell(shell *wsshell.WSShell) {
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

func HandleWs(w http.ResponseWriter, r *http.Request) {
	shell, err := wsshell.StartWS(w, r)
	if err != nil {
		fmt.Printf("WebSocket Upgrade Failed %T: %v\n", w, err)
		return
	}
	defer shell.Conn.Close()
	clientId := r.URL.Query().Get("clientid")
	if clientId == "" {
		close(shell.WriteChan)
		return
	}
	state := getWSState(clientId)
	if state == nil {
		state, err = MakeWSState(clientId)
		if err != nil {
			fmt.Printf("cannot make wsstate: %v\n", err)
			close(shell.WriteChan)
			return
		}
		state.replaceExistingShell(shell)
		setWSState(state)
	} else {
		state.updateConnectTime()
		state.replaceExistingShell(shell)
	}
	stateConnectTime := state.getConnectTime()
	defer func() {
		removeWSStateAfterTimeout(clientId, stateConnectTime, WSStateReconnectTime)
	}()
	shell.WriteJson(map[string]interface{}{"type": "hello"}) // let client know we accepted this connection, ignore error
	fmt.Printf("WebSocket opened %s %s\n", shell.RemoteAddr, state.ClientId)
	for msgBytes := range shell.ReadChan {
		pk, err := packet.ParseJsonPacket(msgBytes)
		if err != nil {
			fmt.Printf("error unmarshalling ws message: %v\n", err)
			continue
		}
		if pk.GetType() == "getcmd" {
			getPk := pk.(*packet.GetCmdPacketType)
			done, err := state.Tailer.AddWatch(getPk)
			if err != nil {
				// TODO: send responseerror
				respPk := packet.MakeErrorResponsePacket(getPk.ReqId, err)
				fmt.Printf("[error] adding watch to tailer: %v\n", err)
				fmt.Printf("%v\n", respPk)
			}
			if done {
				respPk := packet.MakeResponsePacket(getPk.ReqId, true)
				fmt.Printf("%v\n", respPk)
				// TODO: send response
			}
			continue
		}
		if pk.GetType() == "input" {
			go func() {
				err = sendCmdInput(pk.(*packet.InputPacketType))
				if err != nil {
					fmt.Printf("[error] sending command input: %v\n", err)
				}
			}()
			continue
		}
		fmt.Printf("got ws bad message: %v\n", pk.GetType())
	}
}

// todo: sync multiple writes to the same fifoName into a single go-routine and do liveness checking on fifo
// if this returns an error, likely the fifo is dead and the cmd should be marked as 'done'
func writeToFifo(fifoName string, data []byte) error {
	rwfd, err := os.OpenFile(fifoName, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer rwfd.Close()
	fifoWriter, err := os.OpenFile(fifoName, os.O_WRONLY, 0600) // blocking open (open won't block because of rwfd)
	if err != nil {
		return err
	}
	defer fifoWriter.Close()
	// this *could* block if the fifo buffer is full
	// unlikely because if the reader is dead, and len(data) < pipe size, then the buffer will be empty and will clear after rwfd is closed
	_, err = fifoWriter.Write(data)
	if err != nil {
		return err
	}
	return nil
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

// params: sessionid
func HandleGetSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	if sessionId == "" {
		WriteJsonError(w, fmt.Errorf("must specify a sessionid"))
		return
	}
	session, err := sstore.GetSessionById(r.Context(), sessionId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, session)
	return
}

func HandleGetAllSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	list, err := sstore.GetAllSessions(r.Context())
	if err != nil {
		WriteJsonError(w, fmt.Errorf("cannot get all sessions: %w", err))
		return
	}
	WriteJsonSuccess(w, list)
	return
}

// params: name
func HandleCreateSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	name := qvals.Get("name")
	sessionId, err := sstore.InsertSessionWithName(r.Context(), name)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("inserting session: %w", err))
		return
	}
	session, err := sstore.GetSessionById(r.Context(), sessionId)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("getting new session: %w", err))
		return
	}
	WriteJsonSuccess(w, session)
	return
}

// params: sessionid, name
func HandleCreateWindow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	if _, err := uuid.Parse(sessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid: %w", err))
		return
	}
	name := qvals.Get("name")
	windowId, err := sstore.InsertWindow(r.Context(), sessionId, name)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("inserting new window: %w", err))
		return
	}
	window, err := sstore.GetWindowById(r.Context(), sessionId, windowId)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("getting new window: %w", err))
		return
	}
	WriteJsonSuccess(w, window)
	return
}

// params: [none]
func HandleGetRemotes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	remotes := remote.GetAllRemoteState()
	WriteJsonSuccess(w, remotes)
	return
}

// params: sessionid, windowid
func HandleGetWindow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	windowId := qvals.Get("windowid")
	if _, err := uuid.Parse(sessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid: %w", err))
		return
	}
	if _, err := uuid.Parse(windowId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid windowid: %w", err))
		return
	}
	window, err := sstore.GetWindowById(r.Context(), sessionId, windowId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, window)
	return
}

func GetPtyOutFile(sessionId string, cmdId string) string {
	pathStr := fmt.Sprintf("/Users/mike/scripthaus/.sessions/%s/%s.ptyout", sessionId, cmdId)
	return pathStr
}

func HandleGetPtyOut(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	cmdId := qvals.Get("cmdid")
	if sessionId == "" || cmdId == "" {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("must specify sessionid and cmdid")))
		return
	}
	if _, err := uuid.Parse(sessionId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid sessionid: %v", err)))
		return
	}
	if _, err := uuid.Parse(cmdId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid cmdid: %v", err)))
		return
	}
	pathStr, err := scbase.PtyOutFile(sessionId, cmdId)
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot get ptyout file name: %v", err)))
		return
	}
	fd, err := os.Open(pathStr)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot open file '%s': %v", pathStr, err)))
		return
	}
	defer fd.Close()
	w.WriteHeader(http.StatusOK)
	io.Copy(w, fd)
}

func WriteJsonError(w http.ResponseWriter, errVal error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(500)
	errMap := make(map[string]interface{})
	errMap["error"] = errVal.Error()
	barr, _ := json.Marshal(errMap)
	w.Write(barr)
	return
}

func WriteJsonSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	rtnMap := make(map[string]interface{})
	rtnMap["success"] = true
	if data != nil {
		rtnMap["data"] = data
	}
	barr, err := json.Marshal(rtnMap)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	w.WriteHeader(200)
	w.Write(barr)
	return
}

type runCommandResponse struct {
	Line *sstore.LineType `json:"line"`
	Cmd  *sstore.CmdType  `json:"cmd"`
}

func HandleRunCommand(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == "GET" || r.Method == "OPTIONS" {
		w.WriteHeader(200)
		return
	}
	decoder := json.NewDecoder(r.Body)
	var commandPk scpacket.FeCommandPacketType
	err := decoder.Decode(&commandPk)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %w", err))
		return
	}
	if _, err = uuid.Parse(commandPk.SessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid '%s': %w", commandPk.SessionId, err))
		return
	}
	resp, err := ProcessFeCommandPacket(r.Context(), &commandPk)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, resp)
	return
}

func ProcessFeCommandPacket(ctx context.Context, pk *scpacket.FeCommandPacketType) (*runCommandResponse, error) {
	commandStr := strings.TrimSpace(pk.CmdStr)
	if commandStr == "" {
		return nil, fmt.Errorf("invalid emtpty command")
	}
	if strings.HasPrefix(commandStr, "/comment ") {
		text := strings.TrimSpace(commandStr[9:])
		rtnLine, err := sstore.AddCommentLine(ctx, pk.SessionId, pk.WindowId, pk.UserId, text)
		if err != nil {
			return nil, err
		}
		return &runCommandResponse{Line: rtnLine}, nil
	}
	if strings.HasPrefix(commandStr, "cd ") {
		newDir := strings.TrimSpace(commandStr[3:])
		cdPacket := packet.MakeCdPacket()
		cdPacket.ReqId = uuid.New().String()
		cdPacket.Dir = newDir
		localRemote := remote.GetRemoteById(pk.RemoteState.RemoteId)
		if localRemote == nil {
			return nil, fmt.Errorf("invalid remote, cannot execute command")
		}
		resp, err := localRemote.PacketRpc(ctx, cdPacket)
		if err != nil {
			return nil, err
		}
		fmt.Printf("GOT cd RESP: %v\n", resp)
		return nil, nil
	}
	cmdId := uuid.New().String()
	cmd, err := remote.RunCommand(ctx, pk, cmdId)
	if err != nil {
		return nil, err
	}
	rtnLine, err := sstore.AddCmdLine(ctx, pk.SessionId, pk.WindowId, pk.UserId, cmd)
	if err != nil {
		return nil, err
	}
	return &runCommandResponse{Line: rtnLine, Cmd: cmd}, nil
}

// /api/start-session
//   returns:
//     * userid
//     * sessionid
//
// /api/get-session
//   params:
//     * name
//   returns:
//     * session
//
// /api/ptyout (pos=[position]) - returns contents of ptyout file
//   params:
//     * sessionid
//     * cmdid
//     * pos
//   returns:
//     * stream of ptyout file (text, utf-8)
//
// POST /api/run-command
//   params
//     * userid
//     * sessionid
//   returns
//     * cmdid
//
// /api/refresh-session
//   params
//     * sessionid
//     * start  -- can be negative
//     * numlines
//   returns
//     * permissions (readonly, comment, command)
//     * lines
//       * lineid
//       * ts
//       * userid
//       * linetype
//       * text
//       * cmdid

// /ws
//   ->watch-session:
//     * sessionid
//   ->watch:
//     * sessionid
//     * cmdid
//   ->focus:
//     * sessionid
//     * cmdid
//   ->input:
//     * sessionid
//     * cmdid
//     * data
//   ->signal:
//     * sessionid
//     * cmdid
//     * data
//   <-data:
//     * sessionid
//     * cmdid
//     * pos
//     * data
//   <-session-data:
//     * sessionid
//     * line

// session-doc
//   timestamp | user | cmd-type | data
//   cmd-type = comment
//   cmd-type = command, commandid=ABC

// how to know if command is still executing?  is command done?

// local -- .ptyout, .stdin
// remote -- transfer controller program
//   controller-startcmd -- start command (with options) => returns cmdid
//   controller-watchsession [sessionid]
//     transfer [cmdid:pos] pairs.  streams back anything new written to ptyout on stdout
//     stdin-packet [cmdid:user:data]
//       startcmd will figure out the correct
//

func runWebSocketServer() {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	server := &http.Server{
		Addr:           WebSocketServerAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	fmt.Printf("Running websocket server on %s\n", WebSocketServerAddr)
	err := server.ListenAndServe()
	if err != nil {
		fmt.Printf("[error] trying to run websocket server: %v\n", err)
	}
}

func main() {
	scLock, err := scbase.AcquireSCLock()
	if err != nil || scLock == nil {
		fmt.Printf("[error] cannot acquire sh2 lock: %v\n", err)
		return
	}

	if len(os.Args) >= 2 && strings.HasPrefix(os.Args[1], "--migrate") {
		err := sstore.MigrateCommandOpts(os.Args[1:])
		if err != nil {
			fmt.Printf("[error] %v\n", err)
		}
		return
	}
	err = sstore.TryMigrateUp()
	if err != nil {
		fmt.Printf("[error] %v\n", err)
		return
	}
	err = sstore.EnsureLocalRemote(context.Background())
	if err != nil {
		fmt.Printf("[error] ensuring local remote: %v\n", err)
		return
	}
	_, err = sstore.EnsureDefaultSession(context.Background())
	if err != nil {
		fmt.Printf("[error] ensuring default session: %v\n", err)
		return
	}
	err = remote.LoadRemotes(context.Background())
	if err != nil {
		fmt.Printf("[error] loading remotes: %v\n", err)
		return
	}

	err = sstore.HangupAllRunningCmds(context.Background())
	if err != nil {
		fmt.Printf("[error] calling HUP on all running commands\n")
	}

	go runWebSocketServer()
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", HandleGetPtyOut)
	gr.HandleFunc("/api/get-all-sessions", HandleGetAllSessions)
	gr.HandleFunc("/api/create-session", HandleCreateSession)
	gr.HandleFunc("/api/get-session", HandleGetSession)
	gr.HandleFunc("/api/get-window", HandleGetWindow)
	gr.HandleFunc("/api/get-remotes", HandleGetRemotes)
	gr.HandleFunc("/api/create-window", HandleCreateWindow)
	gr.HandleFunc("/api/run-command", HandleRunCommand).Methods("GET", "POST", "OPTIONS")
	server := &http.Server{
		Addr:           MainServerAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        http.TimeoutHandler(gr, HttpTimeoutDuration, "Timeout"),
	}
	server.SetKeepAlivesEnabled(false)
	fmt.Printf("Running main server on %s\n", MainServerAddr)
	err = server.ListenAndServe()
	if err != nil {
		fmt.Printf("ERROR: %v\n", err)
	}
}
