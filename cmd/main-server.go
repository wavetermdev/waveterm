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

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/cmdtail"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
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
	rtn.Tailer, err = cmdtail.MakeTailer(chSender)
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
			err = state.Tailer.AddWatch(pk.(*packet.GetCmdPacketType))
			if err != nil {
				fmt.Printf("[error] adding watch to tailer: %v\n", err)
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
	if len(pk.InputData) > MaxInputDataSize {
		return fmt.Errorf("input data size too large, len=%d (max=%d)", len(pk.InputData), MaxInputDataSize)
	}
	fileNames, err := base.GetCommandFileNames(pk.CK)
	if err != nil {
		return err
	}
	err = writeToFifo(fileNames.StdinFifo, []byte(pk.InputData))
	if err != nil {
		return err
	}
	return nil
}

// params: name
func HandleGetSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	name := qvals.Get("name")
	if name == "" {
		WriteJsonError(w, fmt.Errorf("must specify a name"))
		return
	}
	session, err := sstore.GetSessionByName(r.Context(), name)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, session)
	return
}

// params: sessionid, windowid
func HandleGetWindowLines(w http.ResponseWriter, r *http.Request) {
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
	lines, err := sstore.GetWindowLines(r.Context(), sessionId, windowId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, lines)
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
	pathStr := GetPtyOutFile(sessionId, cmdId)
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
	line, err := ProcessFeCommandPacket(&commandPk)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, &runCommandResponse{Line: line})
	return
}

func ProcessFeCommandPacket(pk *scpacket.FeCommandPacketType) (*sstore.LineType, error) {
	commandStr := strings.TrimSpace(pk.CmdStr)
	if commandStr == "" {
		return nil, fmt.Errorf("invalid emtpty command")
	}
	if strings.HasPrefix(commandStr, "/comment ") {
		text := strings.TrimSpace(commandStr[9:])
		rtnLine := sstore.MakeNewLineText(pk.SessionId, pk.WindowId, text)
		return rtnLine, nil
	}
	if strings.HasPrefix(commandStr, "cd ") {
		newDir := strings.TrimSpace(commandStr[3:])
		cdPacket := packet.MakeCdPacket()
		cdPacket.PacketId = uuid.New().String()
		cdPacket.Dir = newDir
		localRemote := remote.GetRemote("local")
		if localRemote != nil {
			localRemote.Input.SendPacket(cdPacket)
		}
		return nil, nil
	}
	rtnLine := sstore.MakeNewLineCmd(pk.SessionId, pk.WindowId)
	runPacket := packet.MakeRunPacket()
	runPacket.CK = base.MakeCommandKey(pk.SessionId, rtnLine.CmdId)
	runPacket.Cwd = ""
	runPacket.Env = nil
	runPacket.Command = commandStr
	fmt.Printf("run-packet %v\n", runPacket)
	go func() {
		localRemote := remote.GetRemote("local")
		if localRemote != nil {
			localRemote.Input.SendPacket(runPacket)
		}
	}()
	return rtnLine, nil
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
	if len(os.Args) >= 2 && strings.HasPrefix(os.Args[1], "--migrate") {
		err := sstore.MigrateCommandOpts(os.Args[1:])
		if err != nil {
			fmt.Printf("[error] %v\n", err)
		}
		return
	}
	err := sstore.TryMigrateUp()
	if err != nil {
		fmt.Printf("[error] %v\n", err)
		return
	}
	err = sstore.EnsureLocalRemote(context.Background())
	if err != nil {
		fmt.Printf("[error] ensuring local remote: %v\n", err)
		return
	}
	defaultSession, err := sstore.EnsureDefaultSession(context.Background())
	if err != nil {
		fmt.Printf("[error] ensuring default session: %v\n", err)
		return
	}
	fmt.Printf("session: %v\n", defaultSession)
	err = remote.LoadRemotes(context.Background())
	if err != nil {
		fmt.Printf("[error] loading remotes: %v\n", err)
		return
	}
	go runWebSocketServer()
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", HandleGetPtyOut)
	gr.HandleFunc("/api/get-session", HandleGetSession)
	gr.HandleFunc("/api/get-window-lines", HandleGetWindowLines)
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
